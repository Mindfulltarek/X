import "server-only";

import { z } from "zod";

import type { AISettings, Capability, ConfigIssue, ModelConfig, ProviderConfig } from "./types";

/**
 * Provider configuration.
 *
 * Three ways to configure providers, in order of precedence:
 *
 *  1. `AI_PROVIDERS` — a JSON array (the recommended, fully explicit form).
 *  2. Well-known presets: any of `OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
 *     `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`,
 *     `XAI_API_KEY`, `CEREBRAS_API_KEY`, `NVIDIA_API_KEY` that is present adds
 *     that provider automatically (disable with `AI_DISABLE_PRESETS=1`).
 *  3. Legacy single-gateway variables `OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY`
 *     (kept so existing deployments keep working unchanged).
 *
 * API keys are resolved from the environment at request time and kept in
 * memory only. They are never returned by any endpoint, never logged, and never
 * sent to the browser.
 */

const CAPABILITIES = [
  "vision",
  "coding",
  "reasoning",
  "fast",
  "tools",
  "web",
  "image-gen",
  "json",
  "long-context",
  "document",
] as const;

const modelSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().max(200).optional(),
    capabilities: z.array(z.enum(CAPABILITIES)).max(12).optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    costIn: z.number().min(0).max(10_000).optional(),
    costOut: z.number().min(0).max(10_000).optional(),
    latency: z.enum(["low", "medium", "high"]).optional(),
    contextLength: z.number().int().min(0).max(50_000_000).optional(),
    maxTokens: z.number().int().min(1).max(10_000_000).optional(),
    enabled: z.boolean().optional(),
    maxCompletionTokens: z.boolean().optional(),
    webSuffix: z.string().max(40).optional(),
    notes: z.string().max(400).optional(),
  })
  .strict();

const providerSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, "provider id must be alphanumeric (dash/underscore allowed)"),
    label: z.string().trim().max(120).optional(),
    baseUrl: z.string().trim().min(1).max(400),
    apiKeyEnv: z
      .string()
      .trim()
      .max(120)
      .regex(/^[A-Z0-9_]+$/, "apiKeyEnv must be an environment variable NAME, e.g. OPENROUTER_API_KEY")
      .optional(),
    /** Inline key is accepted but discouraged; the key itself is never echoed back. */
    apiKey: z.string().min(4).max(4000).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    discover: z.boolean().optional(),
    models: z.array(modelSchema).max(500).optional(),
    headers: z.record(z.string().max(1000)).optional(),
    imageGeneration: z.boolean().optional(),
    webSearch: z.enum(["none", "online-suffix"]).optional(),
    notes: z.string().max(400).optional(),
  })
  .strict();

const providersSchema = z.array(providerSchema).max(40);

const env = (name: string): string | undefined => {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const envInt = (name: string, fallback: number, min: number, max: number): number => {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const envBool = (name: string, fallback: boolean): boolean => {
  const raw = env(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
};

/** Normalises a provider base URL to the OpenAI-compatible mount. */
export function normaliseBaseUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(chat\/completions|models|images\/generations)$/i, "");
  if (!/\/v\d+[a-z0-9.-]*$/i.test(path)) path = `${path}/v1`;
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/* -------------------------------------------------------------------------- */
/* Presets                                                                     */
/* -------------------------------------------------------------------------- */

interface Preset {
  id: string;
  label: string;
  baseUrl: string;
  keyEnv: string;
  priority: number;
  webSearch?: "none" | "online-suffix";
  extraHeaders?: Record<string, string>;
}

/** Public, documented OpenAI-compatible endpoints. Override baseUrl in AI_PROVIDERS if needed. */
const PRESETS: Preset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    priority: 20,
    webSearch: "online-suffix",
  },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", priority: 20 },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", priority: 20 },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY", priority: 25 },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", priority: 30 },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY", priority: 30 },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", priority: 30 },
  { id: "cerebras", label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", keyEnv: "CEREBRAS_API_KEY", priority: 30 },
  { id: "nvidia", label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", keyEnv: "NVIDIA_API_KEY", priority: 35 },
];

function presetToProvider(preset: Preset): ProviderConfig {
  const referer = env("AI_APP_URL");
  const title = env("AI_APP_NAME");
  const headers: Record<string, string> = { ...(preset.extraHeaders ?? {}) };
  if (preset.id === "openrouter") {
    // OpenRouter recommends identifying the app; harmless elsewhere.
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;
  }
  return {
    id: preset.id,
    label: preset.label,
    baseUrl: normaliseBaseUrl(preset.baseUrl),
    protocol: "openai",
    apiKeyEnv: preset.keyEnv,
    apiKey: env(preset.keyEnv) ?? null,
    enabled: Boolean(env(preset.keyEnv)),
    priority: preset.priority,
    discover: true,
    headers,
    models: [],
    imageGeneration: true,
    webSearch: preset.webSearch ?? "none",
  };
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProviderLoadResult {
  providers: ProviderConfig[];
  issues: ConfigIssue[];
  settings: AISettings;
  /** Where the provider list came from (safe to show). */
  source: "AI_PROVIDERS" | "presets" | "legacy-gateway" | "none";
}

function parseModels(models: z.infer<typeof modelSchema>[] | undefined): ModelConfig[] {
  if (!models) return [];
  return models.map((m) => ({
    ...m,
    capabilities: m.capabilities as Capability[] | undefined,
  }));
}

function collectIssues(providers: ProviderConfig[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id)) {
      issues.push({
        providerId: provider.id,
        severity: "error",
        message: `Duplicate provider id "${provider.id}" — later entries are ignored.`,
      });
      continue;
    }
    seen.add(provider.id);
    if (!provider.apiKey) {
      issues.push({
        providerId: provider.id,
        severity: "error",
        message: `Provider "${provider.id}" is disabled: environment variable ${provider.apiKeyEnv || "(none)"} is not set.`,
      });
    }
    if (provider.models.length === 0 && !provider.discover) {
      issues.push({
        providerId: provider.id,
        severity: "warning",
        message: `Provider "${provider.id}" has discovery disabled and no models configured, so it will never be used.`,
      });
    }
  }
  return issues;
}

export function loadProviders(): ProviderLoadResult {
  const issues: ConfigIssue[] = [];
  let providers: ProviderConfig[] = [];
  let source: ProviderLoadResult["source"] = "none";

  const raw = env("AI_PROVIDERS");
  if (raw) {
    try {
      const json: unknown = JSON.parse(raw);
      const parsed = providersSchema.safeParse(json);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        issues.push({
          severity: "error",
          message: `AI_PROVIDERS is invalid: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "schema error"}`,
        });
      } else {
        source = "AI_PROVIDERS";
        providers = parsed.data.map((entry) => {
          const apiKey = entry.apiKey ?? (entry.apiKeyEnv ? env(entry.apiKeyEnv) : undefined) ?? null;
          return {
            id: entry.id,
            label: entry.label ?? entry.id,
            baseUrl: normaliseBaseUrl(entry.baseUrl),
            protocol: "openai" as const,
            apiKeyEnv: entry.apiKeyEnv ?? "",
            apiKey,
            enabled: entry.enabled ?? true,
            priority: entry.priority ?? 50,
            discover: entry.discover ?? true,
            headers: entry.headers ?? {},
            models: parseModels(entry.models),
            imageGeneration: entry.imageGeneration ?? true,
            webSearch: entry.webSearch ?? "none",
            notes: entry.notes,
          };
        });
      }
    } catch {
      issues.push({ severity: "error", message: "AI_PROVIDERS is not valid JSON." });
    }
  }

  // Presets for any *_API_KEY that is present and not already covered.
  if (!envBool("AI_DISABLE_PRESETS", false)) {
    const existing = new Set(providers.map((p) => p.id));
    const existingHosts = new Set(providers.map((p) => safeHost(p.baseUrl)));
    for (const preset of PRESETS) {
      if (existing.has(preset.id)) continue;
      if (existingHosts.has(safeHost(normaliseBaseUrl(preset.baseUrl)))) continue;
      if (!env(preset.keyEnv)) continue;
      providers.push(presetToProvider(preset));
      if (source === "none") source = "presets";
    }
  }

  // Legacy single-gateway configuration (OmniRoute and any OpenAI-compatible gateway).
  const legacyBase = env("OMNIROUTE_BASE_URL");
  const legacyKey = env("OMNIROUTE_API_KEY");
  if (legacyBase || legacyKey) {
    const already = providers.some((p) => safeHost(p.baseUrl) === safeHost(normaliseBaseUrl(legacyBase ?? "https://invalid.example")));
    if (!already) {
      providers.push({
        id: "gateway",
        label: "Configured gateway",
        baseUrl: legacyBase ? normaliseBaseUrl(legacyBase) : "",
        protocol: "openai",
        apiKeyEnv: "OMNIROUTE_API_KEY",
        apiKey: legacyKey ?? null,
        enabled: Boolean(legacyBase && legacyKey),
        priority: 10,
        discover: true,
        headers: {},
        models: [],
        imageGeneration: true,
        webSearch: "none",
        notes: "Legacy OMNIROUTE_* variables",
      });
      if (source === "none") source = "legacy-gateway";
    }
  }

  // Legacy fallback model list: expose as manual models so behaviour is preserved.
  const legacyFallbacks = (env("OMNIROUTE_FALLBACK_MODELS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (legacyFallbacks.length > 0) {
    const gateway = providers.find((p) => p.id === "gateway");
    if (gateway) {
      gateway.models = legacyFallbacks.map((id, index) => ({ id, priority: 100 + index }));
    }
  }
  const legacyVision = env("OMNIROUTE_VISION_MODEL");
  if (legacyVision) {
    const gateway = providers.find((p) => p.id === "gateway");
    if (gateway && !gateway.models.some((m) => m.id === legacyVision)) {
      gateway.models.push({ id: legacyVision, capabilities: ["vision"], priority: 50 });
    }
  }

  providers = providers.filter((p) => p.enabled !== false || p.apiKey);
  issues.push(...collectIssues(providers));

  const configured = providers.filter((p) => p.apiKey && p.baseUrl);
  if (configured.length === 0) {
    issues.push({
      severity: "error",
      message:
        "No AI provider is configured. Set AI_PROVIDERS (JSON) or one of OPENROUTER_API_KEY / OPENAI_API_KEY / GROQ_API_KEY / … , then redeploy.",
    });
  }

  const settings: AISettings = {
    maxCandidates: envInt("AI_MAX_CANDIDATES", 4, 1, 8),
    maxModelsPerRequest: envInt("AI_MAX_MODELS_PER_REQUEST", 3, 1, 5),
    collaboration: (env("AI_COLLABORATION")?.toLowerCase() === "review" ? "review" : "off") as AISettings["collaboration"],
    discoveryCacheSeconds: envInt("AI_DISCOVERY_CACHE_SECONDS", 300, 30, 3600),
    discoveryTimeoutMs: envInt("AI_DISCOVERY_TIMEOUT_MS", 12_000, 2_000, 60_000),
    requestTimeoutMs: envInt("AI_REQUEST_TIMEOUT_MS", 60_000, 5_000, 300_000),
    streamTimeoutMs: envInt("AI_STREAM_TIMEOUT_MS", 120_000, 5_000, 600_000),
    maxOutputTokens: envInt("AI_MAX_OUTPUT_TOKENS", 4_096, 128, 64_000),
    maxDocumentChars: envInt("AI_MAX_DOCUMENT_CHARS", 60_000, 1_000, 400_000),
    maxFileBytes: envInt("AI_MAX_FILE_BYTES", 12 * 1024 * 1024, 64 * 1024, 50 * 1024 * 1024),
    forcedModel: env("AI_FORCED_MODEL"),
    systemSuffix: env("AI_SYSTEM_SUFFIX"),
    routerEnabled: envBool("AI_ROUTER_ENABLED", true),
    imageModel: env("AI_IMAGE_MODEL"),
  };

  return { providers: configured, issues, settings, source };
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "";
  }
}

/** Cached accessor — provider config is immutable per deployment. */
let cached: ProviderLoadResult | null = null;

export function getProviders(): ProviderLoadResult {
  if (!cached) cached = loadProviders();
  return cached;
}

export function resetProviderCache(): void {
  cached = null;
}
