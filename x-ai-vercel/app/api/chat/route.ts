import { NextResponse } from "next/server";

import type { ChatRequestBody } from "@/lib/types";
import { getServerConfig, isGatewayConfigured } from "@/lib/server/config";
import { fetchModelCatalog, type ModelCatalog } from "@/lib/server/gateway";
import { ApiError, apiError, errorBody, logServerEvent, newRequestId } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import {
  buildMessages,
  extractFullContent,
  planCandidates,
  requestCompletion,
  resolveServedModel,
  SSE_HEADERS,
  streamFromUpstream,
} from "@/lib/server/chat-orchestrator";
import {
  chatRequestSchema,
  readJsonBody,
  validateImageDataUrl,
  zodMessage,
} from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/chat
 *
 * Body (JSON):
 *   { mode, model, messages, imageDataUrl?, chatId?, stream? }
 *
 * Streaming response: `text/event-stream` where each `data:` line is one of
 *   { type:"meta",  requestedModel, model, provider?, fallbackAttempts, requestId? }
 *   { type:"delta", text }
 *   { type:"done",  model, provider?, fallbackAttempts }
 *   { type:"error", code, message, retryable, details? }
 *
 * All gateway communication happens here on the server. The browser never sees
 * the gateway URL, the API key, or raw upstream error objects.
 */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const started = Date.now();
  const cfg = getServerConfig();

  const limit = checkRateLimit("chat", clientKeyFromHeaders(req.headers), rateLimits().chat);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(
        new ApiError("rate_limited", "Too many requests from this browser. Please wait a moment and try again.", {
          status: 429,
          retryable: true,
        }),
      ),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!isGatewayConfigured(cfg)) {
    return NextResponse.json(
      errorBody(apiError("not_configured", { details: cfg.gatewayConfigError ?? undefined })),
      { status: 503 },
    );
  }

  let body: ChatRequestBody;
  let imageDataUrl: string | undefined;
  try {
    const raw = await readJsonBody(req);
    const parsed = chatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw apiError("invalid_payload", { message: zodMessage(parsed.error) });
    }
    body = parsed.data as ChatRequestBody;
    if (body.imageDataUrl) {
      imageDataUrl = validateImageDataUrl(body.imageDataUrl).dataUrl;
    }
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("invalid_payload");
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  // The catalog is used for capability checks and to validate explicit model ids.
  // A catalog failure must not block chat: the request is still forwarded and the
  // gateway decides what it can route.
  let catalog: ModelCatalog | null = null;
  try {
    catalog = await fetchModelCatalog();
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : null;
    console.warn(
      `[x-ai] rid=${requestId} route=chat modelCatalog=unavailable code=${apiErr?.code ?? "unknown"}`,
    );
  }

  const hasImage = Boolean(imageDataUrl);

  let stream: boolean;
  let messages: ReturnType<typeof buildMessages>;
  let candidates: ReturnType<typeof planCandidates>;
  try {
    stream = body.stream !== false;
    messages = buildMessages({ mode: body.mode, messages: body.messages, imageDataUrl });
    candidates = planCandidates({
      requested: body.model,
      hasImage,
      catalog,
      cfg,
    });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("internal");
    logServerEvent({
      requestId,
      route: "chat",
      status: apiErr.status,
      code: apiErr.code,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  let upstream: Awaited<ReturnType<typeof requestCompletion>>;
  try {
    upstream = await requestCompletion({
      candidates: candidates.candidates,
      messages,
      stream,
      signal: req.signal,
    });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("internal");
    logServerEvent({
      requestId,
      route: "chat",
      status: apiErr.code,
      model: candidates.candidates[0]?.model,
      code: apiErr.code,
      durationMs: Date.now() - started,
      detail: apiErr.details,
    });
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  const served = resolveServedModel(upstream.res, upstream.candidate);
  logServerEvent({
    requestId,
    route: "chat",
    status: upstream.res.status,
    model: served.model,
    durationMs: Date.now() - started,
    detail: `requested=${upstream.candidate.model} fallbacks=${upstream.fallbackAttempts}${
      candidates.visionDowngraded ? " vision-fallback" : ""
    } image=${hasImage}`,
  });

  if (!stream) {
    try {
      const json = (await upstream.res.json()) as unknown;
      const text = extractFullContent(json);
      if (!text) throw apiError("invalid_response", { details: "chat: empty content" });
      return NextResponse.json(
        {
          ok: true,
          text,
          model: served.model,
          provider: served.provider,
          requestedModel: body.model,
          fallbackAttempts: upstream.fallbackAttempts,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : apiError("invalid_response");
      return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
    }
  }

  const bodyStream = streamFromUpstream({
    res: upstream.res,
    candidate: upstream.candidate,
    fallbackAttempts: upstream.fallbackAttempts,
    requestId,
    requestedModel: body.model,
    notice: candidates.visionDowngraded
      ? `"${body.model}" cannot read images, so the request used the configured vision model "${upstream.candidate.model}".`
      : undefined,
  });

  return new Response(bodyStream, { status: 200, headers: SSE_HEADERS });
}
