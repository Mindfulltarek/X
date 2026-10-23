import "server-only";

import { ApiError, apiError, logServerEvent } from "../errors";
import { readUpstreamError } from "./client";
import { extractImages } from "./parse";

/**
 * Image backends — image generation through services that are *not*
 * OpenAI-compatible chat providers.
 *
 * Each backend speaks its own documented protocol, and none of them is guessed:
 *
 *  · Google Gemini      POST {base}/models/{model}:generateContent
 *        header `x-goog-api-key`, body { contents, generationConfig } with
 *        `responseModalities: ["TEXT","IMAGE"]`; images come back inline as
 *        base64 in `candidates[].content.parts[].inlineData`.
 *  · xAI Grok Imagine   POST https://api.x.ai/v1/images/generations (OpenAI shape)
 *  · Kie.ai             task API
 *        POST https://api.kie.ai/api/v1/jobs/createTask  (Bearer auth)
 *             { model, input: {...}, callBackUrl? } → { code, data: { taskId } }
 *        GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=…
 *             → data.state: waiting|queuing|generating|success|fail,
 *               data.resultJson = JSON **string** holding the result URLs.
 *  · Wiro.ai            task API
 *        POST https://api.wiro.ai/v1/Run/{owner}/{model}   (x-api-key)
 *             → { result: true, taskid, socketaccesstoken }
 *        POST https://api.wiro.ai/v1/Task/Detail  { tasktoken }
 *             → { status: task_postprocess_end, pexit: "0",
 *                 tasklist[].outputs[].url }
 *
 * Everything is opt-in through environment variables, and the *order* is
 * controlled by `AI_IMAGE_PROVIDERS`. Nothing is invented: when a model id has
 * no sensible default (Wiro publishes hundreds), the backend stays
 * "not configured" until you set it explicitly.
 */

const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_MS = 3_000;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function firstEnv(...names: string[]): { value: string; env: string } | null {
  for (const name of names) {
    const value = env(name);
    if (value) return { value, env: name };
  }
  return null;
}

function order(variable: string, fallback: string[]): string[] {
  const raw = env(variable);
  if (!raw) return fallback;
  const list = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export interface MediaBackendStatus {
  id: "google" | "xai" | "kie" | "wiro";
  label: string;
  configured: boolean;
  apiKeyEnv?: string;
  imageModel?: string;
  message: string;
}

/** Every image backend the build knows about, with a truthful configured/not state. */
export function mediaBackends(): MediaBackendStatus[] {
  const google = firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY");
  const xai = firstEnv("XAI_API_KEY");
  const kie = firstEnv("KIE_API_KEY", "KIEAI_API_KEY");
  const wiro = firstEnv("WIRO_API_KEY");

  const googleImageModel = env("AI_GEMINI_IMAGE_MODEL") ?? "gemini-2.5-flash-image";
  const xaiImageModel = env("AI_XAI_IMAGE_MODEL") ?? "grok-imagine-image-2.0";
  const kieImageModel = env("AI_KIE_IMAGE_MODEL") ?? "flux1-kontext";
  const wiroImageModel = env("AI_WIRO_IMAGE_MODEL");

  return [
    {
      id: "google",
      label: "Google Gemini (Nano Banana)",
      configured: Boolean(google),
      apiKeyEnv: google?.env,
      imageModel: googleImageModel,
      message: google
        ? `Images via ${googleImageModel}.`
        : "Set GEMINI_API_KEY to enable Gemini image generation.",
    },
    {
      id: "xai",
      label: "xAI Grok Imagine",
      configured: Boolean(xai),
      apiKeyEnv: xai?.env,
      imageModel: xaiImageModel,
      message: xai
        ? `Images via ${xaiImageModel}.`
        : "Set XAI_API_KEY to enable Grok Imagine image generation.",
    },
    {
      id: "kie",
      label: "Kie.ai",
      configured: Boolean(kie) && Boolean(kieImageModel),
      apiKeyEnv: kie?.env,
      imageModel: kieImageModel,
      message: kie ? `Images via ${kieImageModel}.` : "Set KIE_API_KEY to enable Kie.ai image models.",
    },
    {
      id: "wiro",
      label: "Wiro.ai",
      configured: Boolean(wiro) && Boolean(wiroImageModel),
      apiKeyEnv: wiro?.env,
      imageModel: wiroImageModel,
      message: wiro
        ? wiroImageModel
          ? `Images via ${wiroImageModel}.`
          : "Wiro needs an explicit model: set AI_WIRO_IMAGE_MODEL (e.g. black-forest-labs/flux-2-flex)."
        : "Set WIRO_API_KEY (and AI_WIRO_IMAGE_MODEL) to enable Wiro image models.",
    },
  ];
}

/** Image backends, in the order the operator asked for. */
export function mediaOrder(): MediaBackendStatus[] {
  const wanted = order("AI_IMAGE_PROVIDERS", ["google", "xai", "kie", "wiro"]);
  const all = mediaBackends();
  const picked: MediaBackendStatus[] = [];
  for (const id of wanted) {
    const backend = all.find((entry) => entry.id === id);
    if (backend && backend.configured) picked.push(backend);
  }
  return picked;
}

/* -------------------------------------------------------------------------- */
/* Result                                                                      */
/* -------------------------------------------------------------------------- */

export interface MediaAttempt {
  id: string;
  label: string;
  ok: boolean;
  status?: number;
  code?: string;
  /** Sanitised upstream reason (never a key, never a full response body). */
  reason?: string;
}

export interface MediaResult {
  kind: "image";
  /** Which backends were tried, in order, and why each earlier one failed. */
  attempts?: MediaAttempt[];
  /** Data URLs or https URLs — whatever the backend returned. */
  urls: string[];
  model: string;
  provider: string;
  providerLabel: string;
  waitedMs: number;
  meta?: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function failed(status: number, detail: string, label: string): ApiError {
  if (status === 401 || status === 403) {
    return apiError("unauthorized_upstream", {
      message: `${label} rejected the API key (or the account has no credit).`,
      details: detail,
    });
  }
  if (status === 429) return apiError("rate_limited_upstream", { details: detail });
  if (status === 402) {
    return apiError("unauthorized_upstream", {
      message: `${label} reports insufficient credit for this request.`,
      details: detail,
    });
  }
  return apiError("upstream_unavailable", { message: `${label} could not complete the request.`, details: detail });
}

/**
 * Turns an upstream message into something safe to hand back to the browser:
 * long token-like strings are masked and the length is capped. Provider error
 * bodies occasionally echo request ids, so this stays deliberately blunt.
 */
function sanitizeReason(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/[A-Za-z0-9_-]{28,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 180) || fallback;
}

/* -------------------------------------------------------------------------- */
/* Google Gemini — image                                                       */
/* -------------------------------------------------------------------------- */

const GOOGLE_BASE = () => (env("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");

/** Documented Gemini image-output model ids, newest first. */
function geminiImageModels(): string[] {
  const configured = env("AI_GEMINI_IMAGE_MODEL");
  const defaults = ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"];
  return configured ? [configured, ...defaults.filter((id) => id !== configured)] : defaults;
}

type GeminiPart = { inlineData?: { mimeType?: string; data?: string }; text?: string };

function collectGeminiImages(parts: GeminiPart[] | undefined): string[] {
  const urls: string[] = [];
  for (const part of parts ?? []) {
    const inline = part.inlineData;
    if (inline?.data) urls.push(`data:${inline.mimeType ?? "image/png"};base64,${inline.data}`);
  }
  return urls;
}

/** `POST /models/{model}:generateContent` with `responseModalities: [TEXT, IMAGE]`. */
async function googleGenerateContent(opts: {
  model: string;
  prompt: string;
  signal: AbortSignal;
  key: string;
}): Promise<{ urls: string[]; status: number; body: unknown }> {
  const res = await fetch(`${GOOGLE_BASE()}/models/${encodeURIComponent(opts.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": opts.key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]),
    cache: "no-store",
  });
  const body = await readJson(res);
  const parts = (body as { candidates?: { content?: { parts?: GeminiPart[] } }[] })?.candidates?.[0]?.content?.parts;
  return { urls: collectGeminiImages(parts), status: res.status, body };
}

/** `POST /interactions` with `response_format: {type: "image"}` (newer image models). */
async function googleInteractions(opts: {
  model: string;
  prompt: string;
  signal: AbortSignal;
  key: string;
}): Promise<{ urls: string[]; status: number; body: unknown }> {
  const res = await fetch(`${GOOGLE_BASE()}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": opts.key },
    body: JSON.stringify({
      model: opts.model,
      input: [{ type: "text", text: opts.prompt }],
      response_format: { type: "image" },
    }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]),
    cache: "no-store",
  });
  const body = (await readJson(res)) as {
    output_image?: { data?: string; mime_type?: string } | string;
    outputs?: { type?: string; data?: string; mime_type?: string; image?: { data?: string; mime_type?: string } }[];
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  } | null;

  const urls: string[] = [];
  const push = (data?: string, mime?: string) => {
    if (data) urls.push(`data:${mime ?? "image/png"};base64,${data}`);
  };
  if (typeof body?.output_image === "string") push(body.output_image);
  else push(body?.output_image?.data, body?.output_image?.mime_type);
  for (const output of body?.outputs ?? []) {
    push(output.data, output.mime_type);
    push(output.image?.data, output.image?.mime_type);
  }
  urls.push(...collectGeminiImages(body?.candidates?.[0]?.content?.parts));

  return { urls, status: res.status, body };
}

async function googleImage(opts: { prompt: string; signal: AbortSignal }): Promise<MediaResult> {
  const key = firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY");
  if (!key) throw apiError("image_backend_not_configured", { message: "GEMINI_API_KEY is not set." });
  const started = Date.now();
  const models = geminiImageModels();
  const reasons: string[] = [];

  for (const model of models) {
    // 1. The long-standing text+image modality call.
    const primary = await googleGenerateContent({ model, prompt: opts.prompt, signal: opts.signal, key: key.value });
    if (primary.urls.length > 0) {
      return {
        kind: "image",
        urls: primary.urls,
        model,
        provider: "google",
        providerLabel: "Google Gemini",
        waitedMs: Date.now() - started,
      };
    }
    if (primary.status === 401 || primary.status === 403) {
      throw failed(primary.status, await describe(primary.body), "Google Gemini");
    }
    reasons.push(`${model} /:generateContent → HTTP ${primary.status} ${await describe(primary.body)}`);

    // 2. The newer image endpoint, used when the model rejects responseModalities.
    const interaction = await googleInteractions({ model, prompt: opts.prompt, signal: opts.signal, key: key.value });
    if (interaction.urls.length > 0) {
      return {
        kind: "image",
        urls: interaction.urls,
        model,
        provider: "google",
        providerLabel: "Google Gemini",
        waitedMs: Date.now() - started,
      };
    }
    if (interaction.status === 401 || interaction.status === 403) {
      throw failed(interaction.status, await describe(interaction.body), "Google Gemini");
    }
    reasons.push(`${model} /interactions → HTTP ${interaction.status} ${await describe(interaction.body)}`);
  }

  throw apiError("upstream_unavailable", {
    message: "Google Gemini did not return an image for any known image model.",
    details: sanitizeReason(reasons.join(" | "), "No image returned."),
    retryable: true,
  });
}

/** Short human description of an upstream JSON body, for diagnostics. */
async function describe(body: unknown): Promise<string> {
  if (!body) return "(empty)";
  const message = (body as { error?: { message?: string }; message?: string }).error?.message ??
    (body as { message?: string }).message;
  if (typeof message === "string" && message) return message.slice(0, 120);
  try {
    return JSON.stringify(body).slice(0, 120);
  } catch {
    return "(unreadable)";
  }
}

/* -------------------------------------------------------------------------- */
/* xAI — image (OpenAI shape)                                                  */
/* -------------------------------------------------------------------------- */

const XAI_BASE = () => (env("XAI_BASE_URL") ?? "https://api.x.ai/v1").replace(/\/+$/, "");

async function xaiImage(opts: { prompt: string; size?: string; signal: AbortSignal }): Promise<MediaResult> {
  const key = firstEnv("XAI_API_KEY");
  if (!key) throw apiError("image_backend_not_configured", { message: "XAI_API_KEY is not set." });
  const model = env("AI_XAI_IMAGE_MODEL") ?? "grok-imagine-image-2.0";
  const started = Date.now();

  const res = await fetch(`${XAI_BASE()}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.value}` },
    body: JSON.stringify({ model, prompt: opts.prompt, n: 1 }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]),
    cache: "no-store",
  });
  if (!res.ok) throw failed(res.status, await readUpstreamError(res), "xAI");

  const json = await readJson(res);
  const urls = extractImages(json).map((image) => image.url);
  if (urls.length === 0) throw apiError("invalid_response", { message: "xAI returned no image." });

  return { kind: "image", urls, model, provider: "xai", providerLabel: "xAI", waitedMs: Date.now() - started };
}

/* -------------------------------------------------------------------------- */
/* Kie.ai — task API                                                           */
/* -------------------------------------------------------------------------- */

const KIE_BASE = () => (env("KIE_BASE_URL") ?? "https://api.kie.ai").replace(/\/+$/, "");

function collectUrls(input: unknown, out: string[] = []): string[] {
  if (typeof input === "string") {
    if (/^https?:\/\//i.test(input) || input.startsWith("data:image")) out.push(input);
    return out;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectUrls(item, out);
    return out;
  }
  if (input && typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) collectUrls(value, out);
  }
  return out;
}

async function kieTask(opts: {
  prompt: string;
  signal: AbortSignal;
  deadlineMs: number;
}): Promise<MediaResult> {
  const key = firstEnv("KIE_API_KEY", "KIEAI_API_KEY");
  if (!key) throw apiError("not_configured", { message: "KIE_API_KEY is not set." });
  const model = env("AI_KIE_IMAGE_MODEL") ?? "flux1-kontext";
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: env("AI_KIE_IMAGE_ASPECT_RATIO") ?? "1:1",
    output_format: "png",
  };

  const started = Date.now();
  const deadline = started + opts.deadlineMs;

  const create = await fetch(`${KIE_BASE()}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.value}` },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]),
    cache: "no-store",
  });
  if (!create.ok) throw failed(create.status, await readUpstreamError(create), "Kie.ai");

  const created = (await readJson(create)) as { code?: number; msg?: string; data?: { taskId?: string } };
  const taskId = created?.data?.taskId;
  if (!taskId) {
    throw apiError("invalid_response", {
      message: `Kie.ai did not accept the task${created?.msg ? `: ${created.msg}` : "."}`,
    });
  }

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const poll = await fetch(`${KIE_BASE()}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key.value}` },
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]),
      cache: "no-store",
    });
    if (!poll.ok) continue;
    const body = (await readJson(poll)) as {
      data?: { state?: string; failMsg?: string; resultJson?: string | Record<string, unknown> };
    };
    const state = body?.data?.state;
    if (state === "success") {
      let result: unknown = body.data?.resultJson;
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {
          /* keep the raw string; collectUrls will find any URLs inside it */
        }
      }
      const urls = collectUrls(result).filter((url) => !/^data:image\/(jpeg|jpg|png|webp)?;?$/.test(url));
      if (urls.length === 0) throw apiError("invalid_response", { message: "Kie.ai returned no media URL." });
      return {
        kind: "image",
        urls,
        model,
        provider: "kie",
        providerLabel: "Kie.ai",
        waitedMs: Date.now() - started,
        meta: { taskId },
      };
    }
    if (state === "fail") {
      throw apiError("upstream_unavailable", {
        message: `Kie.ai task failed${body?.data?.failMsg ? `: ${body.data.failMsg}` : "."}`,
        details: `task ${taskId}`,
      });
    }
  }

  throw apiError("upstream_timeout", {
    message: "The Kie.ai task is still running. Try again in a moment.",
    details: `task ${taskId}`,
    retryable: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Wiro.ai — task API                                                          */
/* -------------------------------------------------------------------------- */

const WIRO_BASE = () => (env("WIRO_BASE_URL") ?? "https://api.wiro.ai/v1").replace(/\/+$/, "");

function wiroHeaders(): Record<string, string> {
  const key = firstEnv("WIRO_API_KEY");
  if (!key) throw apiError("not_configured", { message: "WIRO_API_KEY is not set." });
  const secret = env("WIRO_API_SECRET");
  // Wiro accepts either the bare key (API-key projects) or `key:secret`
  // (signature projects) in the documented `x-api-key` header.
  return {
    "Content-Type": "application/json",
    "x-api-key": secret ? `${key.value}:${secret}` : key.value,
  };
}

async function wiroTask(opts: { prompt: string; signal: AbortSignal; deadlineMs: number }): Promise<MediaResult> {
  const model = env("AI_WIRO_IMAGE_MODEL");
  if (!model) {
    throw apiError("not_configured", {
      message: "Set AI_WIRO_IMAGE_MODEL (owner/model slug from wiro.ai, e.g. black-forest-labs/flux-2-flex).",
    });
  }

  const started = Date.now();
  const deadline = started + opts.deadlineMs;

  const create = await fetch(`${WIRO_BASE()}/Run/${model}`, {
    method: "POST",
    headers: wiroHeaders(),
    body: JSON.stringify({ prompt: opts.prompt }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]),
    cache: "no-store",
  });
  if (!create.ok) throw failed(create.status, await readUpstreamError(create), "Wiro.ai");

  const created = (await readJson(create)) as { result?: boolean; taskid?: number | string; socketaccesstoken?: string; errors?: unknown };
  const token = created?.socketaccesstoken;
  const taskId = created?.taskid;
  if (!created?.result || (!token && taskId === undefined)) {
    throw apiError("invalid_response", {
      message: "Wiro.ai did not accept the task.",
      details: JSON.stringify(created?.errors ?? {}).slice(0, 200),
    });
  }

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const poll = await fetch(`${WIRO_BASE()}/Task/Detail`, {
      method: "POST",
      headers: wiroHeaders(),
      body: JSON.stringify(token ? { tasktoken: token } : { taskid: taskId }),
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]),
      cache: "no-store",
    });
    if (!poll.ok) continue;
    const body = (await readJson(poll)) as {
      status?: string;
      pexit?: string;
      tasklist?: { outputs?: { url?: string }[] }[];
      errors?: unknown;
    };
    if (body?.status === "task_postprocess_end") {
      const urls = (body.tasklist ?? [])
        .flatMap((task) => task.outputs ?? [])
        .map((output) => output.url)
        .filter((url): url is string => Boolean(url));
      if (body.pexit !== "0" || urls.length === 0) {
        throw apiError("upstream_unavailable", {
          message: "Wiro.ai finished the task without a usable output.",
          details: JSON.stringify(body.errors ?? {}).slice(0, 200),
        });
      }
      return {
        kind: "image",
        urls,
        model,
        provider: "wiro",
        providerLabel: "Wiro.ai",
        waitedMs: Date.now() - started,
        meta: { taskId },
      };
    }
    if (body?.status === "task_cancel") {
      throw apiError("upstream_unavailable", { message: "The Wiro.ai task was cancelled." });
    }
  }

  throw apiError("upstream_timeout", {
    message: "The Wiro.ai task is still running. Try again in a moment.",
    retryable: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Public entry points                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Try every configured image backend in `AI_IMAGE_PROVIDERS` order.
 * Returns the first success; throws the first failure if none succeed, so the
 * caller's error message is always about a real backend.
 */
export async function generateImageViaMedia(opts: {
  prompt: string;
  size?: string;
  signal: AbortSignal;
}): Promise<MediaResult | null> {
  const backends = mediaOrder();
  if (backends.length === 0) return null;

  const attempts: MediaAttempt[] = [];
  let firstError: ApiError | null = null;

  for (const backend of backends) {
    try {
      const result =
        backend.id === "google"
          ? await googleImage({ prompt: opts.prompt, signal: opts.signal })
          : backend.id === "xai"
            ? await xaiImage({ prompt: opts.prompt, size: opts.size, signal: opts.signal })
            : backend.id === "kie"
              ? await kieTask({ prompt: opts.prompt, signal: opts.signal, deadlineMs: 110_000 })
              : await wiroTask({ prompt: opts.prompt, signal: opts.signal, deadlineMs: 110_000 });
      logServerEvent({
        requestId: `media-image-${backend.id}`,
        route: "media:image",
        status: 200,
        model: result.model,
        durationMs: result.waitedMs,
      });
      attempts.push({ id: backend.id, label: backend.label, ok: true });
      return { ...result, attempts };
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : apiError("internal");
      const reason = sanitizeReason(
        apiErr.details ?? apiErr.message,
        apiErr.code === "upstream_timeout" ? "timed out" : "failed",
      );
      logServerEvent({
        requestId: `media-image-${backend.id}`,
        route: "media:image",
        code: apiErr.code,
        detail: `${backend.label}: ${reason}`.slice(0, 180),
      });
      attempts.push({ id: backend.id, label: backend.label, ok: false, code: apiErr.code, reason });
      if (!firstError) firstError = apiErr;
    }
  }

  const summary = attempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => `${attempt.label}: ${attempt.reason}`)
    .join(" · ");
  if (firstError) firstError.details = summary.slice(0, 400) || firstError.details;
  throw firstError ?? apiError("image_backend_not_configured");
}
