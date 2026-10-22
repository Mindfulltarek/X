import "server-only";

/**
 * Error model for the X AI API surface.
 *
 * Upstream (gateway/provider) response bodies are never forwarded to the
 * browser: they can contain account identifiers, URLs or key fragments. We
 * classify the upstream failure, keep a short sanitised diagnostic for logs,
 * and return a stable machine-readable code plus a human sentence.
 */

export type ErrorCode =
  | "bad_request"
  | "invalid_payload"
  | "image_too_large"
  | "unsupported_image_type"
  | "not_configured"
  | "image_backend_not_configured"
  | "unsupported_file_type"
  | "no_vision_model"
  | "unauthorized_upstream"
  | "forbidden_upstream"
  | "model_not_found"
  | "model_no_vision"
  | "rate_limited_upstream"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "invalid_response"
  | "all_models_failed"
  | "rate_limited"
  | "payload_too_large"
  | "internal";

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  /** Safe, short diagnostic detail (never contains secrets). */
  details?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; retryable?: boolean; details?: string } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = opts.status ?? 500;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

/** Human-readable copy for each code, shown in the UI when it happens. */
export const ERROR_COPY: Record<ErrorCode, { message: string; retryable: boolean; status: number }> = {
  bad_request: { message: "That request could not be understood. Please try again.", retryable: false, status: 400 },
  invalid_payload: { message: "The request payload was invalid.", retryable: false, status: 400 },
  image_too_large: {
    message: "That image is too large. Try an image under the configured size limit.",
    retryable: false,
    status: 413,
  },
  unsupported_image_type: {
    message: "That file type is not supported. Use a PNG, JPEG, WebP or GIF image.",
    retryable: false,
    status: 415,
  },
  unsupported_file_type: {
    message: "That file type is not supported. Attach an image, a PDF, a DOCX or a plain text file.",
    retryable: false,
    status: 415,
  },
  not_configured: {
    message:
      "No AI provider is configured for this deployment yet. The site owner needs to set AI_PROVIDERS (or a provider key such as OPENROUTER_API_KEY) and redeploy.",
    retryable: false,
    status: 503,
  },
  no_vision_model: {
    message:
      "This deployment has no vision-capable model, so attached images cannot be read. Add a vision model to AI_PROVIDERS, or remove the attachment.",
    retryable: false,
    status: 422,
  },
  image_backend_not_configured: {
    message:
      "Image generation is not configured. The site owner needs to add an image-capable model to AI_PROVIDERS, or connect a ComfyUI backend.",
    retryable: false,
    status: 501,
  },
  unauthorized_upstream: {
    message:
      "A connected provider rejected its API key. Check the key in the server environment (it may be revoked or lack access to this model).",
    retryable: false,
    status: 502,
  },
  forbidden_upstream: {
    message: "A connected provider refused this request for its key or this model.",
    retryable: false,
    status: 502,
  },
  model_not_found: {
    message: "That model is not available on the configured providers. Pick another model or use Auto.",
    retryable: true,
    status: 502,
  },
  model_no_vision: {
    message:
      "The selected model cannot read images. Choose a vision-capable model, or leave the model on Auto so the router picks one.",
    retryable: false,
    status: 422,
  },
  rate_limited_upstream: {
    message:
      "A connected provider reported a quota or rate limit. Try again shortly, or pick a different model.",
    retryable: true,
    status: 429,
  },
  upstream_unavailable: {
    message: "The AI provider is temporarily unavailable. Please try again.",
    retryable: true,
    status: 502,
  },
  upstream_timeout: {
    message: "The AI provider took too long to respond. Try again or use a faster model.",
    retryable: true,
    status: 504,
  },
  invalid_response: {
    message: "The provider returned a response X AI could not read.",
    retryable: true,
    status: 502,
  },
  all_models_failed: {
    message:
      "Every eligible model failed. Open Settings to check provider status and quota, add another provider key, then try again.",
    retryable: true,
    status: 503,
  },
  rate_limited: {
    message: "Too many requests from this browser. Please wait a moment and try again.",
    retryable: true,
    status: 429,
  },
  payload_too_large: { message: "That request is too large.", retryable: false, status: 413 },
  internal: { message: "Something went wrong on the server.", retryable: true, status: 500 },
};

export function apiError(
  code: ErrorCode,
  opts: { details?: string; message?: string; retryable?: boolean; status?: number } = {},
): ApiError {
  const copy = ERROR_COPY[code] ?? ERROR_COPY.internal;
  return new ApiError(code, opts.message ?? copy.message, {
    status: opts.status ?? copy.status,
    retryable: opts.retryable ?? copy.retryable,
    details: opts.details,
  });
}

/** Body returned by every non-streaming API route on failure. */
export function errorBody(err: ApiError) {
  return {
    ok: false as const,
    code: err.code,
    message: err.message,
    retryable: err.retryable,
  };
}

/**
 * Logs only classification metadata: no keys, no prompt text, no image bytes.
 * Returns a short request id for correlating the user-visible error.
 */
export function logServerEvent(event: {
  requestId: string;
  route: string;
  status?: number | string;
  model?: string;
  durationMs?: number;
  code?: string;
  detail?: string;
}): void {
  const parts = [
    `[x-ai] rid=${event.requestId}`,
    `route=${event.route}`,
    event.model ? `model=${event.model}` : null,
    event.status !== undefined ? `status=${event.status}` : null,
    event.durationMs !== undefined ? `dur=${event.durationMs}ms` : null,
    event.code ? `code=${event.code}` : null,
    event.detail ? `detail=${event.detail.slice(0, 240)}` : null,
  ].filter(Boolean);
  console.warn(parts.join(" "));
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
