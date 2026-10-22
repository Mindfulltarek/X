import { NextResponse } from "next/server";

import type { HealthResponse, PublicProviderStatus } from "@/lib/types";
import { ApiError, errorBody, newRequestId } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import { getRegistry, toPublicProvider } from "@/lib/server/ai/registry";
import { isChatCapable, isImageCapable } from "@/lib/server/ai/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Reports whether this deployment can actually reach its providers, how many
 * models each returns, and whether vision/image routing is possible.
 * Never exposes a base URL, hostname of a private gateway, or an API key.
 *
 * Always HTTP 200 when the check ran; `status` carries the outcome so the UI
 * can distinguish "not configured" from "temporarily unavailable".
 */
export async function GET(req: Request) {
  const requestId = newRequestId();

  const limit = checkRateLimit("health", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(new ApiError("rate_limited", "Too many requests. Please wait a moment.", { status: 429, retryable: true })),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const snapshot = await getRegistry();
  const providers: PublicProviderStatus[] = snapshot.providers.map(toPublicProvider);
  const chatModels = snapshot.models.filter(isChatCapable);
  const latency = providers
    .map((provider) => provider.latencyMs)
    .filter((value): value is number => typeof value === "number");

  const body: HealthResponse = {
    status: snapshot.ready ? (providers.some((p) => p.status !== "ok") ? "degraded" : "connected") : "not_configured",
    message: snapshot.ready
      ? providers.find((provider) => provider.status !== "ok")?.message
      : (providers.find((provider) => provider.status === "unauthorized" || provider.status === "forbidden")?.message ??
        snapshot.issues.find((issue) => issue.severity === "error")?.message ??
        "No AI provider is configured. Set AI_PROVIDERS or a provider API key, then redeploy."),
    latencyMs: latency.length > 0 ? Math.max(...latency) : undefined,
    modelCount: chatModels.length,
    visionModelCount: chatModels.filter((model) => model.capabilities.has("vision")).length,
    imageModelCount: snapshot.models.filter(isImageCapable).length,
    providerCount: providers.filter((provider) => provider.status === "ok").length,
    providers,
    collaboration: snapshot.settings.collaboration === "review",
    routerEnabled: snapshot.settings.routerEnabled,
    checkedAt: Date.now(),
  };

  console.info(
    `[x-ai] rid=${requestId} route=health status=${body.status} providers=${body.providerCount} models=${body.modelCount}`,
  );

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
