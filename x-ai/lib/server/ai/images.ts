import "server-only";

import { apiError } from "../errors";
import { postChatImageGeneration, postImageGeneration, readUpstreamError } from "./client";
import { extractImages, type ParsedImage } from "./parse";
import { reportModelFailure, reportModelSuccess, type RegistrySnapshot } from "./registry";
import { routeImageGeneration } from "./router";
import type { AISettings, ModelRef, ProviderState } from "./types";

/**
 * Image generation through the same provider registry as chat.
 *
 * Two wire formats are supported, both documented:
 *
 *  1. `POST {baseUrl}/images/generations` — OpenAI, OmniRoute and most
 *     OpenAI-compatible gateways.
 *  2. `POST {baseUrl}/chat/completions` with `modalities: ["image","text"]` —
 *     how OpenRouter (and several others) expose image models.
 *
 * The format is detected, not guessed per provider: we try the images endpoint
 * first and, only if the provider answers 404/405 (endpoint does not exist),
 * switch to the chat-modalities format. A 400/401/402/429 is reported as-is so
 * quota and key problems stay visible instead of being retried forever.
 */

export interface ImageGenerationResult {
  backend: string;
  model?: string;
  providerLabel?: string;
  images: ParsedImage[];
}

function pickProvider(snapshot: RegistrySnapshot, model: ModelRef): ProviderState | undefined {
  return snapshot.providers.find((state) => state.config.id === model.providerId);
}

export interface ImageStatus {
  configured: boolean;
  backend: string | null;
  model?: string;
  models: string[];
  message: string;
}

export function providerImageStatus(snapshot: RegistrySnapshot, requested?: string): ImageStatus {
  const model = routeImageGeneration(snapshot, requested);
  const available = snapshot.models
    .filter((m) => m.capabilities.has("image-gen"))
    .map((m) => m.modelId)
    .slice(0, 12);
  if (!model) {
    return {
      configured: false,
      backend: null,
      models: [],
      message:
        available.length > 0
          ? "Image models are listed by your provider but none is currently reachable."
          : "No image-generation model is available on the configured providers. Add one in AI_PROVIDERS, or connect a ComfyUI backend.",
    };
  }
  const provider = pickProvider(snapshot, model);
  return {
    configured: true,
    backend: provider?.config.label ?? "provider",
    model: model.modelId,
    models: available,
    message: `Using ${model.label} via ${provider?.config.label ?? model.providerId}. Provider quotas and pricing apply.`,
  };
}

async function generateWithProvider(opts: {
  provider: ProviderState;
  model: ModelRef;
  prompt: string;
  size?: string;
  n: number;
  settings: AISettings;
  signal: AbortSignal;
}): Promise<ParsedImage[]> {
  const { provider, model, prompt, size, n, settings, signal } = opts;
  const timeoutMs = Math.min(Math.max(settings.requestTimeoutMs, 60_000), 180_000);

  let res = await postImageGeneration(
    provider.config,
    { model: model.modelId, prompt, size, n },
    { signal, timeoutMs },
  );

  let usedChatFormat = false;
  if (res.status === 404 || res.status === 405) {
    // The provider has no /images/generations: use its chat-modalities route.
    usedChatFormat = true;
    res = await postChatImageGeneration(
      provider.config,
      { model: model.modelId, prompt, n },
      { signal, timeoutMs },
    );
  }

  if (!res.ok) {
    const detail = await readUpstreamError(res);
    if (res.status === 401 || res.status === 403) {
      reportModelFailure(model.key, "auth", 300_000);
      throw apiError("unauthorized_upstream", { details: `images ${res.status}: ${detail}` });
    }
    if (res.status === 402) {
      reportModelFailure(model.key, "quota", 300_000);
      throw apiError("rate_limited_upstream", {
        message: `${provider.config.label} reports no remaining credit for image generation.`,
        details: `images 402: ${detail}`,
      });
    }
    if (res.status === 429) {
      reportModelFailure(model.key, "quota", 120_000);
      throw apiError("rate_limited_upstream", { details: `images 429: ${detail}` });
    }
    if (res.status === 404) {
      reportModelFailure(model.key, "not-found", 300_000);
      throw apiError("model_not_found", {
        message: `“${model.modelId}” is not available for image generation on ${provider.config.label}.`,
        details: `images 404: ${detail}`,
      });
    }
    throw apiError("upstream_unavailable", { details: `images ${res.status}${usedChatFormat ? " (chat format)" : ""}: ${detail}` });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw apiError("invalid_response", { details: "images: body was not JSON" });
  }

  const images = extractImages(json);
  if (images.length === 0) {
    reportModelFailure(model.key, "error", 300_000);
    throw apiError("invalid_response", {
      message: `${provider.config.label} accepted the request but returned no image for “${model.modelId}”.`,
      details: "images: empty payload",
    });
  }
  reportModelSuccess(model.key);
  return images;
}

/** Tries the requested model, then any other image model that is available. */
export async function generateImageWithProvider(opts: {
  snapshot: RegistrySnapshot;
  settings: AISettings;
  prompt: string;
  model?: string;
  size?: string;
  n: number;
  signal: AbortSignal;
}): Promise<ImageGenerationResult> {
  const { snapshot, settings, prompt, model, size, n, signal } = opts;
  const primary = routeImageGeneration(snapshot, model);
  if (!primary) {
    throw apiError("image_backend_not_configured", {
      message: providerImageStatus(snapshot, model).message,
    });
  }

  const candidates = [
    primary,
    ...snapshot.models.filter((m) => m.capabilities.has("image-gen") && m.key !== primary.key).slice(0, 2),
  ];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const provider = pickProvider(snapshot, candidate);
    if (!provider || !provider.config.apiKey) continue;
    try {
      const images = await generateWithProvider({ provider, model: candidate, prompt, size, n, settings, signal });
      return {
        backend: provider.config.label,
        model: candidate.modelId,
        providerLabel: provider.config.label,
        images,
      };
    } catch (err) {
      lastError = err;
      if (signal.aborted) break;
    }
  }

  if (lastError) throw lastError;
  throw apiError("image_backend_not_configured", { message: providerImageStatus(snapshot, model).message });
}
