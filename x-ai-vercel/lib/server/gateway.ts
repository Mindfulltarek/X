import "server-only";

import type { PublicModel } from "@/lib/types";
import { getServerConfig, isGatewayConfigured, type ServerConfig } from "./config";
import { apiError, type ErrorCode } from "./errors";

/**
 * Server-side OmniRoute client.
 *
 * Verified against the official OmniRoute repository (release/v3.8.52 docs):
 *  - Base URL is the OpenAI-compatible mount, e.g. http://localhost:20128/v1
 *  - Auth: `Authorization: Bearer <key created in the OmniRoute dashboard>`
 *  - GET  /v1/models                    → chat + image + combo catalog
 *  - GET  /v1/models?capability=vision  → vision-filtered catalog
 *  - GET  /v1/models?kind=image         → image models
 *  - POST /v1/chat/completions          → OpenAI-compatible chat (streaming supported)
 *  - POST /v1/images/generations        → provider image generation
 *
 * Everything in this module runs on the server only. The raw upstream body is
 * never returned to the browser.
 */

export interface GatewayRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Extra headers (e.g. correlation id). */
  headers?: Record<string, string>;
}

function authHeaders(cfg: ServerConfig, extra?: Record<string, string>): HeadersInit {
  if (!cfg.gatewayApiKey) {
    throw apiError("not_configured");
  }
  return {
    Authorization: `Bearer ${cfg.gatewayApiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

/** Low-level request against the configured gateway. Throws ApiError on failure. */
export async function gatewayFetch(
  path: string,
  init: RequestInit,
  opts: GatewayRequestOptions = {},
): Promise<Response> {
  const cfg = getServerConfig();
  if (!isGatewayConfigured(cfg)) {
    throw apiError("not_configured", {
      details: cfg.gatewayConfigError ?? undefined,
    });
  }
  const base = cfg.gatewayBaseUrl as string;
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const timeoutMs = opts.timeoutMs ?? cfg.gatewayRequestTimeoutMs;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(cfg, opts.headers), ...(init.headers as Record<string, string> | undefined) },
      signal: combineSignals(opts.signal, timeoutMs),
      cache: "no-store",
      redirect: "follow",
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw apiError("upstream_timeout");
    }
    // Network/DNS/TLS failure — the gateway is unreachable from this host.
    console.warn("[x-ai] gateway unreachable:", name ?? "network error");
    throw apiError("upstream_unavailable");
  }
  return res;
}

/** Maps an upstream HTTP status to our error taxonomy. */
export function classifyUpstreamStatus(status: number): { code: ErrorCode; retryable: boolean } {
  if (status === 401) return { code: "unauthorized_upstream", retryable: false };
  if (status === 403) return { code: "forbidden_upstream", retryable: false };
  if (status === 404) return { code: "model_not_found", retryable: true };
  if (status === 408) return { code: "upstream_timeout", retryable: true };
  if (status === 413) return { code: "payload_too_large", retryable: false };
  if (status === 422) return { code: "model_no_vision", retryable: false };
  if (status === 429) return { code: "rate_limited_upstream", retryable: true };
  if (status === 400) return { code: "bad_request", retryable: false };
  if (status >= 500) return { code: "upstream_unavailable", retryable: true };
  return { code: "internal", retryable: false };
}

/** Reads a small snippet of an upstream error for classification/logging only. */
export async function safeUpstreamSnippet(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 600);
    // Keep only the human message fields; never return this to the client.
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const msg =
        (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ?? parsed.message ?? text;
      return String(msg).slice(0, 300).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
    } catch {
      return text.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 300);
    }
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Model catalog                                                              */
/* -------------------------------------------------------------------------- */

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
  description?: unknown;
}

function truthyCapability(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((v) => typeof v === "string" && v.toLowerCase() === key);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return record[key] === true || record[key] === "true";
  }
  return false;
}

function detectVision(raw: RawModel): boolean {
  if (truthyCapability(raw.capabilities, "vision")) return true;
  if (truthyCapability(raw.capability, "vision")) return true;
  const mods = raw.modalities ?? raw.input_modalities;
  if (Array.isArray(mods) && mods.some((m) => typeof m === "string" && m.toLowerCase() === "image")) return true;
  if (mods && typeof mods === "object") {
    const input = (mods as Record<string, unknown>).input;
    if (Array.isArray(input) && input.some((m) => typeof m === "string" && m.toLowerCase() === "image")) {
      return true;
    }
  }
  return false;
}

function detectKind(raw: RawModel): string {
  const kind = raw.type ?? raw.kind;
  if (typeof kind === "string" && kind.trim()) return kind.trim().toLowerCase();
  return "chat";
}

function normaliseModel(raw: RawModel): PublicModel | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > 220) return null;
  const providerFromId = id.includes("/") ? id.split("/")[0] : undefined;
  const provider =
    (typeof raw.provider === "string" && raw.provider) ||
    (typeof raw.owned_by === "string" && raw.owned_by) ||
    providerFromId;
  const label = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const ctxRaw = raw.context_length ?? raw.context_window;
  const contextLength = typeof ctxRaw === "number" && Number.isFinite(ctxRaw) ? ctxRaw : undefined;
  return {
    id,
    label,
    provider: provider || undefined,
    kind: detectKind(raw),
    vision: detectVision(raw),
    contextLength,
  };
}

export interface ModelCatalog {
  models: PublicModel[];
  visionModels: string[];
  imageModels: string[];
  autoAvailable: boolean;
  fetchedAt: number;
}

interface CacheEntry {
  data: ModelCatalog;
  expires: number;
}

const MODEL_CACHE_TTL_MS = 60_000;
let modelCache: CacheEntry | null = null;

/**
 * Fetches and normalises the model catalog from the gateway.
 * `?prefix=alias` keeps the picker to one entry per model, as recommended by
 * the OmniRoute docs for model pickers.
 */
export async function fetchModelCatalog(opts: { force?: boolean } = {}): Promise<ModelCatalog> {
  const cfg = getServerConfig();
  if (!isGatewayConfigured(cfg)) throw apiError("not_configured", { details: cfg.gatewayConfigError ?? undefined });

  const now = Date.now();
  if (!opts.force && modelCache && modelCache.expires > now) return modelCache.data;

  const res = await gatewayFetch("/models?prefix=alias", { method: "GET" }, { timeoutMs: Math.min(cfg.gatewayRequestTimeoutMs, 20_000) });
  if (!res.ok) {
    const { code } = classifyUpstreamStatus(res.status);
    const detail = await safeUpstreamSnippet(res);
    throw apiError(code, { details: `models ${res.status}: ${detail}` });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw apiError("invalid_response", { details: "models: body was not JSON" });
  }

  const list = Array.isArray(json)
    ? (json as RawModel[])
    : Array.isArray((json as { data?: unknown })?.data)
      ? ((json as { data: RawModel[] }).data)
      : null;

  if (!list) throw apiError("invalid_response", { details: "models: unexpected shape" });

  const seen = new Set<string>();
  const models: PublicModel[] = [];
  for (const raw of list.slice(0, 4000)) {
    const model = normaliseModel(raw ?? {});
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }

  const autoAvailable = seen.has("auto");
  const data: ModelCatalog = {
    models,
    visionModels: models.filter((m) => m.vision && (m.kind === "chat" || m.kind === "unknown")).map((m) => m.id).slice(0, 200),
    imageModels: models.filter((m) => m.kind === "image").map((m) => m.id).slice(0, 200),
    autoAvailable,
    fetchedAt: now,
  };

  modelCache = { data, expires: now + MODEL_CACHE_TTL_MS };
  return data;
}

export function peekModelCatalog(): ModelCatalog | null {
  if (modelCache && modelCache.expires > Date.now()) return modelCache.data;
  return null;
}

export function invalidateModelCache(): void {
  modelCache = null;
}

export function findModel(catalog: ModelCatalog | null, id: string): PublicModel | undefined {
  return catalog?.models.find((m) => m.id === id);
}

/** Lightweight reachability probe used by /api/health. */
export async function probeGateway(): Promise<{ latencyMs: number; modelCount?: number; version?: string }> {
  const started = Date.now();
  const res = await gatewayFetch("/models?prefix=alias", { method: "GET" }, { timeoutMs: 12_000 });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const { code } = classifyUpstreamStatus(res.status);
    throw apiError(code, { details: `health ${res.status}` });
  }
  let modelCount: number | undefined;
  try {
    const json = (await res.json()) as { data?: unknown[] };
    if (Array.isArray(json.data)) modelCount = json.data.length;
  } catch {
    modelCount = undefined;
  }
  return {
    latencyMs,
    modelCount,
    version: res.headers.get("x-omniroute-version") ?? undefined,
  };
}
