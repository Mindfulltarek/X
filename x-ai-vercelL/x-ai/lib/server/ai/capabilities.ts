import "server-only";

import type { Capability, CapabilitySource, LatencyClass, ModelConfig } from "./types";

/**
 * Capability detection.
 *
 * Different gateways describe models differently, so this module understands
 * three real-world shapes and merges them:
 *
 *  1. OpenRouter-style (`/api/v1/models`): `architecture.input_modalities`,
 *     `architecture.output_modalities`, `architecture.modality`,
 *     `supported_parameters`, `pricing`, `context_length`.
 *  2. OmniRoute-style: `capabilities` (object or array), `type`/`kind`,
 *     `context_length`.
 *  3. Generic / minimal: only `id`, sometimes `name`.
 *
 * Manual declarations in configuration always win over anything discovered, and
 * are the recommended way to pin capabilities for providers that publish no
 * metadata. Name-based heuristics are used only for *ranking hints* in that
 * last case — and a model is never claimed to support vision on a heuristic
 * alone unless its family is a known vision family (see VISION_HEURISTICS).
 */

interface RawModel {
  id?: unknown;
  name?: unknown;
  object?: unknown;
  owned_by?: unknown;
  provider?: unknown;
  type?: unknown;
  kind?: unknown;
  context_length?: unknown;
  context_window?: unknown;
  capabilities?: unknown;
  capability?: unknown;
  modalities?: unknown;
  input_modalities?: unknown;
  architecture?: unknown;
  supported_parameters?: unknown;
  pricing?: unknown;
  reasoning?: unknown;
  top_provider?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
}

/** True if `haystack` mentions `needle` as a whole-ish token. */
function mentions(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

/**
 * Well-known vision-capable model families. Used ONLY when the provider
 * publishes no modality metadata. Conservative on purpose: a false positive
 * means sending an image to a text model, which the provider rejects.
 */
const VISION_HEURISTICS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-4-turbo",
  "gpt-5",
  "o3",
  "o4-mini",
  "claude-3",
  "claude-4",
  "claude-sonnet",
  "claude-opus",
  "claude-haiku",
  "gemini-1.5",
  "gemini-2",
  "gemini-3",
  "gemini-pro",
  "gemini-flash",
  "llama-3.2-vision",
  "llama-4",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "pixtral",
  "llava",
  "moondream",
  "internvl",
  "glm-4v",
  "glm-4.5v",
  "mistral-small-3",
  "mistral-medium-3",
  "gemma-3",
  "grok-2-vision",
  "grok-4",
  "nova-pro",
  "nova-lite",
  "phi-3-vision",
  "phi-4-reasoning-vision",
  "kimi-vl",
  "step-1o",
  "minicpm-v",
  "idefics",
];

/** Families that are strong at code review / generation. */
const CODING_HEURISTICS = [
  "codestral",
  "codex",
  "coder",
  "codellama",
  "devstral",
  "deepseek-v3",
  "deepseek-v4",
  "deepseek-r1",
  "claude-sonnet",
  "claude-opus",
  "gpt-5",
  "gpt-4.1",
  "o3",
  "o4",
  "qwen-coder",
  "qwen2.5-coder",
  "qwen3-coder",
  "kimi-k2",
  "glm-4.5",
  "glm-4.6",
  "grok-code",
  "gemini-2.5-pro",
  "gemini-3-pro",
  "command-a",
  "sonar",
];

/** Families that are strong at multi-step reasoning / analysis. */
const REASONING_HEURISTICS = [
  "o1",
  "o3",
  "o4",
  "reason",
  "thinking",
  "deepseek-r1",
  "qwq",
  "magistral",
  "gpt-5",
  "claude-opus",
  "gemini-2.5-pro",
  "gemini-3-pro",
  "grok-4",
  "kimi-k2-thinking",
  "glm-4.6",
];

/** Families that are optimised for latency or price. */
const FAST_HEURISTICS = [
  "fast",
  "flash",
  "flash-lite",
  "mini",
  "nano",
  "turbo",
  "instant",
  "haiku",
  "small",
  "lite",
  "lightning",
  "8b",
  "7b",
  "4b",
  "3b",
  "1b",
  "0.5b",
  "air",
];

function matchesFamily(idOrName: string, families: string[]): boolean {
  return families.some((family) => mentions(idOrName, family));
}

/** Reads a numeric price (per token or per 1M) into USD per 1M tokens. */
function pricePerMillion(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value <= 0 ? 0 : value * 1_000_000;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed <= 0 ? 0 : parsed * 1_000_000;
  }
  return undefined;
}

export interface RawModelInfo {
  modelId: string;
  label: string;
  contextLength?: number;
  costIn?: number;
  costOut?: number;
  maxCompletionTokens?: number;
  capabilities: Set<Capability>;
  sources: Partial<Record<Capability, CapabilitySource>>;
}

/** Extracts everything the router needs from one raw catalogue row. */
export function parseRawModel(raw: RawModel): RawModelInfo | null {
  const modelId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!modelId || modelId.length > 220) return null;

  const label = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : modelId;
  const haystack = `${modelId} ${label}`.toLowerCase();
  const caps = new Set<Capability>();
  const sources: Partial<Record<Capability, CapabilitySource>> = {};

  const mark = (cap: Capability, source: CapabilitySource) => {
    caps.add(cap);
    sources[cap] = source;
  };

  /* ---------------- OpenRouter-style metadata ---------------- */
  const architecture = asRecord(raw.architecture);
  if (architecture) {
    const input = asStringArray(architecture.input_modalities);
    const output = asStringArray(architecture.output_modalities);
    const modality = typeof architecture.modality === "string" ? architecture.modality.toLowerCase() : "";

    if (input.some((m) => m === "image" || m === "image_url") || modality.startsWith("text+image")) {
      mark("vision", "provider-metadata");
    }
    if (output.includes("image") || modality.endsWith(">image")) {
      mark("image-gen", "provider-metadata");
    }
    if (input.includes("file") || input.includes("pdf") || input.includes("document")) {
      mark("document", "provider-metadata");
    }
  }

  /* ---------------- OmniRoute-style metadata ---------------- */
  const capabilityBag = raw.capabilities;
  if (Array.isArray(capabilityBag)) {
    for (const value of asStringArray(capabilityBag)) {
      if (value === "vision" || value === "attachment") mark("vision", "provider-metadata");
      if (value === "tool_calling") mark("tools", "provider-metadata");
      if (value === "reasoning" || value === "thinking") mark("reasoning", "provider-metadata");
      if (value === "structured_output" || value === "json") mark("json", "provider-metadata");
    }
  } else {
    const bag = asRecord(capabilityBag);
    if (bag) {
      if (bag.vision === true) mark("vision", "provider-metadata");
      if (bag.tool_calling === true || bag.tools === true) mark("tools", "provider-metadata");
      if (bag.reasoning === true || bag.thinking === true) mark("reasoning", "provider-metadata");
      if (bag.structured_output === true || bag.json_mode === true) mark("json", "provider-metadata");
    }
  }

  const singleCapability = raw.capability;
  if (Array.isArray(singleCapability)) {
    for (const value of asStringArray(singleCapability)) {
      if (value === "vision") mark("vision", "provider-metadata");
      if (value === "tool_calling") mark("tools", "provider-metadata");
    }
  }

  const modalityBag = asRecord(raw.modalities) ?? asRecord(raw.input_modalities);
  if (modalityBag) {
    const input = asStringArray(modalityBag.input);
    if (input.includes("image")) mark("vision", "provider-metadata");
    if (input.includes("file") || input.includes("document")) mark("document", "provider-metadata");
    const output = asStringArray(modalityBag.output);
    if (output.includes("image")) mark("image-gen", "provider-metadata");
  } else if (Array.isArray(raw.input_modalities)) {
    if (asStringArray(raw.input_modalities).includes("image")) mark("vision", "provider-metadata");
  }

  const kindRaw = raw.type ?? raw.kind;
  const kind = typeof kindRaw === "string" ? kindRaw.toLowerCase() : "";
  if (kind === "image") mark("image-gen", "provider-metadata");
  if (kind === "embedding" || kind === "rerank" || kind === "audio" || kind === "video" || kind === "music") {
    // Not a chat-capable model for our purposes.
    return null;
  }

  /* ---------------- shared metadata ---------------- */
  const supportedParameters = asStringArray(raw.supported_parameters);
  if (supportedParameters.includes("tools") || supportedParameters.includes("tool_choice")) {
    mark("tools", "provider-metadata");
  }
  if (supportedParameters.includes("response_format")) mark("json", "provider-metadata");
  if (supportedParameters.includes("reasoning") || supportedParameters.includes("include_reasoning")) {
    mark("reasoning", "provider-metadata");
  }
  if (raw.reasoning === true) mark("reasoning", "provider-metadata");

  const contextRaw = raw.context_length ?? raw.context_window ?? asRecord(raw.top_provider)?.context_length;
  const contextLength =
    typeof contextRaw === "number" && Number.isFinite(contextRaw) ? contextRaw : undefined;
  if (contextLength && contextLength >= 200_000) mark("long-context", "provider-metadata");

  const pricing = asRecord(raw.pricing);
  const costIn = pricePerMillion(pricing?.prompt);
  const costOut = pricePerMillion(pricing?.completion);
  const maxCompletionRaw = asRecord(raw.top_provider)?.max_completion_tokens;
  const maxCompletionTokens =
    typeof maxCompletionRaw === "number" && Number.isFinite(maxCompletionRaw) ? maxCompletionRaw : undefined;

  /* ---------------- heuristics (ranking hints) ---------------- */
  if (!caps.has("vision") && matchesFamily(haystack, VISION_HEURISTICS)) {
    mark("vision", "heuristic");
  }
  if (matchesFamily(haystack, CODING_HEURISTICS)) mark("coding", "heuristic");
  if (matchesFamily(haystack, REASONING_HEURISTICS)) mark("reasoning", "heuristic");
  if (matchesFamily(haystack, FAST_HEURISTICS)) mark("fast", "heuristic");
  if (costIn === 0) mark("fast", "provider-metadata");
  // Web search through a suffix route (e.g. OpenRouter's `:online`).
  if (modelId.endsWith(":online")) mark("web", "provider-metadata");

  return { modelId, label, contextLength, costIn, costOut, maxCompletionTokens, capabilities: caps, sources };
}

/** Applies a manual model declaration on top of discovered data. */
export function applyModelConfig(
  base: RawModelInfo,
  cfg: ModelConfig | undefined,
): RawModelInfo {
  if (!cfg) return base;
  const capabilities = new Set<Capability>(base.capabilities);
  const sources = { ...base.sources };
  if (cfg.capabilities) {
    for (const cap of cfg.capabilities) {
      capabilities.add(cap);
      sources[cap] = "config";
    }
  }
  return {
    ...base,
    label: cfg.label ?? base.label,
    contextLength: cfg.contextLength ?? base.contextLength,
    costIn: cfg.costIn ?? base.costIn,
    costOut: cfg.costOut ?? base.costOut,
    maxCompletionTokens: cfg.maxCompletionTokens ? base.maxCompletionTokens : base.maxCompletionTokens,
    capabilities,
    sources,
  };
}

/** Builds the capability set for a model that exists only in configuration. */
export function capabilitiesFromConfig(modelId: string, cfg: ModelConfig): RawModelInfo {
  const synthetic = parseRawModel({ id: modelId });
  const base: RawModelInfo =
    synthetic ?? {
      modelId,
      label: cfg.label ?? modelId,
      capabilities: new Set<Capability>(),
      sources: {},
    };
  return applyModelConfig(base, cfg);
}

export function latencyClassFrom(cfg: ModelConfig | undefined, caps: Set<Capability>): LatencyClass {
  if (cfg?.latency) return cfg.latency;
  if (caps.has("fast")) return "low";
  return "medium";
}

export function describeCapabilities(caps: Set<Capability>): string {
  return [...caps].sort().join(", ") || "chat only";
}
