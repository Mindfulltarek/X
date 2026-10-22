"use client";

/**
 * Browser → X AI API helpers.
 *
 * The browser only ever calls this site's own /api routes (relative URLs).
 * It never learns the gateway URL or key.
 */

import type {
  ChatStreamEvent,
  GenerateImageResponse,
  HealthResponse,
  ModelsResponse,
} from "@/lib/types";

export class ClientApiError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(message: string, opts: { code?: string; retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = "ClientApiError";
    this.code = opts.code ?? "internal";
    this.retryable = opts.retryable ?? false;
    this.status = opts.status ?? 500;
  }
}

async function readError(res: Response): Promise<ClientApiError> {
  let message = `Request failed (HTTP ${res.status}).`;
  let code = "internal";
  let retryable = res.status >= 500;
  try {
    const body = (await res.json()) as { message?: unknown; code?: unknown; retryable?: unknown };
    if (typeof body.message === "string") message = body.message;
    if (typeof body.code === "string") code = body.code;
    if (typeof body.retryable === "boolean") retryable = body.retryable;
  } catch {
    /* keep the generic message */
  }
  return new ClientApiError(message, { code, retryable, status: res.status });
}

export async function fetchHealth(opts: { signal?: AbortSignal } = {}): Promise<HealthResponse> {
  const res = await fetch("/api/health", { cache: "no-store", signal: opts.signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as HealthResponse;
}

export async function fetchModels(opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ModelsResponse> {
  const res = await fetch(`/api/models${opts.refresh ? "?refresh=1" : ""}`, {
    cache: "no-store",
    signal: opts.signal,
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ModelsResponse;
}

export interface MediaBackendInfo {
  id: string;
  label: string;
  configured: boolean;
  apiKeyEnv?: string;
  imageModel?: string;
  videoModel?: string;
  message: string;
}

export interface ImageBackendStatus {
  configured: boolean;
  backend: string | null;
  model?: string;
  models?: string[];
  message: string;
  gatewayConfigured: boolean;
  providers?: MediaBackendInfo[];
}

export async function fetchImageBackend(opts: { signal?: AbortSignal } = {}): Promise<ImageBackendStatus> {
  const res = await fetch("/api/generate-image", { cache: "no-store", signal: opts.signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ImageBackendStatus;
}

export interface VideoBackendStatus {
  configured: boolean;
  backend: string | null;
  providerLabel?: string;
  apiKeyEnv?: string;
  resolution: string;
  maxSeconds: number;
  message: string;
  providers?: MediaBackendInfo[];
}

export async function fetchVideoBackend(opts: { signal?: AbortSignal } = {}): Promise<VideoBackendStatus> {
  const res = await fetch("/api/generate-video", { cache: "no-store", signal: opts.signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as VideoBackendStatus;
}

export interface ChatRequest {
  mode: "chat" | "image-to-prompt";
  model: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Images and documents for the current turn. */
  attachments?: { name: string; mime: string; dataUrl: string }[];
  chatId?: string;
}

/**
 * Streams a chat answer. Resolves when the stream ends; `onEvent` receives every
 * meta/delta/done/error frame. Throws ClientApiError only when the request could
 * not be started at all (errors after that arrive as `error` events).
 */
export async function streamChat(
  request: ChatRequest,
  handlers: {
    onEvent: (event: ChatStreamEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, stream: true }),
      signal: handlers.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    throw new ClientApiError("Could not reach the X AI server. Check your connection and try again.", {
      code: "network",
      retryable: true,
    });
  }

  if (!res.ok) throw await readError(res);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    // Defensive: the route should always stream, but never hang the UI.
    throw new ClientApiError("The server returned an unexpected response.", { code: "invalid_response", retryable: true });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const chunk = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            handlers.onEvent(JSON.parse(payload) as ChatStreamEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    throw new ClientApiError("The answer stream was interrupted. Try again.", {
      code: "stream_interrupted",
      retryable: true,
    });
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

export async function generateImage(request: {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
}): Promise<GenerateImageResponse> {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as GenerateImageResponse;
}
