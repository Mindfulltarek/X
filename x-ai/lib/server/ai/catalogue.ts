import "server-only";

import type { PublicModel } from "@/lib/types";

/**
 * Catalogue hygiene for the public model list.
 *
 * Providers return a lot of noise: embedding / audio / moderation rows,
 * "latest" aliases next to the dated version they point at, the same model
 * exposed by two gateways, and internal router pseudo-models. None of that
 * belongs in a chat picker, so we drop what can never answer a turn and fold
 * exact aliases of the same model into one entry.
 *
 * Nothing here invents or hides a *working* model — it only removes rows that
 * are duplicates of another row, or that are not language-model endpoints.
 */

/** Not language models: they cannot answer a chat turn at all. */
const NON_CHAT = new RegExp(
  [
    "embedding",
    "embed-",
    "^bge[-/]",
    "^e5[-/]",
    "whisper",
    "tts[-_]",
    "text-to-speech",
    "speech",
    "audio",
    "rerank",
    "moderation",
    "guard",
    "dall-e",
    "stable-diffusion",
    "sdxl",
    "midjourney",
    "imagen",
    "veo[-_]",
    "sora",
    "kling",
    "runway",
    "luma",
    "cogvideo",
    "hunyuan.*video",
    "upscal",
    "clip-",
    "sam-",
    "^omni-moderation",
  ].join("|"),
  "i",
);

/** Pseudo-models that only exist inside someone else's router. */
const ROUTER_ALIAS = /(^|[/:-])(auto|router|random|best|default)$|openrouter\/auto|router-auto/i;

/** Version/tier suffixes that make one row an alias of another. */
const ALIAS_SUFFIX =
  /(:free|:extended|:online|:nitro|:floor|:beta|:stable|-latest|-preview|-experimental|-0*1\d{3}(?:-\d{2}-\d{2})?|@latest)$/i;

const VENDOR_PREFIX =
  /^(meta-llama|mistralai|mistral|qwen|qwenlm|deepseek|google|openai|anthropic|nvidia|microsoft|x-ai|xai|cohere|amazon|moonshotai|moonshot|z-ai|thudm|baai|meta|ibm-granite|allenai|nousresearch|deepseek-ai|gryphe|perplexity|openrouter|together|groq|fireworks|cerebras)\//;

function normalise(model: PublicModel): string {
  let id = (model.modelId ?? model.id).toLowerCase().trim();
  id = id.replace(VENDOR_PREFIX, "");
  for (let i = 0; i < 3; i += 1) id = id.replace(ALIAS_SUFFIX, "");
  return id.replace(/[\s_]+/g, "-");
}

function rank(model: PublicModel): number {
  // Prefer a real, un-suffixed model; then the cheapest; then the shortest id.
  const suffixPenalty = ALIAS_SUFFIX.test(model.modelId ?? model.id) ? 1000 : 0;
  const cost = (model.costIn ?? 0) * 100 + (model.costOut ?? 0) * 100;
  return suffixPenalty + cost + (model.modelId ?? model.id).length / 100;
}

export interface CatalogueResult {
  models: PublicModel[];
  removedDead: number;
  removedDuplicate: number;
}

export function pruneCatalogue(models: PublicModel[]): CatalogueResult {
  const byNormalised = new Map<string, PublicModel>();
  let removedDead = 0;
  let removedDuplicate = 0;

  for (const model of models) {
    const upstream = model.modelId ?? model.id;
    if (NON_CHAT.test(upstream) || ROUTER_ALIAS.test(upstream)) {
      removedDead += 1;
      continue;
    }
    const key = normalise(model);
    const existing = byNormalised.get(key);
    if (!existing) {
      byNormalised.set(key, model);
      continue;
    }
    removedDuplicate += 1;
    if (rank(model) < rank(existing)) byNormalised.set(key, model);
  }

  const pruned = [...byNormalised.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { models: pruned, removedDead, removedDuplicate };
}

/* -------------------------------------------------------------------------- */
/* Registry-level pruning (before the catalogue becomes public)                */
/* -------------------------------------------------------------------------- */

const VENDOR_PREFIX_REF =
  /^(meta-llama|mistralai|mistral|qwen|qwenlm|deepseek|google|openai|anthropic|nvidia|microsoft|x-ai|xai|cohere|amazon|moonshotai|moonshot|z-ai|thudm|baai|meta|ibm-granite|allenai|nousresearch|perplexity|openrouter|together|groq|fireworks|cerebras|sao10k|gryphe)\//;

/** Version/tier suffixes that turn one row into an alias of another. */
const ALIAS_SUFFIX_REF = /(:free|:extended|:online|:nitro|:floor|:beta|:stable|-latest|-preview|-experimental|-\d{4}-\d{2}-\d{2}|-v\d+:\d+)$/i;

/** Router pseudonyms: they are not models the user can pick directly. */
const ROUTER_PSEUDONYM = /(^|[/:])(auto|router|random|best|default|somerandom)([-:]|$)|openrouter\/auto/i;

export function normaliseModelId(modelId: string): string {
  let id = modelId.toLowerCase().trim().replace(VENDOR_PREFIX_REF, "");
  for (let i = 0; i < 3; i += 1) id = id.replace(ALIAS_SUFFIX_REF, "");
  return id.replace(/[\s_]+/g, "-");
}

export interface PruneOutcome<T> {
  models: T[];
  /** Rows dropped because they can never serve a chat turn here. */
  dead: number;
  /** Rows folded into an equivalent alias of the same model. */
  duplicates: number;
  /** Keys of the rows that were folded away. */
  dropped: string[];
}

/**
 * Remove dead rows and fold aliases, keeping the best-ranked representative of
 * each model. `health` is our own runtime record: a model that answered with
 * "not found" or "unauthorised" is dropped from the picker instead of being
 * offered and failing.
 */
export function pruneModels<T extends { key: string; modelId: string; costIn?: number; costOut?: number; priority: number }>(
  models: T[],
  health?: (key: string) => string | null,
): PruneOutcome<T> {
  const best = new Map<string, T>();
  const dropped: string[] = [];
  let dead = 0;
  let duplicates = 0;

  for (const model of models) {
    if (ROUTER_PSEUDONYM.test(model.modelId)) {
      dead += 1;
      dropped.push(model.key);
      continue;
    }
    const reason = health?.(model.key) ?? null;
    if (reason === "not-found" || reason === "auth" || reason === "no-vision") {
      dead += 1;
      dropped.push(model.key);
      continue;
    }
    const id = normaliseModelId(model.modelId);
    const current = best.get(id);
    if (!current) {
      best.set(id, model);
      continue;
    }
    duplicates += 1;
    const score = (m: T) => (m.costIn ?? 0) * 100 + (m.costOut ?? 0) * 10 + m.priority / 100;
    dropped.push(model.key);
    if (score(model) < score(current)) best.set(id, model);
  }

  return { models: [...best.values()], dead, duplicates, dropped };
}
