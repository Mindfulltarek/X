import { NextResponse } from "next/server";

import type { GenerateImageRequestBody, GenerateImageResponse } from "@/lib/types";
import { getRegistry } from "@/lib/server/ai/registry";
import { imageBackendStatus, generateImage } from "@/lib/server/imagegen";
import { ApiError, apiError, errorBody, logServerEvent, newRequestId } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import { generateImageRequestSchema, readJsonBody, zodMessage } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface ImageBackendPayload {
  configured: boolean;
  backend: string | null;
  model?: string;
  models: string[];
  message: string;
  gatewayConfigured: boolean;
}

/**
 * GET /api/generate-image → backend status (no request is made upstream).
 * POST /api/generate-image → generate one or more images.
 *
 * Images come either from a provider image model discovered through the same
 * registry as chat, or from an explicitly configured ComfyUI backend. Nothing
 * is ever returned unless it came from a real backend.
 */
export async function GET(req: Request) {
  const limit = checkRateLimit("image-status", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(errorBody(apiError("rate_limited", { message: "Too many requests.", status: 429, retryable: true })), {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  const snapshot = await getRegistry();
  const status = imageBackendStatus(snapshot);
  const payload: ImageBackendPayload = {
    configured: status.configured,
    backend: status.backend,
    model: status.model,
    models: status.models,
    message: status.message,
    gatewayConfigured: snapshot.ready,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const started = Date.now();

  const limit = checkRateLimit("image", clientKeyFromHeaders(req.headers), rateLimits().image);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(apiError("rate_limited", { message: "Too many image requests. Please wait a moment.", status: 429, retryable: true })),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: GenerateImageRequestBody;
  try {
    const raw = await readJsonBody(req, 256 * 1024);
    const parsed = generateImageRequestSchema.safeParse(raw);
    if (!parsed.success) throw apiError("invalid_payload", { message: zodMessage(parsed.error) });
    body = parsed.data as GenerateImageRequestBody;
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("invalid_payload");
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  const snapshot = await getRegistry();
  const status = imageBackendStatus(snapshot, body.model);
  if (!status.configured) {
    return NextResponse.json(
      errorBody(apiError("image_backend_not_configured", { message: status.message })),
      { status: 501 },
    );
  }

  try {
    const result = await generateImage({
      snapshot,
      settings: snapshot.settings,
      prompt: body.prompt,
      model: body.model,
      size: body.size,
      n: body.n ?? 1,
      signal: req.signal,
    });
    const payload: GenerateImageResponse = {
      ok: true,
      backend: result.backend,
      model: result.model,
      images: result.images,
      tookMs: Date.now() - started,
    };
    logServerEvent({
      requestId,
      route: "image",
      status: 200,
      model: result.model,
      durationMs: Date.now() - started,
      detail: `backend=${result.backend} images=${result.images.length}`,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("internal");
    logServerEvent({
      requestId,
      route: "image",
      status: apiErr.status,
      code: apiErr.code,
      durationMs: Date.now() - started,
      detail: apiErr.details,
    });
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }
}
