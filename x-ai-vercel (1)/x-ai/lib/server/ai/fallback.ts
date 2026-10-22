import "server-only";

import { ApiError, apiError, type ErrorCode } from "../errors";
import { readUpstreamError } from "./client";
import { reportModelFailure, reportModelSuccess } from "./registry";
import type { AISettings, ModelRef, ProviderState } from "./types";

/**
 * Error classification and bounded fallback.
 *
 * Policy (deliberately conservative):
 *
 *  401 / 403            auth or key problem → stop using that provider for the
 *                       rest of the request, try the next provider.
 *  402                  out of credit → same treatment as auth.
 *  404                  this model does not exist for this key → next model.
 *  422                  the model rejected the request shape (typically an image
 *                       sent to a text model) → mark it as non-vision, next model.
 *  429                  rate limit → one short retry, then next model.
 *  5xx / timeout        transient → one short retry, then next model.
 *  400 / 413 / other    our request is wrong → stop. Retrying would hide a bug.
 *
 * Total attempts are bounded by the candidate list (already capped by
 * `AI_MAX_CANDIDATES`) plus at most one same-model retry per candidate.
 */

export interface AttemptRecord {
  modelKey: string;
  model: string;
  provider: string;
  ok: boolean;
  status?: number;
  code?: string;
  latencyMs: number;
  /** Sanitised upstream message, for server logs only. */
  detail?: string;
}

export interface FallbackOutcome<T> {
  value: T;
  model: ModelRef;
  provider: ProviderState;
  attempts: AttemptRecord[];
  fallbackAttempts: number;
}

interface Classified {
  code: ErrorCode;
  /** Retry the same model once with a delay. */
  retrySame: boolean;
  /** Try another candidate. */
  nextCandidate: boolean;
  /** The whole provider is unusable for this request. */
  blockProvider: boolean;
  /** The model cannot accept images; remember it. */
  markNoVision?: boolean;
}

export function classifyFailure(status: number): Classified {
  if (status === 401) return { code: "unauthorized_upstream", retrySame: false, nextCandidate: true, blockProvider: true };
  if (status === 403) return { code: "forbidden_upstream", retrySame: false, nextCandidate: true, blockProvider: true };
  if (status === 402) return { code: "rate_limited_upstream", retrySame: false, nextCandidate: true, blockProvider: true };
  if (status === 404) return { code: "model_not_found", retrySame: false, nextCandidate: true, blockProvider: false };
  if (status === 408) return { code: "upstream_timeout", retrySame: true, nextCandidate: true, blockProvider: false };
  if (status === 413) return { code: "payload_too_large", retrySame: false, nextCandidate: false, blockProvider: false };
  if (status === 422) {
    return { code: "model_no_vision", retrySame: false, nextCandidate: true, blockProvider: false, markNoVision: true };
  }
  if (status === 429) return { code: "rate_limited_upstream", retrySame: true, nextCandidate: true, blockProvider: false };
  if (status === 400) return { code: "bad_request", retrySame: false, nextCandidate: false, blockProvider: false };
  if (status >= 500) return { code: "upstream_unavailable", retrySame: true, nextCandidate: true, blockProvider: false };
  return { code: "internal", retrySame: false, nextCandidate: true, blockProvider: false };
}

/** Wraps a non-OK upstream response into an ApiError plus its retry decision. */
export async function failureFromResponse(
  res: Response,
): Promise<{ error: ApiError; decision: Classified; detail: string }> {
  const decision = classifyFailure(res.status);
  const detail = await readUpstreamError(res);
  const error = apiError(decision.code, {
    details: `upstream ${res.status}${detail ? `: ${detail}` : ""}`,
  });
  return { error, decision, detail };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RunOptions<T> {
  candidates: ModelRef[];
  providers: Map<string, ProviderState>;
  settings: AISettings;
  signal: AbortSignal;
  /** One attempt against one model. Must throw ApiError on failure. */
  attempt: (model: ModelRef, provider: ProviderState) => Promise<T>;
  onAttempt?: (record: AttemptRecord) => void;
}

export async function runWithFallback<T>(opts: RunOptions<T>): Promise<FallbackOutcome<T>> {
  const { candidates, providers, signal, attempt, onAttempt } = opts;
  const attempts: AttemptRecord[] = [];
  const blockedProviders = new Set<string>();
  let lastError: ApiError | null = null;
  let lastDetail: string | undefined;

  const record = (entry: AttemptRecord) => {
    attempts.push(entry);
    onAttempt?.(entry);
  };

  for (let index = 0; index < candidates.length; index += 1) {
    if (signal.aborted) throw apiError("upstream_timeout", { message: "The request was stopped." });
    const model = candidates[index];
    const provider = providers.get(model.providerId);
    if (!provider || blockedProviders.has(model.providerId)) continue;

    for (let retry = 0; retry <= 1; retry += 1) {
      const started = Date.now();
      try {
        const value = await attempt(model, provider);
        reportModelSuccess(model.key);
        record({
          modelKey: model.key,
          model: model.modelId,
          provider: provider.config.label,
          ok: true,
          latencyMs: Date.now() - started,
        });
        return {
          value,
          model,
          provider,
          attempts,
          fallbackAttempts: attempts.length - 1,
        };
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : apiError("upstream_unavailable");
        const classified = apiErr.status ? classifyFailure(apiErr.status) : null;
        const code = apiErr.code;
        const detail = apiErr.details;

        record({
          modelKey: model.key,
          model: model.modelId,
          provider: provider.config.label,
          ok: false,
          code,
          latencyMs: Date.now() - started,
          detail,
        });
        lastError = apiErr;
        lastDetail = detail;

        if (signal.aborted) {
          throw apiError("upstream_timeout", { message: "The request was stopped." });
        }
        if (code === "not_configured") throw apiErr;

        if (code === "unauthorized_upstream" || code === "forbidden_upstream") blockedProviders.add(model.providerId);
        if (code === "model_no_vision") reportModelFailure(model.key, "no-vision");
        if (code === "model_not_found") reportModelFailure(model.key, "not-found");
        if (code === "rate_limited_upstream") reportModelFailure(model.key, "quota", 60_000);

        const retrySame =
          retry === 0 &&
          (classified?.retrySame ?? (code === "rate_limited_upstream" || code === "upstream_unavailable" || code === "upstream_timeout"));
        if (retrySame) {
          await sleep(Math.min(400 * (retry + 1) + index * 150, 1_500));
          continue;
        }

        const canContinue =
          classified?.nextCandidate ??
          (code === "rate_limited_upstream" ||
            code === "upstream_unavailable" ||
            code === "upstream_timeout" ||
            code === "model_not_found" ||
            code === "invalid_response" ||
            code === "model_no_vision");

        if (!canContinue || index === candidates.length - 1) throw apiErr;
        break;
      }
    }
  }

  if (signal.aborted) throw apiError("upstream_timeout", { message: "The request was stopped." });

  throw apiError("all_models_failed", {
    message:
      lastError?.code === "rate_limited_upstream"
        ? "Every eligible model is rate-limited right now. Wait a moment and try again, or add another provider key."
        : undefined,
    details: lastDetail ?? lastError?.details,
    retryable: true,
  });
}

/** Useful for the UI: "" when nothing was skipped. */
export function summariseAttempts(attempts: AttemptRecord[]): { model: string; code?: string }[] {
  return attempts
    .filter((a) => !a.ok)
    .map((a) => ({ model: a.model, code: a.code }))
    .slice(0, 6);
}

export function fallbackNotice(outcome: FallbackOutcome<unknown>, requested: string): string | undefined {
  if (outcome.fallbackAttempts <= 0) return undefined;
  const failed = outcome.attempts.filter((a) => !a.ok).map((a) => a.model);
  if (failed.length === 0) return undefined;
  return `“${requested}” was unavailable (${failed.join(", ")}), so this answer came from “${outcome.model.modelId}”.`;
}
