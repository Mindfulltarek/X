import { NextResponse } from "next/server";

import type { ModelsResponse, PublicModel, PublicProviderStatus } from "@/lib/types";
import { ApiError, errorBody } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import {
  capabilitiesHistogram,
  getRegistry,
  invalidateRegistry,
  toPublicModel,
  modelHealthReason,
  toPublicProvider,
} from "@/lib/server/ai/registry";
import { isChatCapable, isImageCapable } from "@/lib/server/ai/router";
import { pruneCatalogue, pruneModels } from "@/lib/server/ai/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/models
 *
 * Public model catalogue built from every configured provider: ids, labels,
 * capability flags and counts only. No keys, no upstream URLs, no pricing
 * tables beyond the per-million figures the provider itself publishes.
 *
 * `?refresh=1` bypasses the server-side discovery cache.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  const limit = checkRateLimit("models", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(new ApiError("rate_limited", "Too many requests.", { status: 429, retryable: true })),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (refresh) invalidateRegistry();
  const snapshot = await getRegistry({ force: refresh });

  const pruned = pruneModels(snapshot.models.filter(isChatCapable), modelHealthReason);
  const chatModels = pruned.models;
  const vision = chatModels.filter((model) => model.capabilities.has("vision"));
  const images = snapshot.models.filter(isImageCapable);

  const rawModels: PublicModel[] = chatModels
    .map(toPublicModel)
    .map((model) => ({
      id: model.id,
      modelId: model.modelId,
      label: model.label,
      provider: model.providerId,
      providerLabel: model.providerLabel,
      capabilities: model.capabilities,
      kind: "chat",
      vision: model.capabilities.includes("vision"),
      contextLength: model.contextLength,
      costIn: model.costIn,
      costOut: model.costOut,
    }));

  const catalogue = pruneCatalogue(rawModels);
  const models: PublicModel[] = catalogue.models;

  const providers: PublicProviderStatus[] = snapshot.providers.map(toPublicProvider);

  const hygiene = {
    duplicatesRemoved: pruned.duplicates + catalogue.removedDuplicate,
    deadRemoved: pruned.dead + catalogue.removedDead,
  };

  const issues = [
    ...snapshot.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message),
    ...snapshot.providers
      .filter((state) => state.message && state.status !== "ok")
      .map((state) => `${state.config.label}: ${state.message}`),
  ].slice(0, 6);

  const body: ModelsResponse = {
    status: snapshot.ready ? (providers.some((p) => p.status !== "ok") ? "degraded" : "connected") : "not_configured",
    message: issues[0],
    models,
    providers,
    capabilities: capabilitiesHistogram(chatModels),
    visionModels: vision.map((model) => model.key).slice(0, 400),
    imageModels: images.map((model) => model.key).slice(0, 200),
    // "Auto" is our own router, so it is always available when anything is.
    autoAvailable: chatModels.length > 0,
    autoVisionAvailable: vision.length > 0,
    collaborationEnabled: snapshot.settings.collaboration === "review",
    hygiene,
    issues,
    fetchedAt: snapshot.fetchedAt,
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
