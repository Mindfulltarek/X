import "server-only";

import { ApiError, apiError, logServerEvent } from "../errors";
import { readUpstreamError } from "./client";
import { extractImages } from "./parse";

/**
 * Media backends — image and video generation through services that are *not*
 * OpenAI-compatible chat providers.
 *
 * Each backend speaks its own documented protocol, and none of them is guessed:
 *
 *  · Google Gemini (image)  POST {base}/models/{model}:generateContent
 *        header `x-goog-api-key`, body { contents, generationConfig } with
 *        `responseModalities: ["TEXT","IMAGE"]`; images come back inline as
 *        base64 in `candidates[].content.parts[].inlineData`.
 *  · xAI Grok Imagine (image + video)
 *        images: POST https://api.x.ai/v1/images/generations (OpenAI shape)
 *        video:  POST https://api.x.ai/v1/videos/generations → { request_id },
 *                GET  https://api.x.ai/v1/videos/{id} → { status: done|failed|
 *                expired|pending, video: { url } }
 *  · Kie.ai (image + video)  task API
 *        POST https://api.kie.ai/api/v1/jobs/createTask  (Bearer auth)
 *             { model, input: {...}, callBackUrl? } → { code, data: { taskId } }
 *        GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=…
 *             → data.state: waiting|queuing|generating|success|fail,
 *               data.resultJson = JSON **string** holding the result URLs.
 *  · Wiro.ai (image + video) task API
 *        POST https://api.wiro.ai/v1/Run/{owner}/{model}   (x-api-key)
 *             → { result: true, taskid, socketaccesstoken }
 *        POST https://api.wiro.ai/v1/Task/Detail  { tasktoken }
 *             → { status: task_postprocess_end, pexit: "0",
 *                 tasklist[].outputs[].url }
 *
 * Everything is opt-in through environment variables, and the *order* is
 * controlled by `AI_IMAGE_PROVIDERS` / `AI_VIDEO_PROVIDERS`. Nothing is invented:
 * when a model id has no sensible default (Wiro and Kie publish hundreds), the
 * backend stays "not configured" until you set it explicitly.
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

export type MediaKind = "image" | "video";

export interface MediaBackendStatus {
  id: "google" | "xai" | "kie" | "wiro";
  label: string;
  kinds: MediaKind[];
  configured: boolean;
  apiKeyEnv?: string;
  imageModel?: string;
  videoModel?: string;
  message: string;
}

/** Every backend the build knows about, with a truthful configured/not state. */
export function mediaBackends(): MediaBackendStatus[] {
  const google = firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY");
  const xai = firstEnv("XAI_API_KEY");
  const kie = firstEnv("KIE_API_KEY", "KIEAI_API_KEY");
  const wiro = firstEnv("WIRO_API_KEY");

  const googleImageModel = env("AI_GEMINI_IMAGE_MODEL") ?? "gemini-2.5-flash-image";
  const xaiImageModel = env("AI_XAI_IMAGE_MODEL") ?? "grok-imagine-image-2.0";
  const xaiVideoModel = env("AI_XAI_VIDEO_MODEL") ?? "grok-imagine-video-1.5-lite";
  const kieImageModel = env("AI_KIE_IMAGE_MODEL") ?? "flux1-kontext";
  const kieVideoModel = env("AI_KIE_VIDEO_MODEL");
  const wiroImageModel = env("AI_WIRO_IMAGE_MODEL");
  const wiroVideoModel = env("AI_WIRO_VIDEO_MODEL");

  return [
    {
      id: "google",
      label: "Google Gemini (Nano Banana)",
      kinds: ["image"],
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
      kinds: ["image", "video"],
      configured: Boolean(xai),
      apiKeyEnv: xai?.env,
      imageModel: xaiImageModel,
      videoModel: xaiVideoModel,
      message: xai
        ? `Images via ${xaiImageModel}, video via ${xaiVideoModel}.`
        : "Set XAI_API_KEY to enable Grok Imagine image and video generation.",
    },
    {
      id: "kie",
      label: "Kie.ai",
      kinds: ["image", "video"],
      configured: Boolean(kie) && Boolean(kieImageModel || kieVideoModel),
      apiKeyEnv: kie?.env,
      imageModel: kieImageModel,
      videoModel: kieVideoModel,
      message: kie
        ? kieVideoModel
          ? `Images via ${kieImageModel}, video via ${kieVideoModel}.`
          : `Images via ${kieImageModel}. Set AI_KIE_VIDEO_MODEL (e.g. a Veo/Kling model) to enable video.`
        : "Set KIE_API_KEY to enable Kie.ai image and video models.",
    },
    {
      id: "wiro",
      label: "Wiro.ai",
      kinds: ["image", "video"],
      configured: Boolean(wiro) && Boolean(wiroImageModel || wiroVideoModel),
      apiKeyEnv: wiro?.env,
      imageModel: wiroImageModel,
      videoModel: wiroVideoModel,
      message: wiro
        ? wiroImageModel || wiroVideoModel
          ? `Images via ${wiroImageModel ?? "—"}, video via ${wiroVideoModel ?? "—"}.`
          : "Wiro needs an explicit model: set AI_WIRO_IMAGE_MODEL (e.g. black-forest-labs/flux-2-flex) and/or AI_WIRO_VIDEO_MODEL."
        : "Set WIRO_API_KEY (and a model) to enable Wiro image and video models.",
    },
  ];
}

/** Backends configured for one kind, in the order the operator asked for. */
export function mediaOrder(kind: MediaKind): MediaBackendStatus[] {
  const wanted = order(kind === "image" ? "AI_IMAGE_PROVIDERS" : "AI_VIDEO_PROVIDERS", [
    "google",
    "xai",
    "kie",
    "wiro",
  ]);
  const all = mediaBackends();
  const picked: MediaBackendStatus[] = [];
  for (const id of wanted) {
    const backend = all.find((entry) => entry.id === id);
    if (backend && backend.configured && backend.kinds.includes(kind)) picked.push(backend);
  }
  return picked;
}

/* -------------------------------------------------------------------------- */
/* Result                                                                      */
/* -------------------------------------------------------------------------- */

export interface MediaResult {
  kind: MediaKind;
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

/* -------------------------------------------------------------------------- */
/* Google Gemini — image                                                       */
/* -------------------------------------------------------------------------- */

const GOOGLE_BASE = () => (env("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");

async function googleImage(opts: { prompt: string; signal: AbortSignal }): Promise<MediaResult> {
  const key = firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY");
  if (!key) throw apiError("image_backend_not_configured", { message: "GEMINI_API_KEY is not set." });
  const model = env("AI_GEMINI_IMAGE_MODEL") ?? "gemini-2.5-flash-image";
  const started = Date.now();

  const res = await fetch(`${GOOGLE_BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key.value },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]),
    cache: "no-store",
  });

  if (!res.ok) throw failed(res.status, await readUpstreamError(res), "Google Gemini");

  const json = (await readJson(res)) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[] } }[];
    error?: { message?: string };
  };

  const urls: string[] = [];
  for (const candidate of json?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data) {
        urls.push(`data:${inline.mimeType ?? "image/png"};base64,${inline.data}`);
      }
    }
  }
  if (urls.length === 0) {
    const text = json?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join(" ");
    throw apiError("invalid_response", {
      message: text
        ? `Gemini returned text instead of an image: ${String(text).slice(0, 160)}`
        : "Gemini returned no image. The model may not be an image-output model.",
    });
  }

  return {
    kind: "image",
    urls,
    model,
    provider: "google",
    providerLabel: "Google Gemini",
    waitedMs: Date.now() - started,
  };
}

/* -------------------------------------------------------------------------- */
/* xAI — image (OpenAI shape) and video (native async)                         */
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

async function xaiVideo(opts: { prompt: string; signal: AbortSignal; deadlineMs: number }): Promise<MediaResult> {
  const key = firstEnv("XAI_API_KEY");
  if (!key) throw apiError("video_backend_not_configured", { message: "XAI_API_KEY is not set." });
  const model = env("AI_XAI_VIDEO_MODEL") ?? "grok-imagine-video-1.5-lite";
  const started = Date.now();
  const deadline = started + opts.deadlineMs;

  const create = await fetch(`${XAI_BASE()}/videos/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.value}` },
    body: JSON.stringify({ model, prompt: opts.prompt }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]),
    cache: "no-store",
  });
  if (!create.ok) throw failed(create.status, await readUpstreamError(create), "xAI");

  const created = (await readJson(create)) as { request_id?: string; id?: string };
  const requestId = created?.request_id ?? created?.id;
  if (!requestId) throw apiError("invalid_response", { message: "xAI did not return a request id." });

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const poll = await fetch(`${XAI_BASE()}/videos/${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${key.value}` },
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]),
      cache: "no-store",
    });
    if (!poll.ok) continue;
    const body = (await readJson(poll)) as { status?: string; video?: { url?: string }; url?: string };
    const url = body?.video?.url ?? body?.url;
    if (body?.status === "done" && url) {
      return {
        kind: "video",
        urls: [url],
        model,
        provider: "xai",
        providerLabel: "xAI",
        waitedMs: Date.now() - started,
        meta: { requestId },
      };
    }
    if (body?.status === "failed" || body?.status === "expired") {
      throw apiError("upstream_unavailable", { message: `xAI video ${body.status}.`, details: `request ${requestId}` });
    }
  }
  throw apiError("upstream_timeout", {
    message: "The xAI render is still running. Try again in a moment.",
    details: `request ${requestId}`,
    retryable: true,
  });
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
  kind: MediaKind;
  prompt: string;
  signal: AbortSignal;
  deadlineMs: number;
}): Promise<MediaResult> {
  const key = firstEnv("KIE_API_KEY", "KIEAI_API_KEY");
  if (!key) throw apiError("not_configured", { message: "KIE_API_KEY is not set." });
  const model =
    opts.kind === "image" ? env("AI_KIE_IMAGE_MODEL") ?? "flux1-kontext" : env("AI_KIE_VIDEO_MODEL");
  if (!model) {
    throw apiError("not_configured", {
      message: "Set AI_KIE_VIDEO_MODEL to the Kie.ai video model you want (for example a Veo or Kling id from docs.kie.ai).",
    });
  }

  const input: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.kind === "image") {
    input.aspect_ratio = env("AI_KIE_IMAGE_ASPECT_RATIO") ?? "1:1";
    input.output_format = "png";
  } else {
    input.aspect_ratio = env("AI_KIE_VIDEO_ASPECT_RATIO") ?? "16:9";
  }

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
        kind: opts.kind,
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

async function wiroTask(opts: {
  kind: MediaKind;
  prompt: string;
  signal: AbortSignal;
  deadlineMs: number;
}): Promise<MediaResult> {
  const model = opts.kind === "image" ? env("AI_WIRO_IMAGE_MODEL") : env("AI_WIRO_VIDEO_MODEL");
  if (!model) {
    throw apiError("not_configured", {
      message:
        opts.kind === "image"
          ? "Set AI_WIRO_IMAGE_MODEL (owner/model slug from wiro.ai, e.g. black-forest-labs/flux-2-flex)."
          : "Set AI_WIRO_VIDEO_MODEL (owner/model slug from wiro.ai, e.g. an owner/video-model id).",
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
        kind: opts.kind,
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
  const backends = mediaOrder("image");
  if (backends.length === 0) return null;

  let firstError: ApiError | null = null;
  for (const backend of backends) {
    try {
      const result =
        backend.id === "google"
          ? await googleImage({ prompt: opts.prompt, signal: opts.signal })
          : backend.id === "xai"
            ? await xaiImage({ prompt: opts.prompt, size: opts.size, signal: opts.signal })
            : backend.id === "kie"
              ? await kieTask({ kind: "image", prompt: opts.prompt, signal: opts.signal, deadlineMs: 110_000 })
              : await wiroTask({ kind: "image", prompt: opts.prompt, signal: opts.signal, deadlineMs: 110_000 });
      logServerEvent({
        requestId: `media-image-${backend.id}`,
        route: "media:image",
        status: 200,
        model: result.model,
        durationMs: result.waitedMs,
      });
      return result;
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : apiError("internal");
      logServerEvent({
        requestId: `media-image-${backend.id}`,
        route: "media:image",
        code: apiErr.code,
        detail: `${backend.label}: ${apiErr.details ?? apiErr.message}`.slice(0, 180),
        durationMs: Date.now(),
      });
      if (!firstError) firstError = apiErr;
    }
  }
  throw firstError ?? apiError("image_backend_not_configured");
}

/** Same for video: `AI_VIDEO_PROVIDERS` order, first success wins. */
export async function generateVideoViaMedia(opts: {
  prompt: string;
  signal: AbortSignal;
  deadlineMs?: number;
}): Promise<MediaResult | null> {
  const backends = mediaOrder("video");
  if (backends.length === 0) return null;

  const deadlineMs = opts.deadlineMs ?? 110_000;
  let firstError: ApiError | null = null;
  for (const backend of backends) {
    try {
      const result =
        backend.id === "xai"
          ? await xaiVideo({ prompt: opts.prompt, signal: opts.signal, deadlineMs })
          : backend.id === "kie"
            ? await kieTask({ kind: "video", prompt: opts.prompt, signal: opts.signal, deadlineMs })
            : await wiroTask({ kind: "video", prompt: opts.prompt, signal: opts.signal, deadlineMs });
      logServerEvent({
        requestId: `media-video-${backend.id}`,
        route: "media:video",
        status: 200,
        model: result.model,
        durationMs: result.waitedMs,
      });
      return result;
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : apiError("internal");
      logServerEvent({
        requestId: `media-video-${backend.id}`,
        route: "media:video",
        code: apiErr.code,
        detail: `${backend.label}: ${apiErr.details ?? apiErr.message}`.slice(0, 180),
        durationMs: Date.now(),
      });
      if (!firstError) firstError = apiErr;
    }
  }
  throw firstError ?? apiError("video_backend_not_configured");
}
