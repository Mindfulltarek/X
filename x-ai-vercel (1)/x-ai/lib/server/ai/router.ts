import "server-only";

import { apiError } from "../errors";
import { modelHealthReason, type RegistrySnapshot } from "./registry";
import { describeClassification } from "./classifier";
import type { AISettings, Capability, Classification, ModelRef, RouteDecision } from "./types";

/**
 * The router.
 *
 * Input: the capability-labelled model registry + a classification.
 * Output: an ordered candidate list (primary first, then fallbacks).
 *
 * It never fans out to every model: the primary is one model, and the others
 * are only used if the primary fails. Selection is deterministic and
 * explainable — every candidate has a score breakdown available in the
 * diagnostics endpoint.
 */

/** Models that are not chat models even though a provider lists them. */
const NON_CHAT = /(embedding|embed-|whisper|tts-|text-to-speech|rerank|moderation|guard|dall-e|stable-diffusion|flux|sdxl)/i;

export function isChatCapable(model: ModelRef): boolean {
  if (NON_CHAT.test(model.modelId)) return false;
  // Pure image models (output = image) can't answer a chat turn.
  if (model.capabilities.has("image-gen") && !model.capabilities.has("reasoning") && !model.capabilities.has("coding")) {
    return false;
  }
  return true;
}

export function isImageCapable(model: ModelRef): boolean {
  return model.capabilities.has("image-gen");
}

function providerUsable(snapshot: RegistrySnapshot, model: ModelRef): boolean {
  const state = snapshot.providers.find((p) => p.config.id === model.providerId);
  if (!state) return false;
  if (!state.config.apiKey) return false;
  if (state.status === "unauthorized" || state.status === "forbidden") return false;
  return true;
}

/** Lower is better. */
function score(model: ModelRef, classification: Classification, settings: AISettings): number {
  let value = 0;

  classification.prefers.forEach((cap, index) => {
    if (model.capabilities.has(cap)) value -= 32 - Math.min(index, 4) * 6;
  });

  // Operator priority (provider priority is already folded into model.priority).
  value += model.priority / 100;

  // Cost: cheap models win when quality is otherwise equal.
  if (model.costIn !== undefined) value += Math.min(model.costIn, 40) * 0.22;
  if (model.costOut !== undefined) value += Math.min(model.costOut, 120) * 0.04;
  if (model.costIn === 0) value -= 3;

  if (model.latency === "low") value -= 7;
  if (model.latency === "high") value += 5;

  if (classification.kind === "simple" && model.capabilities.has("fast")) value -= 8;
  if (classification.kind === "reasoning" && !model.capabilities.has("reasoning")) value += 6;
  if (classification.kind === "coding" && !model.capabilities.has("coding")) value += 4;

  // Catalogue metadata is more trustworthy than name heuristics.
  if (model.capabilitySources.vision === "heuristic") value += 1.5;
  if (!model.discovered) value += 2;

  // Depth of the fallback list is capped, so prefer models we know exist.
  if (settings.forcedModel && model.key === settings.forcedModel) value -= 1000;

  return value;
}

export interface RouteInput {
  snapshot: RegistrySnapshot;
  classification: Classification;
  /** "auto", "", a `provider::model` key, or a bare model id. */
  requestedModel?: string;
  settings: AISettings;
}

function isAuto(requested: string | undefined): boolean {
  if (!requested) return true;
  const value = requested.trim().toLowerCase();
  return value === "" || value === "auto" || value.startsWith("auto/") || value === "default";
}

function findRequested(snapshot: RegistrySnapshot, requested: string): ModelRef | undefined {
  const exact = snapshot.models.find((m) => m.key === requested);
  if (exact) return exact;
  const byModelId = snapshot.models.filter((m) => m.modelId === requested);
  if (byModelId.length > 0) {
    // Prefer the highest-priority provider for that model id.
    return byModelId.sort((a, b) => a.priority - b.priority)[0];
  }
  return undefined;
}

function missingCapabilityMessage(classification: Classification, model: ModelRef, available: ModelRef[]): string {
  if (classification.requires.has("vision")) {
    const visionNames = available
      .filter((m) => m.capabilities.has("vision") && isChatCapable(m))
      .slice(0, 3)
      .map((m) => m.key);
    return visionNames.length > 0
      ? `“${model.modelId}” cannot read images. Vision-capable models on this deployment: ${visionNames.join(", ")}. Switch the model, or leave it on Auto so the router picks one.`
      : `“${model.modelId}” cannot read images and this deployment has no vision-capable model configured. Add a vision model to AI_PROVIDERS.`;
  }
  return `“${model.modelId}” does not support ${[...classification.requires].join(" + ")}.`;
}

export function routeChat(input: RouteInput): RouteDecision {
  const { snapshot, classification, requestedModel, settings } = input;
  const rejected: RouteDecision["rejected"] = [];

  const chatModels = snapshot.models.filter(
    (model) => isChatCapable(model) && providerUsable(snapshot, model) && !modelHealthReason(model.key),
  );

  const eligible = chatModels.filter((model) =>
    [...classification.requires].every((cap: Capability) => model.capabilities.has(cap)),
  );

  for (const model of chatModels) {
    if (eligible.includes(model)) continue;
    const missing = [...classification.requires].filter((cap) => !model.capabilities.has(cap));
    if (missing.length > 0) rejected.push({ model: model.key, reason: `missing ${missing.join(", ")}` });
  }

  let primary: ModelRef | undefined;
  let reason: string;

  if (!isAuto(requestedModel)) {
    const requested = findRequested(snapshot, requestedModel!.trim());
    if (!requested) {
      throw apiError("model_not_found", {
        status: 400,
        retryable: false,
        message: `“${requestedModel}” is not in this deployment's model list. Refresh the model list in Settings, or choose Auto.`,
      });
    }
    const missing = [...classification.requires].filter((cap) => !requested.capabilities.has(cap));
    if (missing.length > 0) {
      throw apiError("model_no_vision", {
        status: 422,
        retryable: false,
        message: missingCapabilityMessage(classification, requested, chatModels),
      });
    }
    primary = requested;
    reason = `you selected ${requested.label}`;
  } else {
    const ranked = [...eligible].sort((a, b) => score(a, classification, settings) - score(b, classification, settings));
    primary = ranked[0];
    if (!primary) {
      if (classification.requires.has("vision")) {
        throw apiError("model_no_vision", {
          status: 422,
          retryable: false,
          message:
            "This deployment has no vision-capable model, so the attached image cannot be processed. Add a vision model in AI_PROVIDERS, or remove the attachment.",
        });
      }
      throw apiError("not_configured", {
        message:
          "No model on this deployment can serve this request. Check the provider status in Settings, or add a model to AI_PROVIDERS.",
      });
    }
    reason = `auto-selected for ${describeClassification(classification)}`;
  }

  // Fallbacks: same eligibility, best-first, at most two per provider for diversity.
  const ranked = eligible
    .filter((model) => model.key !== primary!.key)
    .sort((a, b) => score(a, classification, settings) - score(b, classification, settings));

  const candidates: ModelRef[] = [primary];
  const perProvider = new Map<string, number>([[primary.providerId, 1]]);
  for (const model of ranked) {
    if (candidates.length >= settings.maxCandidates) break;
    const used = perProvider.get(model.providerId) ?? 0;
    if (used >= 2) continue;
    perProvider.set(model.providerId, used + 1);
    candidates.push(model);
  }

  if (candidates.length > settings.maxCandidates) candidates.length = settings.maxCandidates;

  return { classification, candidates, reason, rejected: rejected.slice(0, 40) };
}

/** Best image-generation model, honouring an explicit request. */
export function routeImageGeneration(snapshot: RegistrySnapshot, requested?: string): ModelRef | undefined {
  const imageModels = snapshot.models.filter(
    (model) => isImageCapable(model) && providerUsable(snapshot, model) && !modelHealthReason(model.key),
  );
  if (imageModels.length === 0) return undefined;
  if (requested) {
    const match =
      imageModels.find((m) => m.key === requested) ??
      imageModels.find((m) => m.modelId === requested) ??
      imageModels.find((m) => m.modelId.includes(requested));
    if (match) return match;
  }
  return [...imageModels].sort((a, b) => a.priority - b.priority)[0];
}

/** Candidate models for the second-opinion pass (must be a different model). */
export function routeCollaborator(
  snapshot: RegistrySnapshot,
  primary: ModelRef,
  classification: Classification,
  settings: AISettings,
  exclude: string[] = [],
): ModelRef | undefined {
  const pool = snapshot.models.filter(
    (model) =>
      isChatCapable(model) &&
      providerUsable(snapshot, model) &&
      !modelHealthReason(model.key) &&
      model.key !== primary.key &&
      !exclude.includes(model.key) &&
      [...classification.requires].every((cap) => model.capabilities.has(cap)),
  );
  if (pool.length === 0) return undefined;

  // Prefer a different provider (independent answers), then reasoning strength.
  const ranked = [...pool].sort((a, b) => {
    const aSame = a.providerId === primary.providerId ? 1 : 0;
    const bSame = b.providerId === primary.providerId ? 1 : 0;
    if (aSame !== bSame) return aSame - bSame;
    const aReason = a.capabilities.has("reasoning") ? 0 : 1;
    const bReason = b.capabilities.has("reasoning") ? 0 : 1;
    if (aReason !== bReason) return aReason - bReason;
    return score(a, classification, settings) - score(b, classification, settings);
  });
  return ranked[0];
}
