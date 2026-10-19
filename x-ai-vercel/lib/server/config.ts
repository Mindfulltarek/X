import "server-only";

/**
 * Server-side configuration for X AI.
 *
 * Every value here is read from deployment environment variables. Nothing in
 * this module is ever imported by a client component (enforced by
 * `server-only`), and no key is prefixed with NEXT_PUBLIC_.
 *
 * See .env.example and README.md for the authoritative documentation.
 */

export interface ServerConfig {
  /** Base URL of the gateway, always normalised to end in `/v1`. */
  gatewayBaseUrl: string | null;
  gatewayApiKey: string | null;
  /** Human-readable reason the gateway is unavailable, when it is. */
  gatewayConfigError: string | null;
  gatewayRequestTimeoutMs: number;
  gatewayStreamTimeoutMs: number;
  /** Ordered server-side fallback list (must be legitimately configured model ids). */
  fallbackModels: string[];
  /** Include the bare `auto` route in fallbacks. */
  autoFallback: boolean;
  visionModel: string | null;
  /** Optional cap on the number of fallback attempts (1 = no fallback). */
  maxFallbackAttempts: number;
  imageBackend: "omniroute" | "comfyui" | null;
  imageModel: string | null;
  comfyUiBaseUrl: string | null;
  comfyUiWorkflow: Record<string, unknown> | null;
  imageConfigError: string | null;
  comfyUiTimeoutMs: number;
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitChat: number;
  rateLimitImage: number;
  rateLimitRead: number;
  maxImageBytes: number;
  gatewayBaseUrlRaw: string | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB

function env(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

/**
 * Normalises a gateway base URL.
 *
 * Accepts `http://host:20128`, `http://host:20128/v1`, or a full endpoint and
 * returns a URL that ends with `/v1` (the documented OmniRoute API mount).
 */
export function normaliseGatewayBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  let path = url.pathname.replace(/\/+$/, "");
  // Strip a trailing compat endpoint if someone pasted a full URL.
  path = path.replace(/\/chat\/completions$/i, "");
  path = path.replace(/\/models$/i, "");
  if (!path.endsWith("/v1")) {
    path = `${path}/v1`;
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseComfyWorkflow(): { workflow: Record<string, unknown> | null; error: string | null } {
  const inline = env("COMFYUI_WORKFLOW_JSON");
  if (!inline) return { workflow: null, error: null };
  try {
    const parsed = JSON.parse(inline) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { workflow: null, error: "COMFYUI_WORKFLOW_JSON must be a JSON object." };
    }
    return { workflow: parsed as Record<string, unknown>, error: null };
  } catch {
    return { workflow: null, error: "COMFYUI_WORKFLOW_JSON is not valid JSON." };
  }
}

let cached: ServerConfig | null = null;

/** Reads and validates the server configuration. Memoised for the process. */
export function getServerConfig(): ServerConfig {
  if (cached) return cached;

  const rawBase = env("OMNIROUTE_BASE_URL") ?? null;
  let baseUrl: string | null = null;
  let configError: string | null = null;

  if (!rawBase) {
    configError =
      "The gateway is not configured on this deployment. Set OMNIROUTE_BASE_URL and OMNIROUTE_API_KEY in the server environment.";
  } else {
    try {
      baseUrl = normaliseGatewayBase(rawBase);
    } catch {
      configError = "OMNIROUTE_BASE_URL is not a valid URL.";
    }
  }

  const key = env("OMNIROUTE_API_KEY") ?? null;
  if (baseUrl && !key) {
    configError =
      "OMNIROUTE_API_KEY is missing. Create an API key in the OmniRoute dashboard (Dashboard → Endpoints) and add it to the server environment.";
  }

  const fallbackModels = (env("OMNIROUTE_FALLBACK_MODELS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  const imageBackendRaw = env("IMAGE_BACKEND")?.toLowerCase();
  let imageBackend: ServerConfig["imageBackend"] = null;
  if (imageBackendRaw === "omniroute") imageBackend = "omniroute";
  else if (imageBackendRaw === "comfyui") imageBackend = "comfyui";
  else if (!imageBackendRaw) {
    // Auto-detect: a configured image model on the gateway wins, then ComfyUI.
    if (env("OMNIROUTE_IMAGE_MODEL")) imageBackend = "omniroute";
    else if (env("COMFYUI_BASE_URL")) imageBackend = "comfyui";
  }

  const comfyBase = env("COMFYUI_BASE_URL") ?? null;
  const comfyParse = parseComfyWorkflow();

  let comfyError: string | null = comfyParse.error;
  if (imageBackend === "comfyui" && !comfyBase) {
    comfyError = "IMAGE_BACKEND=comfyui requires COMFYUI_BASE_URL.";
  }
  if (imageBackend === "omniroute" && !env("OMNIROUTE_IMAGE_MODEL")) {
    comfyError =
      "IMAGE_BACKEND=omniroute requires OMNIROUTE_IMAGE_MODEL (for example a provider image model id from GET /v1/models?kind=image).";
  }

  cached = {
    gatewayBaseUrlRaw: rawBase,
    gatewayBaseUrl: baseUrl,
    gatewayApiKey: key,
    gatewayConfigError: configError,
    gatewayRequestTimeoutMs: envInt("OMNIROUTE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 5_000, 300_000),
    gatewayStreamTimeoutMs: envInt("OMNIROUTE_STREAM_TIMEOUT_MS", DEFAULT_STREAM_TIMEOUT_MS, 5_000, 600_000),
    fallbackModels,
    autoFallback: envBool("OMNIROUTE_AUTO_FALLBACK", true),
    visionModel: env("OMNIROUTE_VISION_MODEL") ?? null,
    maxFallbackAttempts: envInt("OMNIROUTE_MAX_FALLBACK_ATTEMPTS", 3, 1, 6),
    imageBackend,
    imageModel: env("OMNIROUTE_IMAGE_MODEL") ?? null,
    comfyUiBaseUrl: comfyBase ? comfyBase.replace(/\/+$/, "") : null,
    comfyUiWorkflow: comfyParse.workflow,
    imageConfigError: comfyError,
    comfyUiTimeoutMs: envInt("COMFYUI_TIMEOUT_MS", 180_000, 10_000, 600_000),
    rateLimitEnabled: envBool("RATE_LIMIT_ENABLED", true),
    rateLimitWindowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000, 5_000, 3_600_000),
    rateLimitChat: envInt("RATE_LIMIT_CHAT_PER_WINDOW", 30, 1, 10_000),
    rateLimitImage: envInt("RATE_LIMIT_IMAGE_PER_WINDOW", 6, 1, 1_000),
    rateLimitRead: envInt("RATE_LIMIT_READ_PER_WINDOW", 120, 1, 100_000),
    maxImageBytes: envInt("MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES, 64 * 1024, 50 * 1024 * 1024),
  };

  return cached;
}

/** True when the gateway is configured well enough to attempt a request. */
export function isGatewayConfigured(cfg: ServerConfig = getServerConfig()): boolean {
  return Boolean(cfg.gatewayBaseUrl && cfg.gatewayApiKey && !cfg.gatewayConfigError);
}

/** Redacted identity of the gateway, safe to log and to show as a label. */
export function gatewayLabel(cfg: ServerConfig = getServerConfig()): string {
  if (!cfg.gatewayBaseUrl) return "not configured";
  try {
    return new URL(cfg.gatewayBaseUrl).host;
  } catch {
    return "configured";
  }
}

export function resetServerConfigCache(): void {
  cached = null;
}
