import "server-only";

import {
  applyModelConfig,
  capabilitiesFromConfig,
  latencyClassFrom,
  parseRawModel,
  type RawModelInfo,
} from "./capabilities";
import { getProviders, type ProviderLoadResult } from "./providers";
import type {
  AISettings,
  Capability,
  ConfigIssue,
  ModelConfig,
  ModelRef,
  ProviderConfig,
  ProviderState,
} from "./types";

/**
 * Model registry.
 *
 * Builds the list of models the router may choose from by combining:
 *   - the provider's live catalogue (`GET {baseUrl}/models`), when enabled;
 *   - the operator's manual model entries (always trusted, and the only way to
 *     describe capabilities for providers that publish no metadata).
 *
 * Results are cached for `AI_DISCOVERY_CACHE_SECONDS`. A provider that fails is
 * never fatal: it is reported with a status, and the other providers keep
 * serving. Manual models still work when catalogue discovery fails.
 */

export interface RegistrySnapshot {
  providers: ProviderState[];
  models: ModelRef[];
  issues: ConfigIssue[];
  settings: AISettings;
  source: ProviderLoadResult["source"];
  fetchedAt: number;
  /** True when at least one provider is usable. */
  ready: boolean;
}

interface CacheEntry {
  snapshot: RegistrySnapshot;
  expires: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<RegistrySnapshot> | null = null;

/* -------------------------------------------------------------------------- */
/* Runtime model health (per server instance)                                  */
/* -------------------------------------------------------------------------- */

const MODEL_TTL_MS = 10 * 60_000;

interface ModelHealth {
  disabledUntil: number;
  reason: "no-vision" | "not-found" | "quota" | "auth" | "error";
}

const modelHealth = new Map<string, ModelHealth>();

export function reportModelFailure(key: string, reason: ModelHealth["reason"], ttlMs = MODEL_TTL_MS): void {
  modelHealth.set(key, { disabledUntil: Date.now() + ttlMs, reason });
}

export function reportModelSuccess(key: string): void {
  modelHealth.delete(key);
}

export function modelHealthReason(key: string): ModelHealth["reason"] | null {
  const entry = modelHealth.get(key);
  if (!entry) return null;
  if (entry.disabledUntil <= Date.now()) {
    modelHealth.delete(key);
    return null;
  }
  return entry.reason;
}

export function resetModelHealth(): void {
  modelHealth.clear();
}

/* -------------------------------------------------------------------------- */
/* Catalogue fetch                                                             */
/* -------------------------------------------------------------------------- */

interface FetchOutcome {
  models: RawModelInfo[];
  status: ProviderState["status"];
  message?: string;
  latencyMs?: number;
  catalogFromProvider: boolean;
}

function authHeaders(provider: ProviderConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${provider.apiKey ?? ""}`,
    Accept: "application/json",
    ...provider.headers,
  };
}

function classifyFetchError(status: number): ProviderState["status"] {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "unavailable";
}

function buildModels(raw: unknown): RawModelInfo[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data as unknown[])
      : Array.isArray((raw as { models?: unknown })?.models)
        ? ((raw as { models: unknown[] }).models as unknown[])
        : [];

  const out: RawModelInfo[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const info = parseRawModel(row as Record<string, unknown>);
    if (!info || seen.has(info.modelId)) continue;
    seen.add(info.modelId);
    out.push(info);
  }
  return out;
}

async function fetchProviderModels(provider: ProviderConfig, timeoutMs: number): Promise<FetchOutcome> {
  const manual = provider.models.filter((m) => m.enabled !== false);

  if (!provider.apiKey) {
    return {
      models: manual.map((m) => capabilitiesFromConfig(m.id, m)),
      status: "not_configured",
      message: `Environment variable ${provider.apiKeyEnv || "(apiKeyEnv)"} is not set.`,
      catalogFromProvider: false,
    };
  }
  if (!provider.discover) {
    return {
      models: manual.map((m) => capabilitiesFromConfig(m.id, m)),
      status: "ok",
      catalogFromProvider: false,
    };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      method: "GET",
      headers: authHeaders(provider),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const status = classifyFetchError(res.status);
      return {
        models: manual.map((m) => capabilitiesFromConfig(m.id, m)),
        status,
        message:
          status === "unauthorized"
            ? `The provider rejected the API key in ${provider.apiKeyEnv || "the configured variable"}.`
            : status === "forbidden"
              ? "The provider refused access to its model catalogue."
              : `The model catalogue returned HTTP ${res.status}.`,
        latencyMs,
        catalogFromProvider: false,
      };
    }

    const json: unknown = await res.json();
    const discovered = buildModels(json);
    if (discovered.length === 0) {
      return {
        models: manual.map((m) => capabilitiesFromConfig(m.id, m)),
        status: "unavailable",
        message: "The provider returned an empty model catalogue.",
        latencyMs,
        catalogFromProvider: false,
      };
    }
    return { models: discovered, status: "ok", latencyMs, catalogFromProvider: true };
  } catch (err) {
    const timedOut = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
    return {
      models: manual.map((m) => capabilitiesFromConfig(m.id, m)),
      status: "unavailable",
      message: timedOut ? "The provider did not respond in time." : "The provider could not be reached.",
      catalogFromProvider: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

function mergeProvider(provider: ProviderConfig, outcome: FetchOutcome): ProviderState {
  const configById = new Map<string, ModelConfig>();
  for (const model of provider.models) configById.set(model.id, model);
  const disabled = new Set(provider.models.filter((m) => m.enabled === false).map((m) => m.id));

  const models: ModelRef[] = [];
  const seen = new Set<string>();

  for (const info of outcome.models) {
    if (disabled.has(info.modelId)) continue;
    const cfg = configById.get(info.modelId);
    const withConfig = applyModelConfig(info, cfg);
    if (cfg?.enabled === false) continue;
    seen.add(info.modelId);
    models.push(toModelRef(provider, withConfig, cfg, outcome.catalogFromProvider));
  }

  // Manual models that the catalogue did not return are still usable.
  for (const cfg of provider.models) {
    if (seen.has(cfg.id) || cfg.enabled === false) continue;
    const info = capabilitiesFromConfig(cfg.id, cfg);
    models.push(toModelRef(provider, info, cfg, false));
  }

  return {
    config: provider,
    status: outcome.status,
    message: outcome.message,
    models,
    latencyMs: outcome.latencyMs,
    checkedAt: Date.now(),
    catalogFromProvider: outcome.catalogFromProvider,
  };
}

function toModelRef(
  provider: ProviderConfig,
  info: RawModelInfo,
  cfg: ModelConfig | undefined,
  discovered: boolean,
): ModelRef {
  const providerPriority = provider.priority;
  const modelPriority = cfg?.priority ?? 100;
  return {
    key: `${provider.id}::${info.modelId}`,
    providerId: provider.id,
    providerLabel: provider.label,
    modelId: info.modelId,
    label: info.label,
    capabilities: info.capabilities,
    capabilitySources: info.sources,
    contextLength: info.contextLength,
    costIn: info.costIn,
    costOut: info.costOut,
    latency: latencyClassFrom(cfg, info.capabilities),
    priority: providerPriority * 1000 + modelPriority,
    discovered,
    manual: Boolean(cfg),
    maxTokens: cfg?.maxTokens,
    maxCompletionTokens: cfg?.maxCompletionTokens,
    webSuffix: cfg?.webSuffix,
  };
}

export async function getRegistry(options: { force?: boolean } = {}): Promise<RegistrySnapshot> {
  const loaded = getProviders();
  const now = Date.now();

  if (!options.force && cache && cache.expires > now) return cache.snapshot;
  if (!options.force && inflight) return inflight;

  const build = (async (): Promise<RegistrySnapshot> => {
    const outcomes = await Promise.all(
      loaded.providers.map(async (provider) => ({
        provider,
        outcome: await fetchProviderModels(provider, loaded.settings.discoveryTimeoutMs),
      })),
    );

    const states = outcomes.map(({ provider, outcome }) => mergeProvider(provider, outcome));
    const models = states.flatMap((state) => state.models);
    const ready = states.some((state) => state.status === "ok" && state.models.length > 0);

    const snapshot: RegistrySnapshot = {
      providers: states,
      models,
      issues: loaded.issues,
      settings: loaded.settings,
      source: loaded.source,
      fetchedAt: now,
      ready,
    };
    cache = { snapshot, expires: now + loaded.settings.discoveryCacheSeconds * 1000 };
    return snapshot;
  })();

  inflight = build;
  try {
    return await build;
  } finally {
    inflight = null;
  }
}

export function peekRegistry(): RegistrySnapshot | null {
  return cache && cache.expires > Date.now() ? cache.snapshot : null;
}

export function invalidateRegistry(): void {
  cache = null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function findModelByKey(snapshot: RegistrySnapshot, key: string): ModelRef | undefined {
  return snapshot.models.find((m) => m.key === key);
}

export function capabilitiesHistogram(models: ModelRef[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const model of models) {
    for (const cap of model.capabilities) counts[cap] = (counts[cap] ?? 0) + 1;
  }
  return counts;
}

/** Safe, client-facing catalogue entry. */
export interface PublicModelInfo {
  /** Stable client id: `provider::model`. */
  id: string;
  modelId: string;
  label: string;
  providerId: string;
  providerLabel: string;
  capabilities: Capability[];
  contextLength?: number;
  costIn?: number;
  costOut?: number;
}

export function toPublicModel(model: ModelRef): PublicModelInfo {
  return {
    id: model.key,
    modelId: model.modelId,
    label: model.label,
    providerId: model.providerId,
    providerLabel: model.providerLabel,
    capabilities: [...model.capabilities],
    contextLength: model.contextLength,
    costIn: model.costIn,
    costOut: model.costOut,
  };
}

/** Safe, client-facing provider entry — never includes keys or full URLs. */
export interface PublicProviderInfo {
  id: string;
  label: string;
  status: ProviderState["status"];
  message?: string;
  host: string;
  modelCount: number;
  latencyMs?: number;
  catalogFromProvider: boolean;
  webSearch: ProviderConfig["webSearch"];
  imageGeneration: boolean;
}

export function toPublicProvider(state: ProviderState): PublicProviderInfo {
  let host = "";
  try {
    host = new URL(state.config.baseUrl).host;
  } catch {
    host = "invalid url";
  }
  return {
    id: state.config.id,
    label: state.config.label,
    status: state.status,
    message: state.message,
    host,
    modelCount: state.models.length,
    latencyMs: state.latencyMs,
    catalogFromProvider: state.catalogFromProvider,
    webSearch: state.config.webSearch,
    imageGeneration: state.config.imageGeneration,
  };
}
