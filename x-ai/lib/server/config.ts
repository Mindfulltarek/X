import "server-only";

/**
 * Infrastructure configuration that is not about AI providers.
 *
 * AI providers and models live in `lib/server/ai/providers.ts` (env: AI_PROVIDERS
 * and the per-provider *_API_KEY variables). This module only covers the parts
 * of the deployment that are independent of which model answers: request rate
 * limits and the optional ComfyUI image backend.
 *
 * Every value is read from server-side environment variables. Nothing here is
 * imported by a client component, and no secret is ever prefixed NEXT_PUBLIC_.
 */

export interface InfraConfig {
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitChat: number;
  rateLimitImage: number;
  rateLimitRead: number;
  /** Optional self-hosted ComfyUI instance used for image generation. */
  imageBackend: "comfyui" | null;
  comfyUiBaseUrl: string | null;
  comfyUiWorkflow: Record<string, unknown> | null;
  comfyUiTimeoutMs: number;
  comfyUiConfigError: string | null;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
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

let cached: InfraConfig | null = null;

export function getInfraConfig(): InfraConfig {
  if (cached) return cached;

  const explicitBackend = env("IMAGE_BACKEND")?.toLowerCase();
  const comfyBase = env("COMFYUI_BASE_URL") ?? null;
  const comfyParse = parseComfyWorkflow();

  let imageBackend: InfraConfig["imageBackend"] = null;
  let comfyUiConfigError = comfyParse.error;
  if (explicitBackend === "comfyui" || (!explicitBackend && comfyBase)) {
    imageBackend = "comfyui";
    if (!comfyBase) comfyUiConfigError = "IMAGE_BACKEND=comfyui requires COMFYUI_BASE_URL.";
  }

  cached = {
    rateLimitEnabled: envBool("RATE_LIMIT_ENABLED", true),
    rateLimitWindowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000, 5_000, 3_600_000),
    rateLimitChat: envInt("RATE_LIMIT_CHAT_PER_WINDOW", 30, 1, 10_000),
    rateLimitImage: envInt("RATE_LIMIT_IMAGE_PER_WINDOW", 6, 1, 1_000),
    rateLimitRead: envInt("RATE_LIMIT_READ_PER_WINDOW", 120, 1, 100_000),
    imageBackend,
    comfyUiBaseUrl: comfyBase ? comfyBase.replace(/\/+$/, "") : null,
    comfyUiWorkflow: comfyParse.workflow,
    comfyUiTimeoutMs: envInt("COMFYUI_TIMEOUT_MS", 180_000, 10_000, 600_000),
    comfyUiConfigError,
  };
  return cached;
}

export function resetInfraConfigCache(): void {
  cached = null;
}
