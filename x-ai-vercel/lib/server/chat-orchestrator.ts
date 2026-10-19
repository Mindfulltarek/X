import "server-only";

import type {
  ChatMessagePayload,
  ChatStreamEvent,
  OperationMode,
  PublicModel,
} from "@/lib/types";
import { getServerConfig, type ServerConfig } from "./config";
import {
  classifyUpstreamStatus,
  findModel,
  gatewayFetch,
  safeUpstreamSnippet,
  type ModelCatalog,
} from "./gateway";
import { ApiError, apiError } from "./errors";
import {
  GENERAL_CHAT_SYSTEM,
  IMAGE_PROMPT_DEFAULT_INSTRUCTION,
  IMAGE_PROMPT_FOLLOWUP_INSTRUCTION,
  IMAGE_TO_PROMPT_SYSTEM,
} from "./prompts";

/**
 * Chat orchestration: model selection, capability checks, guarded fallback,
 * upstream streaming, and SSE framing for the browser.
 *
 * Fallback policy (per the brief):
 *  - Prefer OmniRoute's own routing (`auto`, `auto/vision`) when the user picks Auto.
 *  - Otherwise try an explicit, server-configured ordered list of model ids.
 *  - Retry only for retryable classes (429, 5xx, timeout, model unavailable).
 *  - Never retry 400/401/403 without a fix, never exceed the configured cap.
 *  - Never bypass provider limits: every candidate is a legitimately configured
 *    model on the operator's own gateway.
 */

export interface Candidate {
  model: string;
  reason: "selected" | "auto" | "vision-auto" | "vision-fallback" | "fallback";
}

const MAX_HISTORY_CHARS = 80_000;

/** Trims history to a sane size, always keeping the newest turns. */
export function trimHistory(messages: ChatMessagePayload[]): ChatMessagePayload[] {
  let total = 0;
  const kept: ChatMessagePayload[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    total += m.content.length;
    if (total > MAX_HISTORY_CHARS && kept.length >= 2) break;
    kept.unshift(m);
  }
  return kept;
}

function isVisionModel(model: PublicModel | undefined): boolean {
  return Boolean(model?.vision);
}

export interface CandidatePlan {
  candidates: Candidate[];
  /** Notes surfaced in the meta event so the UI can explain routing. */
  visionDowngraded: boolean;
}

/**
 * Builds the ordered candidate list.
 * Throws ApiError when the request cannot be served truthfully.
 */
export function planCandidates(opts: {
  requested: string;
  hasImage: boolean;
  catalog: ModelCatalog | null;
  cfg: ServerConfig;
}): CandidatePlan {
  const { requested, hasImage, catalog, cfg } = opts;
  const isAutoRequest = requested === "auto" || requested.startsWith("auto/");
  const candidates: Candidate[] = [];
  let visionDowngraded = false;

  if (isAutoRequest) {
    const autoModel = requested === "auto" && hasImage ? "auto/vision" : requested;
    candidates.push({ model: autoModel, reason: hasImage && autoModel === "auto/vision" ? "vision-auto" : "auto" });
  } else {
    const known = findModel(catalog, requested);
    if (catalog && !known) {
      throw apiError("model_not_found", {
        message: `"${requested}" is not in the gateway's model catalog for this key. Refresh the model list or choose Auto.`,
        retryable: false,
        status: 400,
      });
    }
    if (hasImage && known && !isVisionModel(known)) {
      // The selected model cannot read images. Only switch when a vision model
      // has been explicitly configured by the operator.
      const visionFallback =
        cfg.visionModel && cfg.visionModel !== requested
          ? catalog
            ? isVisionModel(findModel(catalog, cfg.visionModel))
              ? cfg.visionModel
              : null
            : cfg.visionModel
          : null;
      if (!visionFallback) {
        throw apiError("model_no_vision", {
          message: `"${requested}" is a text-only model. Choose a vision-capable model from the list, or use Auto so the gateway can route to auto/vision.`,
        });
      }
      candidates.push({ model: visionFallback, reason: "vision-fallback" });
      visionDowngraded = true;
    } else {
      candidates.push({ model: requested, reason: "selected" });
    }
  }

  if (catalog && candidates[0] && !candidates[0].model.startsWith("auto/")) {
    const primaryId = candidates[0].model;
    const primary = findModel(catalog, primaryId);
    if (primary && hasImage && !isVisionModel(primary)) {
      throw apiError("model_no_vision", {
        message: `"${primaryId}" is a text-only model. Choose a vision-capable model or use Auto.`,
      });
    }
  }

  // Operator-configured fallback chain.
  for (const id of cfg.fallbackModels) {
    if (candidates.some((c) => c.model === id)) continue;
    if (catalog) {
      const model = findModel(catalog, id);
      if (!model) continue; // configured but not visible to this key — skip
      if (hasImage && !isVisionModel(model)) continue;
      if (model.kind !== "chat" && model.kind !== "unknown") continue;
    }
    candidates.push({ model: id, reason: "fallback" });
  }

  // Finally, OmniRoute's own routing as a last resort (documented `auto` route).
  if (cfg.autoFallback) {
    const autoId = hasImage ? "auto/vision" : "auto";
    if (!candidates.some((c) => c.model === autoId)) {
      candidates.push({ model: autoId, reason: "fallback" });
    }
  }

  const capped = candidates.slice(0, Math.max(1, cfg.maxFallbackAttempts));
  return { candidates: capped, visionDowngraded };
}

/* -------------------------------------------------------------------------- */
/* Request body                                                               */
/* -------------------------------------------------------------------------- */

interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface UpstreamMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAIContentPart[];
}

export function buildMessages(opts: {
  mode: OperationMode;
  messages: ChatMessagePayload[];
  imageDataUrl?: string;
}): UpstreamMessage[] {
  const { mode, messages, imageDataUrl } = opts;
  const history = trimHistory(messages);
  const last = history[history.length - 1];

  let system = mode === "image-to-prompt" ? IMAGE_TO_PROMPT_SYSTEM : GENERAL_CHAT_SYSTEM;

  if (mode === "image-to-prompt") {
    if (imageDataUrl) {
      // Fresh analysis (or a re-attached reference image).
    } else if (history.some((m) => m.role === "assistant")) {
      system += `\n\n${IMAGE_PROMPT_FOLLOWUP_INSTRUCTION}`;
    }
  } else if (imageDataUrl) {
    system +=
      "\n\nThe user attached an image with this message. Describe or reason about it only from what is visible, and say when something is uncertain.";
  }

  const built: UpstreamMessage[] = [{ role: "system", content: system }];

  for (let i = 0; i < history.length; i += 1) {
    const m = history[i];
    const isLast = i === history.length - 1;
    if (isLast && m.role === "user" && imageDataUrl) {
      const text =
        m.content.trim() ||
        (mode === "image-to-prompt" ? IMAGE_PROMPT_DEFAULT_INSTRUCTION : "Describe this image.");
      built.push({
        role: "user",
        content: [
          { type: "text", text },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      });
    } else {
      built.push({ role: m.role, content: m.content });
    }
  }

  if (last && last.role === "user" && mode === "image-to-prompt" && !last.content.trim() && !imageDataUrl) {
    built[built.length - 1] = { role: "user", content: IMAGE_PROMPT_DEFAULT_INSTRUCTION };
  }

  if (mode === "chat" && last && last.role === "user" && !last.content.trim()) {
    throw apiError("invalid_payload", { message: "Please type a message before sending." });
  }

  return built;
}

/* -------------------------------------------------------------------------- */
/* Upstream call with fallback                                                */
/* -------------------------------------------------------------------------- */

export interface UpstreamSuccess {
  res: Response;
  candidate: Candidate;
  fallbackAttempts: number;
  attempted: { model: string; status: number | string }[];
}

/**
 * Calls /v1/chat/completions, walking the candidate list for retryable errors.
 * `stream` decides the upstream mode; both are real, non-simulated paths.
 */
export async function requestCompletion(opts: {
  candidates: Candidate[];
  messages: UpstreamMessage[];
  stream: boolean;
  signal: AbortSignal;
}): Promise<UpstreamSuccess> {
  const { candidates, messages, stream, signal } = opts;
  const cfg = getServerConfig();
  const attempted: { model: string; status: number | string }[] = [];
  let lastError: ApiError | null = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    let res: Response;
    try {
      res = await gatewayFetch(
        "/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            model: candidate.model,
            messages,
            stream,
          }),
        },
        {
          timeoutMs: cfg.gatewayStreamTimeoutMs,
          signal,
          headers: { Accept: stream ? "text/event-stream" : "application/json" },
        },
      );
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : apiError("upstream_unavailable");
      attempted.push({ model: candidate.model, status: apiErr.code });
      lastError = apiErr;
      if (apiErr.code === "not_configured") throw apiErr;
      if (!apiErr.retryable || i === candidates.length - 1) throw apiErr;
      continue;
    }

    if (res.ok) {
      return { res, candidate, fallbackAttempts: i, attempted };
    }

    const status = res.status;
    const detail = await safeUpstreamSnippet(res);
    const { code, retryable } = classifyUpstreamStatus(status);
    attempted.push({ model: candidate.model, status });
    lastError = apiError(code, { details: `upstream ${status}: ${detail}` });

    const isLast = i === candidates.length - 1;
    if (!retryable || isLast) {
      throw lastError;
    }
    // Small backoff before the next candidate — helps with short rate-limit windows.
    await new Promise((r) => setTimeout(r, Math.min(300 * (i + 1), 1_200)));
  }

  throw lastError ?? apiError("all_models_failed");
}

/* -------------------------------------------------------------------------- */
/* Response parsing                                                           */
/* -------------------------------------------------------------------------- */

/** Extracts text from one OpenAI-compatible stream chunk. */
export function extractStreamDelta(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  const choices = (parsed as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const choice = choices[0] as {
    delta?: { content?: unknown };
    message?: { content?: unknown };
    text?: unknown;
  };
  const value = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

export function extractFullContent(json: unknown): string {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/** The model/provider that actually answered (headers win for `auto` routing). */
export function resolveServedModel(res: Response, candidate: Candidate): { model: string; provider?: string } {
  return {
    model: res.headers.get("x-omniroute-model") ?? candidate.model,
    provider: res.headers.get("x-omniroute-provider") ?? undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* SSE framing                                                                */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

function frame(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Converts an upstream OpenAI-compatible response into our own small SSE
 * protocol ({meta, delta, done, error}). Nothing is fabricated: if the upstream
 * stream ends early, we emit an error event instead of a success.
 */
export function streamFromUpstream(opts: {
  res: Response;
  candidate: Candidate;
  fallbackAttempts: number;
  requestId: string;
  /** What the user actually asked for (before capability substitution). */
  requestedModel?: string;
  notice?: string;
}): ReadableStream<Uint8Array> {
  const { res, candidate, fallbackAttempts, requestId, requestedModel, notice } = opts;
  const served = resolveServedModel(res, candidate);
  const contentType = res.headers.get("content-type") ?? "";
  const isSse = contentType.includes("text/event-stream");

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const push = (event: ChatStreamEvent) => {
        if (!closed) controller.enqueue(frame(event));
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      push({
        type: "meta",
        requestedModel: requestedModel ?? candidate.model,
        model: served.model,
        provider: served.provider,
        fallbackAttempts,
        requestId,
        notice,
      });

      try {
        if (!isSse) {
          // Provider/gateway answered with a single JSON body despite stream:true.
          const json = (await res.json()) as unknown;
          const text = extractFullContent(json);
          if (!text) {
            push({
              type: "error",
              code: "invalid_response",
              message: "The gateway returned an empty answer.",
              retryable: true,
            });
          } else {
            push({ type: "delta", text });
            push({ type: "done", model: served.model, provider: served.provider, fallbackAttempts });
          }
          finish();
          return;
        }

        const body = res.body;
        if (!body) {
          push({ type: "error", code: "invalid_response", message: "The gateway sent no response body.", retryable: true });
          finish();
          return;
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawText = false;
        let upstreamDone = false;

        while (!upstreamDone) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
            buffer = buffer.slice(newlineIndex + 1);
            if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (data === "[DONE]") {
                upstreamDone = true;
                break;
              }
              if (data) {
                const delta = extractStreamDelta(data);
                if (delta) {
                  sawText = true;
                  push({ type: "delta", text: delta });
                }
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (!sawText) {
          push({
            type: "error",
            code: "invalid_response",
            message: "The model returned no text. Try again or choose another model.",
            retryable: true,
          });
        } else {
          push({ type: "done", model: served.model, provider: served.provider, fallbackAttempts });
        }
        // Release the upstream connection (idempotent).
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
        finish();
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        push({
          type: "error",
          code: aborted ? "upstream_timeout" : "upstream_unavailable",
          message: aborted
            ? "The response took too long and was stopped."
            : "The connection to the gateway was interrupted before the answer finished.",
          retryable: true,
        });
        finish();
      }
    },
    cancel() {
      void res.body?.cancel().catch(() => undefined);
    },
  });
}
