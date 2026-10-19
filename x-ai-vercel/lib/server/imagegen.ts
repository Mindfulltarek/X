import "server-only";

import type { GeneratedImage } from "@/lib/types";
import { getServerConfig } from "./config";
import { classifyUpstreamStatus, gatewayFetch, safeUpstreamSnippet } from "./gateway";
import { apiError, type ErrorCode } from "./errors";
import { IMAGE_GENERATION_SUFFIX } from "./prompts";

/**
 * Optional image generation.
 *
 * Two real, documented backends are supported and neither is simulated:
 *
 *  1. OmniRoute — POST {OMNIROUTE_BASE_URL}/images/generations with a provider
 *     image model id (e.g. `openai/gpt-image-2`). OmniRoute documents this
 *     endpoint and normalises provider responses to OpenAI's `data[]` shape.
 *     Enabled by IMAGE_BACKEND=omniroute + OMNIROUTE_IMAGE_MODEL, or auto-detected
 *     when OMNIROUTE_IMAGE_MODEL is set.
 *
 *  2. ComfyUI — a local/remote ComfyUI instance, enabled by IMAGE_BACKEND=comfyui
 *     + COMFYUI_BASE_URL (+ optional COMFYUI_WORKFLOW_JSON template and
 *     COMFYUI_CHECKPOINT). The default workflow is the standard SD1.5 txt2img
 *     graph; the template placeholders let operators swap in any graph.
 *
 * If neither is configured the route returns 501 `image_backend_not_configured`
 * and the UI shows a setup state. No placeholder images are ever returned.
 */

const MAX_IMAGE_RESPONSE_BYTES = 24 * 1024 * 1024;

export interface ImageGenResult {
  backend: string;
  model?: string;
  images: GeneratedImage[];
}

export function imageBackendStatus(): {
  configured: boolean;
  backend: string | null;
  message: string;
} {
  const cfg = getServerConfig();
  if (!cfg.imageBackend) {
    return {
      configured: false,
      backend: null,
      message:
        "Image generation is off. Set IMAGE_BACKEND=omniroute with OMNIROUTE_IMAGE_MODEL, or IMAGE_BACKEND=comfyui with COMFYUI_BASE_URL.",
    };
  }
  if (cfg.imageConfigError) {
    return { configured: false, backend: cfg.imageBackend, message: cfg.imageConfigError };
  }
  return {
    configured: true,
    backend: cfg.imageBackend,
    message:
      cfg.imageBackend === "omniroute"
        ? `Using OmniRoute image model ${cfg.imageModel}. Provider quotas and pricing may apply.`
        : "Using the configured ComfyUI backend. Generation time and GPU load depend on that server.",
  };
}

/* -------------------------------------------------------------------------- */
/* OmniRoute images                                                           */
/* -------------------------------------------------------------------------- */

interface OpenAIImageItem {
  b64_json?: unknown;
  url?: unknown;
  revised_prompt?: unknown;
}

function normaliseOmniRouteImage(item: OpenAIImageItem): GeneratedImage | null {
  const revisedPrompt = typeof item.revised_prompt === "string" ? item.revised_prompt : undefined;
  if (typeof item.b64_json === "string" && item.b64_json.length > 32) {
    const mime = "image/png";
    return { url: `data:${mime};base64,${item.b64_json}`, mime, revisedPrompt };
  }
  if (typeof item.url === "string") {
    if (item.url.startsWith("data:image/")) return { url: item.url, mime: item.url.slice(5, item.url.indexOf(";")) || "image/png", revisedPrompt };
    try {
      const parsed = new URL(item.url);
      if (parsed.protocol === "https:") return { url: item.url, mime: "image/png", revisedPrompt };
    } catch {
      return null;
    }
  }
  return null;
}

async function generateWithOmniRoute(opts: {
  prompt: string;
  model?: string;
  size?: string;
  n: number;
}): Promise<ImageGenResult> {
  const cfg = getServerConfig();
  const model = opts.model ?? cfg.imageModel;
  if (!model) {
    throw apiError("image_backend_not_configured", {
      message: "OMNIROUTE_IMAGE_MODEL is not set, so there is no image model to call.",
    });
  }

  const res = await gatewayFetch(
    "/images/generations",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        size: opts.size ?? "1024x1024",
        n: Math.min(Math.max(opts.n, 1), 4),
      }),
    },
    { timeoutMs: Math.max(cfg.gatewayRequestTimeoutMs, 120_000) },
  );

  if (!res.ok) {
    const { code } = classifyUpstreamStatus(res.status);
    const detail = await safeUpstreamSnippet(res);
    const mapped: ErrorCode = code === "model_not_found" ? "image_backend_not_configured" : code;
    throw apiError(mapped, {
      details: `images ${res.status}: ${detail}`,
      message:
        code === "model_not_found"
          ? `The gateway does not serve image model "${model}". Check GET /v1/models?kind=image on your OmniRoute instance.`
          : undefined,
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw apiError("invalid_response", { details: "images: body was not JSON" });
  }
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw apiError("invalid_response", { details: "images: empty data[]" });
  }
  const images = (data as OpenAIImageItem[])
    .map(normaliseOmniRouteImage)
    .filter((img): img is GeneratedImage => Boolean(img));
  if (images.length === 0) {
    throw apiError("invalid_response", {
      message: "The gateway reported success but returned no usable image.",
    });
  }
  return { backend: "omniroute", model, images };
}

/* -------------------------------------------------------------------------- */
/* ComfyUI                                                                    */
/* -------------------------------------------------------------------------- */

function defaultComfyWorkflow() {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: "__SEED__",
        steps: 28,
        cfg: 6.5,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "__CHECKPOINT__" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: "__WIDTH__", height: "__HEIGHT__", batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: "__PROMPT__", clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: "__NEGATIVE__", clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "x-ai", images: ["8", 0] },
    },
  };
}

function fillComfyTemplate(
  template: Record<string, unknown>,
  values: Record<string, string | number>,
): Record<string, unknown> {
  let serialised = JSON.stringify(template);
  for (const [key, value] of Object.entries(values)) {
    const token = `"__${key}__"`;
    const replacement =
      typeof value === "number" ? String(value) : JSON.stringify(String(value));
    serialised = serialised.split(token).join(replacement);
  }
  return JSON.parse(serialised) as Record<string, unknown>;
}

export function parseComfySize(size?: string): { width: number; height: number } {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(size ?? "1024x1024");
  if (!match) return { width: 1024, height: 1024 };
  const width = Math.min(2048, Math.max(256, Number.parseInt(match[1], 10)));
  const height = Math.min(2048, Math.max(256, Number.parseInt(match[2], 10)));
  return { width, height };
}

async function generateWithComfyUi(opts: {
  prompt: string;
  size?: string;
}): Promise<ImageGenResult> {
  const cfg = getServerConfig();
  if (!cfg.comfyUiBaseUrl) {
    throw apiError("image_backend_not_configured", { message: "COMFYUI_BASE_URL is not set." });
  }
  const base = cfg.comfyUiBaseUrl;
  const { width, height } = parseComfySize(opts.size);
  const template = cfg.comfyUiWorkflow ?? defaultComfyWorkflow();
  const workflow = fillComfyTemplate(template, {
    PROMPT: `${opts.prompt} ${IMAGE_GENERATION_SUFFIX}`.trim(),
    NEGATIVE:
      process.env.COMFYUI_NEGATIVE_PROMPT ??
      "text, watermark, signature, extra limbs, deformed hands, low quality, jpeg artifacts, blurry",
    SEED: Math.floor(Math.random() * 1_000_000_000),
    WIDTH: width,
    HEIGHT: height,
    CHECKPOINT: process.env.COMFYUI_CHECKPOINT ?? "v1-5-pruned-emaonly.safetensors",
  });

  const clientId = crypto.randomUUID();
  let submitted: Response;
  try {
    submitted = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw apiError("upstream_unavailable", {
      message: "Could not reach the configured ComfyUI server. Check COMFYUI_BASE_URL and that it is running.",
    });
  }
  if (!submitted.ok) {
    throw apiError("upstream_unavailable", {
      details: `comfyui prompt ${submitted.status}`,
      message: `ComfyUI rejected the workflow (HTTP ${submitted.status}). Check COMFYUI_WORKFLOW_JSON and the checkpoint name.`,
    });
  }
  const submitJson = (await submitted.json()) as { prompt_id?: unknown; error?: unknown };
  const promptId = typeof submitJson.prompt_id === "string" ? submitJson.prompt_id : null;
  if (!promptId) {
    throw apiError("invalid_response", {
      message: "ComfyUI did not return a prompt_id. Check that the workflow is valid.",
    });
  }

  const deadline = Date.now() + cfg.comfyUiTimeoutMs;
  const historyUrl = `${base}/history/${encodeURIComponent(promptId)}`;
  let filename: string | null = null;
  let subfolder = "";
  let type = "output";

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_500));
    let res: Response;
    try {
      res = await fetch(historyUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const json = (await res.json()) as Record<string, unknown>;
    const entry = json[promptId] as
      | { outputs?: Record<string, { images?: { filename?: string; subfolder?: string; type?: string }[] }>; status?: { completed?: boolean; status_str?: string } }
      | undefined;
    if (!entry) continue;
    if (entry.status?.status_str === "error") {
      throw apiError("upstream_unavailable", {
        message: "ComfyUI reported an error while running the workflow. Check the ComfyUI console.",
      });
    }
    const outputs = entry.outputs;
    if (outputs) {
      for (const node of Object.values(outputs)) {
        const image = node.images?.[0];
        if (image?.filename) {
          filename = image.filename;
          subfolder = image.subfolder ?? "";
          type = image.type ?? "output";
          break;
        }
      }
    }
    if (filename) break;
  }

  if (!filename) {
    throw apiError("upstream_timeout", {
      message: `ComfyUI did not finish within ${Math.round(cfg.comfyUiTimeoutMs / 1000)}s. It may be queued or busy.`,
    });
  }

  const viewUrl = `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
    subfolder,
  )}&type=${encodeURIComponent(type)}`;
  const imageRes = await fetch(viewUrl, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!imageRes.ok) {
    throw apiError("invalid_response", { message: "ComfyUI finished but the image could not be downloaded." });
  }
  const buffer = await imageRes.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_RESPONSE_BYTES) {
    throw apiError("invalid_response", { message: "The generated image was too large to return." });
  }
  const contentType = imageRes.headers.get("content-type") ?? "image/png";
  const base64 = Buffer.from(buffer).toString("base64");
  return {
    backend: "comfyui",
    model: process.env.COMFYUI_CHECKPOINT ?? "comfyui-default-workflow",
    images: [{ url: `data:${contentType};base64,${base64}`, mime: contentType }],
  };
}

/* -------------------------------------------------------------------------- */

export async function generateImage(opts: {
  prompt: string;
  model?: string;
  size?: string;
  n: number;
}): Promise<ImageGenResult> {
  const cfg = getServerConfig();
  const status = imageBackendStatus();
  if (!status.configured) {
    throw apiError("image_backend_not_configured", { message: status.message });
  }
  if (cfg.imageBackend === "omniroute") return generateWithOmniRoute(opts);
  if (cfg.imageBackend === "comfyui") return generateWithComfyUi(opts);
  throw apiError("image_backend_not_configured");
}
