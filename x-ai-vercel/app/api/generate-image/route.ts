import { NextResponse } from "next/server";

import type { GenerateImageResponse } from "@/lib/types";
import { getServerConfig } from "@/lib/server/config";
import { ApiError, apiError, errorBody, logServerEvent, newRequestId } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import { generateImage, imageBackendStatus } from "@/lib/server/imagegen";
import { generateImageRequestSchema, readJsonBody, zodMessage } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/generate-image
 *
 * Generates an image only through a real, configured backend (OmniRoute image
 * models or ComfyUI). When nothing is configured this returns 501 with a clear
 * explanation — it never fabricates an image or a success.
 *
 * GET returns the backend status for the Settings panel (no secrets).
 */
export async function GET() {
  const cfg = getServerConfig();
  const status = imageBackendStatus();
  return NextResponse.json(
    {
      configured: status.configured,
      backend: status.backend,
      message: status.message,
      gatewayConfigured: Boolean(cfg.gatewayBaseUrl && cfg.gatewayApiKey),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const started = Date.now();
  const cfg = getServerConfig();

  const limit = checkRateLimit("image", clientKeyFromHeaders(req.headers), rateLimits().image);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(
        new ApiError("rate_limited", "Too many image requests. Please wait a moment and try again.", {
          status: 429,
          retryable: true,
        }),
      ),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let parsed: ReturnType<typeof generateImageRequestSchema.safeParse>;
  try {
    const raw = await readJsonBody(req, 256 * 1024);
    parsed = generateImageRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw apiError("invalid_payload", { message: zodMessage(parsed.error) });
    }
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("invalid_payload");
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  const status = imageBackendStatus();
  if (!status.configured) {
    const apiErr = apiError("image_backend_not_configured", { message: status.message });
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  try {
    const result = await generateImage({
      prompt: parsed.data.prompt,
      model: parsed.data.model,
      size: parsed.data.size,
      n: parsed.data.n ?? 1,
    });
    logServerEvent({
      requestId,
      route: "generate-image",
      status: 200,
      model: result.model,
      durationMs: Date.now() - started,
      detail: `backend=${result.backend} images=${result.images.length} gatewayTimeout=${cfg.gatewayRequestTimeoutMs}`,
    });
    const body: GenerateImageResponse = {
      ok: true,
      backend: result.backend,
      model: result.model,
      images: result.images,
      tookMs: Date.now() - started,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("internal");
    logServerEvent({
      requestId,
      route: "generate-image",
      status: apiErr.status,
      code: apiErr.code,
      durationMs: Date.now() - started,
      detail: apiErr.details,
    });
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }
}
