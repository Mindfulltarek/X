import { NextResponse } from "next/server";

import type { ModelsResponse } from "@/lib/types";
import { getServerConfig, isGatewayConfigured } from "@/lib/server/config";
import { fetchModelCatalog, invalidateModelCache } from "@/lib/server/gateway";
import { ApiError, errorBody } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/models
 *
 * Returns only safe, public model metadata (id, label, provider, kind, vision
 * flag, context length) so the picker is populated from the real catalog rather
 * than a hard-coded list. `?refresh=1` bypasses the 60s server cache.
 *
 * Also tells the client whether OmniRoute can route `auto` and whether image
 * generation has any image models visible to the configured key.
 */
export async function GET(req: Request) {
  const cfg = getServerConfig();
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  const limit = checkRateLimit("models", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(errorBody(new ApiError("rate_limited", "Too many requests.", { status: 429, retryable: true })), {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const empty: Omit<ModelsResponse, "status" | "message"> = {
    models: [],
    visionModels: [],
    imageModels: [],
    autoAvailable: false,
    autoVisionAvailable: false,
    fetchedAt: Date.now(),
  };

  if (!isGatewayConfigured(cfg)) {
    const body: ModelsResponse = {
      ...empty,
      status: "not_configured",
      message:
        cfg.gatewayConfigError ??
        "No gateway is configured. Set OMNIROUTE_BASE_URL and OMNIROUTE_API_KEY in the server environment.",
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (refresh) invalidateModelCache();
    const catalog = await fetchModelCatalog({ force: refresh });
    const body: ModelsResponse = {
      status: "connected",
      models: catalog.models,
      visionModels: catalog.visionModels,
      imageModels: catalog.imageModels,
      autoAvailable: catalog.autoAvailable,
      autoVisionAvailable: catalog.autoAvailable,
      fetchedAt: catalog.fetchedAt,
      message:
        catalog.models.length === 0
          ? "The gateway responded but returned no models. Connect a provider in the OmniRoute dashboard and create an API key with model access."
          : undefined,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : new ApiError("internal", "Could not load models.");
    const body: ModelsResponse = {
      ...empty,
      status: apiErr.code === "not_configured" ? "not_configured" : "unavailable",
      message: apiErr.message,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }
}
