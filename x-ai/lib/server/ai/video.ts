import "server-only";

import { z } from "zod";

import { ApiError, apiError, logServerEvent } from "../errors";
import { postChatCompletion, readUpstreamError } from "./client";
import type { RegistrySnapshot } from "./registry";
import { extractFullContent, parseJsonLoose } from "./parse";
import { generateVideoViaMedia, mediaOrder, type MediaBackendStatus } from "./media";
import type { ModelRef, ProviderState } from "./types";

/**
 * Video backend — JSON2Video.
 *
 * JSON2Video is **not** a text-to-video model: it renders an MP4 from a JSON
 * "movie" description (scenes, text elements, media, timing). So the pipeline
 * here is:
 *
 *   1. a normal chat model turns the user's prompt into a storyboard
 *      (short scenes of text, optional title) — a second model is tried if the
 *      first fails, and a deterministic storyboard is used if no model is
 *      reachable at all;
 *   2. the storyboard is compiled to the documented Movie JSON;
 *   3. `POST /v2/movies` starts an asynchronous render that returns a project id;
 *   4. `GET /v2/movies?project=…` is polled until the render is `done`/`error`.
 *
 * Documented contract (json2video.com/docs/v2):
 *   - headers: `x-api-key`, `Content-Type: application/json`
 *   - POST https://api.json2video.com/v2/movies  → { success, project, timestamp }
 *   - GET  https://api.json2video.com/v2/movies?project={id}
 *        → { success, movie: { status: queued|running|done|error|timeout,
 *                              url, duration, size: { width, height }, message } }
 *   - resolution enum: sd | hd | full-hd | squared | instagram-story |
 *     instagram-feed | twitter-landscape | twitter-portrait | custom
 *   - body limit 2 MB; 401 = bad key or render quota exhausted; 500 = retry.
 *
 * Nothing is ever returned unless it came from the real backend.
 */

const DEFAULT_API_BASE = "https://api.json2video.com/v2/movies";

/** Which env var the key was found in (never the key itself). */
function apiKeySource(): { value: string; env: string } | null {
  for (const name of ["JSON2VIDEO_API_KEY", "J2V_API_KEY"]) {
    const value = process.env[name]?.trim();
    if (value) return { value, env: name };
  }
  return null;
}

function apiBase(): string {
  // `JSON2VIDEO_BASE_URL` exists for tests (a local mock) and self-hosted proxies.
  return (process.env.JSON2VIDEO_BASE_URL ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const RESOLUTIONS = [
  "sd",
  "hd",
  "full-hd",
  "squared",
  "instagram-story",
  "instagram-feed",
  "twitter-landscape",
  "twitter-portrait",
] as const;
type Resolution = (typeof RESOLUTIONS)[number];

function resolution(): Resolution {
  const raw = (process.env.AI_VIDEO_RESOLUTION ?? "hd").trim().toLowerCase();
  return (RESOLUTIONS as readonly string[]).includes(raw) ? (raw as Resolution) : "hd";
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export interface VideoBackendStatus {
  configured: boolean;
  backend: string | null;
  providerLabel: string;
  apiKeyEnv?: string;
  resolution: Resolution;
  maxSeconds: number;
  message: string;
}

/**
 * Which video backend answers first. `json2video` keeps its storyboard pipeline;
 * `xai` / `kie` / `wiro` are real text-to-video models and take the prompt as-is.
 */
export function videoOrder(): string[] {
  const raw = process.env.AI_VIDEO_PROVIDERS;
  const list = (raw ?? "json2video,xai,kie,wiro")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : ["json2video", "xai", "kie", "wiro"];
}

export function videoBackendStatus(): VideoBackendStatus {
  const key = apiKeySource();
  const disabled = ["0", "false", "off"].includes((process.env.AI_VIDEO_ENABLED ?? "").trim().toLowerCase());
  const maxSeconds = envNumber("AI_VIDEO_MAX_SECONDS", 20, 3, 120);
  const res = resolution();

  if (disabled) {
    return {
      configured: false,
      backend: null,
      providerLabel: "Video",
      resolution: res,
      maxSeconds,
      message: "Video generation is switched off (AI_VIDEO_ENABLED=0).",
    };
  }

  const media = mediaOrder("video");
  const first = videoOrder().find(
    (id) => (id === "json2video" && key) || media.some((entry: MediaBackendStatus) => entry.id === id),
  );

  if (first === "json2video" && key) {
    return {
      configured: true,
      backend: "json2video",
      providerLabel: "JSON2Video",
      apiKeyEnv: key.env,
      resolution: res,
      maxSeconds,
      message: `Video renders through JSON2Video (${res}, up to ${maxSeconds}s per video).`,
    };
  }

  const mediaFirst = media.find((entry) => entry.id === first);
  if (mediaFirst) {
    return {
      configured: true,
      backend: mediaFirst.id,
      providerLabel: mediaFirst.label,
      apiKeyEnv: mediaFirst.apiKeyEnv,
      resolution: res,
      maxSeconds,
      message: `${mediaFirst.label}: ${mediaFirst.message}`,
    };
  }

  const missing = mediaOrder("video").length === 0 ? "" : "";
  return {
    configured: false,
    backend: null,
    providerLabel: "Video",
    resolution: res,
    maxSeconds,
    message: `${missing}Video generation is not configured. Add JSON2VIDEO_API_KEY (json2video.com), or XAI_API_KEY / KIE_API_KEY / WIRO_API_KEY, then redeploy.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Storyboard                                                                  */
/* -------------------------------------------------------------------------- */

const sceneSchema = z.object({
  text: z.string().trim().min(1).max(240),
  /** Seconds; clamped later. */
  duration: z.number().optional(),
  /** Optional hex background for this scene. */
  background: z.string().optional(),
});

const storyboardSchema = z.object({
  title: z.string().trim().max(90).optional(),
  scenes: z.array(sceneSchema).min(1).max(8),
});

export interface StoryboardScene {
  text: string;
  duration: number;
  background: string;
}

export interface Storyboard {
  title?: string;
  scenes: StoryboardScene[];
  /** How the storyboard was produced — shown to the user, so be exact. */
  source: "model" | "prompt";
  author?: string;
}

const PALETTE = ["#0B1220", "#111C33", "#1B1030", "#0E1F1B", "#241019", "#0A1526"];

/** Last-resort storyboard: the user's own words, split into readable beats. */
function fallbackStoryboard(prompt: string, maxSeconds: number): Storyboard {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const sentences = cleaned
    .split(/(?<=[.!?،؛])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const beats: string[] = [];
  for (const sentence of sentences.length ? sentences : [cleaned]) {
    if (sentence.length <= 120) {
      beats.push(sentence);
      continue;
    }
    // Break long sentences into ~110-character chunks on word boundaries.
    let rest = sentence;
    while (rest.length > 0 && beats.length < 8) {
      const cut = rest.lastIndexOf(" ", 110);
      const size = cut > 40 ? cut : Math.min(110, rest.length);
      beats.push(rest.slice(0, size).trim());
      rest = rest.slice(size).trim();
    }
  }

  const picked = beats.slice(0, 5);
  const perScene = Math.max(3, Math.min(8, Math.floor(maxSeconds / Math.max(1, picked.length))));
  return {
    scenes: picked.map((text, index) => ({
      text,
      duration: perScene,
      background: PALETTE[index % PALETTE.length],
    })),
    source: "prompt",
  };
}

const STORYBOARD_SYSTEM = `You turn a request into a short video storyboard.
Reply with ONE JSON object and nothing else. No markdown, no commentary.

Schema:
{"title":"optional short title","scenes":[{"text":"on-screen line","duration":4,"background":"#0B1220"}]}

Rules:
- 1 to 6 scenes. "duration" is seconds (2-8). Total must stay within the limit given by the user.
- "text" is what appears ON SCREEN: short, punchy, at most 12 words. Not narration.
- "background" is an optional 6-digit hex colour that suits the scene.
- Keep the user's language. No emojis.`;

function storyboardUserPrompt(prompt: string, maxSeconds: number): string {
  return `Request: ${prompt}\n\nHard limit: the total of all scene durations must not exceed ${maxSeconds} seconds.`;
}

/** Ask one chat model for a storyboard; returns null when it is unusable. */
async function askModelForStoryboard(opts: {
  prompt: string;
  maxSeconds: number;
  snapshot: RegistrySnapshot;
  signal: AbortSignal;
}): Promise<{ storyboard: Storyboard; author: string } | null> {
  const candidates: { model: ModelRef; provider: ProviderState }[] = [];
  for (const model of opts.snapshot.models) {
    if (model.capabilities.has("image-gen")) continue;
    const provider = opts.snapshot.providers.find((p) => p.config.id === model.providerId);
    if (!provider || provider.status !== "ok" || !provider.config.apiKey) continue;
    candidates.push({ model, provider });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const fastA = a.model.capabilities.has("fast") ? 1 : 0;
    const fastB = b.model.capabilities.has("fast") ? 1 : 0;
    if (fastA !== fastB) return fastB - fastA;
    return a.model.priority - b.model.priority;
  });

  for (const { model, provider } of candidates.slice(0, 2)) {
    try {
      const res = await postChatCompletion(
        provider.config,
        {
          model: model.modelId,
          messages: [
            { role: "system", content: STORYBOARD_SYSTEM },
            { role: "user", content: storyboardUserPrompt(opts.prompt, opts.maxSeconds) },
          ],
          stream: false,
          maxTokens: 700,
          maxCompletionTokens: model.maxCompletionTokens,
          temperature: 0.4,
        },
        { signal: opts.signal, timeoutMs: 45_000 },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const content = extractFullContent(json);
      const parsed = parseJsonLoose<unknown>(content);
      const checked = storyboardSchema.safeParse(parsed);
      if (!checked.success) continue;

      const scenes = checked.data.scenes.slice(0, 6).map((scene, index) => ({
        text: scene.text,
        duration: Math.min(8, Math.max(2, Math.round(scene.duration ?? 4))),
        background:
          scene.background && /^#[0-9a-f]{6}$/i.test(scene.background)
            ? scene.background
            : PALETTE[index % PALETTE.length],
      }));
      return {
        storyboard: { title: checked.data.title, scenes, source: "model", author: model.modelId },
        author: model.modelId,
      };
    } catch (err) {
      logServerEvent({
        requestId: `video-storyboard-${model.providerId}`,
        route: "video:storyboard",
        code: err instanceof ApiError ? err.code : "internal",
        detail: `storyboard model ${model.modelId}`,
      });
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Movie JSON                                                                  */
/* -------------------------------------------------------------------------- */

interface TextElement {
  type: "text";
  text: string;
  settings: Record<string, string>;
}

interface MovieScene {
  duration: number;
  "background-color": string;
  elements: TextElement[];
}

export interface MovieJson {
  resolution: string;
  quality: "low" | "medium" | "high";
  fps: number;
  scenes: MovieScene[];
  /** Hyphenated on purpose: JSON2Video documents `client-data`. */
  "client-data": Record<string, unknown>;
}

function textElement(text: string, size: string): TextElement {
  return {
    type: "text",
    text,
    settings: {
      "font-family": "Poppins",
      "font-size": size,
      "font-weight": "700",
      color: "#FFFFFF",
      "text-align": "center",
      "vertical-position": "center",
      "horizontal-position": "center",
      "padding-left": "8%",
      "padding-right": "8%",
      "line-height": "1.25",
      "text-shadow": "0 2px 24px rgba(0,0,0,0.55)",
    },
  };
}

/** Compile a storyboard to the documented Movie JSON, within the second cap. */
export function buildMovie(storyboard: Storyboard, opts: { maxSeconds: number }): MovieJson {
  const scenes: MovieScene[] = [];
  let remaining = opts.maxSeconds;

  if (storyboard.title) {
    const titleSeconds = Math.min(4, Math.max(2, Math.floor(opts.maxSeconds / 5) || 2));
    scenes.push({
      duration: titleSeconds,
      "background-color": "#050A16",
      elements: [textElement(storyboard.title, "84px")],
    });
    remaining -= titleSeconds;
  }

  for (const scene of storyboard.scenes) {
    if (remaining < 2) break;
    const duration = Math.min(scene.duration, remaining);
    scenes.push({
      duration,
      "background-color": scene.background,
      elements: [textElement(scene.text, "64px")],
    });
    remaining -= duration;
  }

  if (scenes.length === 0) {
    scenes.push({
      duration: Math.min(5, opts.maxSeconds),
      "background-color": PALETTE[0],
      elements: [textElement("No content", "64px")],
    });
  }

  return {
    resolution: resolution(),
    quality: "medium",
    fps: 25,
    "client-data": { source: "x-ai", kind: "storyboard" },
    scenes,
  };
}

/* -------------------------------------------------------------------------- */
/* JSON2Video API                                                              */
/* -------------------------------------------------------------------------- */

interface MovieStatus {
  status?: string;
  url?: string;
  duration?: number;
  size?: { width: number; height: number };
  message?: string;
}

function authHeaders(): Record<string, string> {
  const key = apiKeySource();
  if (!key) throw apiError("not_configured", { message: videoBackendStatus().message });
  return { "x-api-key": key.value, "Content-Type": "application/json", Accept: "application/json" };
}

async function createMovie(movie: MovieJson, signal: AbortSignal): Promise<string> {
  const body = JSON.stringify(movie);
  if (body.length > 2_000_000) {
    throw apiError("payload_too_large", {
      message: "That video request is too detailed for the renderer. Try a shorter prompt.",
    });
  }

  const res = await fetch(apiBase(), {
    method: "POST",
    headers: authHeaders(),
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await readUpstreamError(res);
    if (res.status === 401 || res.status === 403) {
      throw apiError("unauthorized_upstream", {
        message:
          "JSON2Video rejected the API key, or your render quota is exhausted. Check JSON2VIDEO_API_KEY and your plan.",
        details: detail,
      });
    }
    if (res.status === 413) {
      throw apiError("payload_too_large", {
        message: "The generated movie is too large for the renderer. Try a shorter request.",
        details: detail,
      });
    }
    if (res.status === 429) throw apiError("rate_limited_upstream", { details: detail });
    throw apiError("upstream_unavailable", {
      message: "The video renderer could not start the render. Please try again.",
      details: detail,
    });
  }

  const json = (await res.json()) as { project?: unknown; success?: unknown };
  const project = typeof json.project === "string" ? json.project : "";
  if (!project) {
    throw apiError("invalid_response", { message: "The video renderer did not return a project id." });
  }
  return project;
}

async function fetchMovie(project: string, signal: AbortSignal): Promise<MovieStatus> {
  const url = `${apiBase()}?project=${encodeURIComponent(project)}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await readUpstreamError(res);
    if (res.status === 401 || res.status === 403) {
      throw apiError("unauthorized_upstream", {
        message: "JSON2Video rejected the API key while checking the render.",
        details: detail,
      });
    }
    throw apiError("upstream_unavailable", { details: detail });
  }
  const json = (await res.json()) as { movie?: MovieStatus };
  return json.movie ?? {};
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export interface VideoResult {
  status: "done" | "pending";
  provider: string;
  providerLabel: string;
  model?: string;
  /** Present when status === "done". */
  url?: string;
  durationSeconds?: number;
  size?: { width: number; height: number };
  project: string;
  /** Absent when polling an existing project without the original storyboard. */
  storyboard?: Storyboard;
  resolution: Resolution;
  /** Total wall-clock spent polling. */
  waitedMs: number;
}

export async function generateVideo(opts: {
  prompt: string;
  snapshot: RegistrySnapshot;
  signal: AbortSignal;
  /** Hard ceiling for the whole request; the render keeps going after this. */
  deadlineMs?: number;
  /** Skip model authoring and use a fixed storyboard (tests). */
  storyboard?: Storyboard;
}): Promise<VideoResult> {
  const status = videoBackendStatus();
  if (!status.configured) {
    throw apiError("video_backend_not_configured", { message: status.message });
  }

  const started = Date.now();
  const deadline = started + (opts.deadlineMs ?? 55_000);

  // Real text-to-video models (xAI / Kie / Wiro) take the prompt directly — no
  // storyboard needed. Only used when they come before json2video in the order.
  if (status.backend !== "json2video" && mediaOrder("video").length > 0) {
    const media = await generateVideoViaMedia({
      prompt: opts.prompt,
      signal: opts.signal,
      deadlineMs: Math.max(20_000, deadline - Date.now()),
    });
    if (media) {
      return {
        status: "done",
        provider: media.provider,
        providerLabel: media.providerLabel,
        model: media.model,
        url: media.urls[0],
        project: String(media.meta?.requestId ?? media.meta?.taskId ?? ""),
        resolution: status.resolution,
        waitedMs: media.waitedMs,
      };
    }
  }

  const authored = opts.storyboard
    ? { storyboard: opts.storyboard }
    : await askModelForStoryboard({
        prompt: opts.prompt,
        maxSeconds: status.maxSeconds,
        snapshot: opts.snapshot,
        signal: opts.signal,
      });

  const storyboard = authored?.storyboard ?? fallbackStoryboard(opts.prompt, status.maxSeconds);
  const movie = buildMovie(storyboard, { maxSeconds: status.maxSeconds });
  const project = await createMovie(movie, opts.signal);

  let lastStatus: MovieStatus = { status: "queued" };
  while (Date.now() < deadline) {
    if (opts.signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    try {
      lastStatus = await fetchMovie(project, opts.signal);
    } catch (err) {
      // A transient status error must not lose a render that is still running.
      if (err instanceof ApiError && !err.retryable) throw err;
      continue;
    }
    if (lastStatus.status === "done") {
      if (!lastStatus.url) {
        throw apiError("invalid_response", { message: "The render finished without a video URL." });
      }
      return {
        status: "done",
        provider: "json2video",
        providerLabel: "JSON2Video",
        model: "json2video",
        url: lastStatus.url,
        durationSeconds: lastStatus.duration ?? Math.round(movie.scenes.reduce((sum, s) => sum + s.duration, 0)),
        size: lastStatus.size,
        project,
        storyboard,
        resolution: status.resolution,
        waitedMs: Date.now() - started,
      };
    }
    if (lastStatus.status === "error" || lastStatus.status === "timeout") {
      throw apiError("upstream_unavailable", {
        message: lastStatus.message
          ? `The video renderer failed: ${lastStatus.message}`
          : "The video renderer failed to produce the video.",
        details: `json2video status=${lastStatus.status}`,
      });
    }
  }

  // Still rendering: hand the project id back so the client can keep polling.
  return {
    status: "pending",
    provider: "json2video",
    providerLabel: "JSON2Video",
    model: "json2video",
    project,
    storyboard,
    resolution: status.resolution,
    waitedMs: Date.now() - started,
  };
}

/** Continue polling an existing render (used by GET /api/generate-video). */
export async function pollVideo(opts: {
  project: string;
  signal: AbortSignal;
  storyboard?: Storyboard;
}): Promise<VideoResult> {
  const status = videoBackendStatus();
  if (!status.configured) {
    throw apiError("video_backend_not_configured", { message: status.message });
  }

  const started = Date.now();
  const deadline = started + 55_000;
  let last: MovieStatus = {};
  while (Date.now() < deadline) {
    last = await fetchMovie(opts.project, opts.signal);
    if (last.status === "done" && last.url) {
      return {
        status: "done",
        provider: "json2video",
        providerLabel: "JSON2Video",
        model: "json2video",
        url: last.url,
        durationSeconds: last.duration,
        size: last.size,
        project: opts.project,
        storyboard: opts.storyboard,
        resolution: status.resolution,
        waitedMs: Date.now() - started,
      };
    }
    if (last.status === "error" || last.status === "timeout") {
      throw apiError("upstream_unavailable", {
        message: last.message
          ? `The video renderer failed: ${last.message}`
          : "The video renderer failed to produce the video.",
        details: `json2video status=${last.status}`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  return {
    status: "pending",
    provider: "json2video",
    providerLabel: "JSON2Video",
    model: "json2video",
    project: opts.project,
    storyboard: opts.storyboard,
    resolution: status.resolution,
    waitedMs: Date.now() - started,
  };
}
