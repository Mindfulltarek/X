import { NextResponse } from "next/server";

import type { HealthResponse } from "@/lib/types";
import { getServerConfig, isGatewayConfigured } from "@/lib/server/config";
import { probeGateway } from "@/lib/server/gateway";
import { ApiError, errorBody, newRequestId } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Reports whether this server can reach the configured gateway.
 * Never exposes the gateway URL, hostname or API key.
 *
 * Responses always use HTTP 200 when the check itself ran; the `status` field
 * carries the outcome so the UI can distinguish "not configured" (expected on
 * a fresh deployment) from "temporarily unavailable".
 */

interface HealthCache {
  at: number;
  body: HealthResponse;
}
let cache: HealthCache | null = null;
const CACHE_MS = 10_000;

export async function GET(req: Request) {
  const requestId = newRequestId();
  const cfg = getServerConfig();

  const limit = checkRateLimit("health", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(
      { ...errorBody(new ApiError("rate_limited", "Too many requests. Please wait a moment.", { status: 429, retryable: true })) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!isGatewayConfigured(cfg)) {
    const body: HealthResponse = {
      status: "not_configured",
      message:
        cfg.gatewayConfigError ??
        "Set OMNIROUTE_BASE_URL and OMNIROUTE_API_KEY in the server environment to connect a gateway.",
      checkedAt: Date.now(),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const probe = await probeGateway();
    const body: HealthResponse = {
      status: "connected",
      latencyMs: probe.latencyMs,
      modelCount: probe.modelCount,
      gatewayVersion: probe.version,
      checkedAt: Date.now(),
    };
    cache = { at: Date.now(), body };
    console.info(`[x-ai] rid=${requestId} route=health status=connected dur=${probe.latencyMs}ms`);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : new ApiError("internal", "Health check failed.");
    const body: HealthResponse = {
      status: "unavailable",
      message: apiErr.message,
      checkedAt: Date.now(),
    };
    // Cache a failure briefly so repeated "Test connection" clicks do not hammer a dead gateway.
    cache = { at: Date.now(), body };
    console.warn(
      `[x-ai] rid=${requestId} route=health status=unavailable code=${apiErr.code} detail=${(apiErr.details ?? "").slice(0, 120)}`,
    );
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }
}
