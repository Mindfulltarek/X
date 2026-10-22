import { NextResponse } from "next/server";

import { getRegistry, toPublicProvider, capabilitiesHistogram } from "@/lib/server/ai/registry";
import { getProviders } from "@/lib/server/ai/providers";
import { imageBackendStatus } from "@/lib/server/imagegen";
import { videoBackendStatus } from "@/lib/server/ai/video";
import { mediaBackends } from "@/lib/server/ai/media";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import { apiError, errorBody } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics
 *
 * Explains how the AI layer is wired without revealing anything secret:
 * which providers are configured, where each model came from, and what the
 * router would consider. Keys are never included — only the *name* of the
 * environment variable that holds them.
 *
 * Set AI_DIAGNOSTICS_TOKEN to require `?token=...` for the verbose section.
 * Without it, only counts and issue messages are returned.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = checkRateLimit("diagnostics", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(errorBody(apiError("rate_limited", { message: "Too many requests.", status: 429, retryable: true })), { status: 429 });
  }

  const loaded = getProviders();
  const snapshot = await getRegistry();
  const verbose = Boolean(process.env.AI_DIAGNOSTICS_TOKEN) && url.searchParams.get("token") === process.env.AI_DIAGNOSTICS_TOKEN;

  const base = {
    ready: snapshot.ready,
    configSource: loaded.source,
    routerEnabled: snapshot.settings.routerEnabled,
    collaboration: snapshot.settings.collaboration,
    limits: {
      maxCandidates: snapshot.settings.maxCandidates,
      maxModelsPerRequest: snapshot.settings.maxModelsPerRequest,
      maxOutputTokens: snapshot.settings.maxOutputTokens,
      maxFileBytes: snapshot.settings.maxFileBytes,
      maxDocumentChars: snapshot.settings.maxDocumentChars,
    },
    providers: snapshot.providers.map((state) => ({
      ...toPublicProvider(state),
      apiKeyEnv: state.config.apiKeyEnv,
      hasKey: Boolean(state.config.apiKey),
      protocol: state.config.protocol,
      discover: state.config.discover,
      manualModels: state.config.models.length,
    })),
    capabilities: capabilitiesHistogram(snapshot.models),
    issues: snapshot.issues,
    images: imageBackendStatus(snapshot),
    video: videoBackendStatus(),
    media: mediaBackends().map((entry) => ({
      id: entry.id,
      label: entry.label,
      kinds: entry.kinds,
      configured: entry.configured,
      apiKeyEnv: entry.apiKeyEnv,
      imageModel: entry.imageModel,
      videoModel: entry.videoModel,
      message: entry.message,
    })),
    fetchedAt: snapshot.fetchedAt,
  };

  if (!verbose) {
    return NextResponse.json(
      { ...base, models: undefined, hint: "Add AI_DIAGNOSTICS_TOKEN and pass ?token=… to include per-model detail." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ...base,
      models: snapshot.models.map((model) => ({
        key: model.key,
        label: model.label,
        capabilities: [...model.capabilities],
        sources: model.capabilitySources,
        priority: model.priority,
        costIn: model.costIn,
        costOut: model.costOut,
        discovered: model.discovered,
        manual: model.manual,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
