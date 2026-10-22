import "server-only";

import { apiError } from "../errors";
import type { ProviderConfig } from "./types";

/**
 * Minimal OpenAI-compatible HTTP client.
 *
 * Every provider in the registry speaks `POST {baseUrl}/chat/completions`; the
 * only real-world deviations we support are:
 *
 *   - `max_completion_tokens` instead of `max_tokens` (newer OpenAI models);
 *   - a model-id suffix for web grounding (e.g. OpenRouter's `:online`);
 *   - image generation through `/images/generations` (OpenAI, OmniRoute, …)
 *     or through `/chat/completions` with `modalities: ["image","text"]`
 *     (OpenRouter's documented image route).
 *
 * No provider-specific SDK is used, so any endpoint that implements the OpenAI
 * wire format works by adding it to `AI_PROVIDERS`.
 */

export interface UpstreamTextPart {
  type: "text";
  text: string;
}

export interface UpstreamImagePart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type UpstreamContentPart = UpstreamTextPart | UpstreamImagePart;

export interface UpstreamMessage {
  role: "system" | "user" | "assistant";
  content: string | UpstreamContentPart[];
}

export interface ChatPayload {
  model: string;
  messages: UpstreamMessage[];
  stream: boolean;
  maxTokens?: number;
  maxCompletionTokens?: boolean;
  temperature?: number;
  /** Ask the provider to emit a final usage block in the stream. */
  includeUsage?: boolean;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function requestHeaders(provider: ProviderConfig, accept: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: accept,
    Authorization: `Bearer ${provider.apiKey ?? ""}`,
    ...provider.headers,
  };
}

/** Wraps fetch so a network failure becomes an ApiError we can classify. */
async function send(
  url: string,
  init: RequestInit,
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...init, signal, cache: "no-store", redirect: "follow" });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError") throw apiError("upstream_timeout");
    if (name === "AbortError") throw apiError("upstream_timeout", { message: "The request was stopped." });
    return Promise.reject(apiError("upstream_unavailable"));
  }
}

export function buildChatBody(payload: ChatPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: payload.model,
    messages: payload.messages,
    stream: payload.stream,
  };
  if (payload.maxTokens !== undefined) {
    if (payload.maxCompletionTokens) body.max_completion_tokens = payload.maxTokens;
    else body.max_tokens = payload.maxTokens;
  }
  if (payload.temperature !== undefined) body.temperature = payload.temperature;
  if (payload.stream && payload.includeUsage) body.stream_options = { include_usage: true };
  return body;
}

export async function postChatCompletion(
  provider: ProviderConfig,
  payload: ChatPayload,
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  return send(
    joinUrl(provider.baseUrl, "/chat/completions"),
    {
      method: "POST",
      headers: requestHeaders(provider, payload.stream ? "text/event-stream" : "application/json"),
      body: JSON.stringify(buildChatBody(payload)),
    },
    opts,
  );
}

/** Image generation via the OpenAI `/images/generations` endpoint. */
export async function postImageGeneration(
  provider: ProviderConfig,
  payload: { model: string; prompt: string; size?: string; n?: number },
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  return send(
    joinUrl(provider.baseUrl, "/images/generations"),
    {
      method: "POST",
      headers: requestHeaders(provider, "application/json"),
      body: JSON.stringify({
        model: payload.model,
        prompt: payload.prompt,
        size: payload.size ?? "1024x1024",
        n: Math.min(Math.max(payload.n ?? 1, 1), 4),
      }),
    },
    opts,
  );
}

/**
 * Image generation through chat completions with `modalities: ["image","text"]`.
 * This is how OpenRouter (and several gateways) serve image models.
 */
export async function postChatImageGeneration(
  provider: ProviderConfig,
  payload: { model: string; prompt: string; n?: number },
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  return send(
    joinUrl(provider.baseUrl, "/chat/completions"),
    {
      method: "POST",
      headers: requestHeaders(provider, "application/json"),
      body: JSON.stringify({
        model: payload.model,
        messages: [{ role: "user", content: payload.prompt }],
        modalities: ["image", "text"],
        n: Math.min(Math.max(payload.n ?? 1, 1), 4),
      }),
    },
    opts,
  );
}

/** Reads at most `limit` characters of an upstream error body, with keys redacted. */
export async function readUpstreamError(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 2_000);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } | unknown; message?: unknown };
      const candidate =
        typeof parsed.error === "object" && parsed.error !== null
          ? (parsed.error as { message?: unknown }).message
          : (typeof parsed.error === "string" ? parsed.error : undefined);
      const message = typeof candidate === "string" ? candidate : typeof parsed.message === "string" ? parsed.message : text;
      return redact(String(message)).slice(0, 300);
    } catch {
      return redact(text).slice(0, 300);
    }
  } catch {
    return "";
  }
}

/** Removes anything that looks like a credential from a diagnostic string. */
export function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}
