import "server-only";

/**
 * Core types for the X AI multi-provider layer.
 *
 * Everything here is server-side. Nothing in this module is ever serialised to
 * the browser with secrets in it; the "safe" summaries are built explicitly in
 * `registry.ts` / `providers.ts`.
 */

/** Capabilities the router can reason about. */
export type Capability =
  | "vision" // can read images
  | "coding" // strong at programming
  | "reasoning" // strong at analysis / logic / planning
  | "fast" // optimised for latency
  | "tools" // supports tool / function calling
  | "web" // can ground answers on live web search
  | "image-gen" // produces images
  | "json" // reliable structured output
  | "long-context" // very large context window
  | "document"; // can accept documents (native) — we also extract text ourselves

export type CapabilitySource = "provider-metadata" | "config" | "heuristic";

export interface DiscoveredCapabilities {
  capabilities: Set<Capability>;
  /** Where each capability came from, for the diagnostics endpoint. */
  sources: Partial<Record<Capability, CapabilitySource>>;
}

export type LatencyClass = "low" | "medium" | "high";

/** Manual model entry in the provider configuration. */
export interface ModelConfig {
  id: string;
  label?: string;
  /** Explicit capability declaration — always wins over discovery. */
  capabilities?: Capability[];
  /** Lower number = preferred within its class. */
  priority?: number;
  /** USD per 1M input / output tokens (optional; used for cost-aware routing). */
  costIn?: number;
  costOut?: number;
  latency?: LatencyClass;
  contextLength?: number;
  maxTokens?: number;
  enabled?: boolean;
  /** Send `max_completion_tokens` instead of `max_tokens` (some OpenAI models). */
  maxCompletionTokens?: boolean;
  /** Model id suffix/flag the provider needs for web search (e.g. ":online"). */
  webSuffix?: string;
  notes?: string;
}

export interface ProviderConfig {
  id: string;
  label: string;
  /** Base URL of the OpenAI-compatible API, normalised to end with `/v1` (or the provider's mount). */
  baseUrl: string;
  protocol: "openai";
  /** Environment variable that holds the key. Never the key itself. */
  apiKeyEnv: string;
  /** Resolved server-side only. Never serialised. */
  apiKey: string | null;
  enabled: boolean;
  /** Lower number = preferred provider. */
  priority: number;
  /** Query `GET {baseUrl}/models` and use the result. */
  discover: boolean;
  /** Extra request headers (e.g. OpenRouter's HTTP-Referer / X-Title). */
  headers: Record<string, string>;
  /** Manually declared models — merged with discovery; overrides win. */
  models: ModelConfig[];
  /** Provider serves /images/generations. */
  imageGeneration: boolean;
  /** How to enable web search for models on this provider. */
  webSearch: "none" | "online-suffix";
  notes?: string;
}

export interface ConfigIssue {
  providerId?: string;
  modelId?: string;
  severity: "error" | "warning";
  message: string;
}

/** A model the router can actually choose. */
export interface ModelRef {
  /** Fully-qualified key: `${providerId}::${modelId}` (used as the client-facing id). */
  key: string;
  providerId: string;
  providerLabel: string;
  /** Upstream model id sent to the provider. */
  modelId: string;
  label: string;
  capabilities: Set<Capability>;
  capabilitySources: Partial<Record<Capability, CapabilitySource>>;
  contextLength?: number;
  costIn?: number;
  costOut?: number;
  latency?: LatencyClass;
  priority: number;
  /** Discovered from the provider's catalogue (vs. declared only in config). */
  discovered: boolean;
  /** Config says this model can be called even if it is not in the catalogue. */
  manual: boolean;
  maxTokens?: number;
  maxCompletionTokens?: boolean;
  webSuffix?: string;
}

export interface ProviderState {
  config: ProviderConfig;
  status: "ok" | "unauthorized" | "forbidden" | "unavailable" | "not_configured";
  message?: string;
  models: ModelRef[];
  latencyMs?: number;
  checkedAt: number;
  /** True when the catalogue came from the provider, false when only config models exist. */
  catalogFromProvider: boolean;
}

/** Task classes the classifier emits. */
export type TaskKind =
  | "simple"
  | "general"
  | "reasoning"
  | "coding"
  | "vision"
  | "document"
  | "web"
  | "image-gen";

export interface Classification {
  kind: TaskKind;
  /** Hard requirements — a candidate without these must not be used. */
  requires: Set<Capability>;
  /** Soft preferences, in priority order. */
  prefers: Capability[];
  /** Signals that produced the classification (safe to show in diagnostics). */
  signals: string[];
  /** Whether the user explicitly asked for an image to be produced. */
  imageGenerationIntent: boolean;
  needsWeb: boolean;
}

export interface RouteDecision {
  classification: Classification;
  /** Ordered candidates: the first is primary, the rest are fallbacks. */
  candidates: ModelRef[];
  /** Human-readable reason, safe to expose. */
  reason: string;
  /** Rejected models and why (diagnostics only). */
  rejected: { model: string; reason: string }[];
}

export interface FileInput {
  name: string;
  mime: string;
  /** base64 data URL or raw base64 with mime. */
  dataUrl: string;
}

export interface ExtractedFile {
  name: string;
  mime: string;
  kind: "image" | "document" | "text";
  /** For images: the data URL to send to a vision model. */
  imageDataUrl?: string;
  /** For documents/text: extracted plain text. */
  text?: string;
  bytes: number;
  truncated?: boolean;
  warning?: string;
}

/** Operational limits and switches for the AI layer (all env-driven). */
export interface AISettings {
  /** Candidate cap per request (including fallbacks). */
  maxCandidates: number;
  /** Hard cap on distinct models per request when collaboration is on. */
  maxModelsPerRequest: number;
  collaboration: "off" | "review";
  discoveryCacheSeconds: number;
  discoveryTimeoutMs: number;
  requestTimeoutMs: number;
  streamTimeoutMs: number;
  maxOutputTokens: number;
  maxDocumentChars: number;
  maxFileBytes: number;
  /** Force a single model key (`provider::model`) for every request. */
  forcedModel?: string;
  /** Extra instruction appended to every system prompt (operator policy). */
  systemSuffix?: string;
  routerEnabled: boolean;
  /** Optional override for the image model. */
  imageModel?: string;
}
