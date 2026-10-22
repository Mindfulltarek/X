import "server-only";

import type { GeneratedImage } from "@/lib/types";
import { generateImageViaMedia, mediaOrder } from "./ai/media";
import { getInfraConfig } from "./config";
import { apiError } from "./errors";
import { generateImageWithProvider, providerImageStatus } from "./ai/images";
import type { RegistrySnapshot } from "./ai/registry";
import type { AISettings } from "./ai/types";
import { IMAGE_GENERATION_SUFFIX } from "./prompts";

/**
 * Image generation backend selection.
 *
 * Backends, in order of preference:
 *
 *  1. A provider image model, discovered from the configured providers'
 *     catalogues (e.g. an image-output model on OpenRouter/OpenAI). No extra
 *     configuration is needed beyond the provider key.
 *  2. A self-hosted ComfyUI instance, enabled explicitly with
 *     IMAGE_BACKEND=comfyui + COMFYUI_BASE_URL (optional COMFYUI_WORKFLOW_JSON
 *     and COMFYUI_CHECKPOINT).
 *
 * If neither exists the route answers 501 `image_backend_not_configured` and the
 * UI shows a setup state. Placeholder images are never returned.
 */

const MAX_IMAGE_RESPONSE_BYTES = 24 * 1024 * 1024;

export interface ImageGenResult {
  warnings?: { backend: string; label: string; code?: string; reason?: string }[];
  backend: string;
  model?: string;
  images: GeneratedImage[];
}

export interface ImageBackendReport {
  configured: boolean;
  backend: string | null;
  model?: string;
  models: string[];
  message: string;
  providersConfigured: boolean;
}

export function imageBackendStatus(
  snapshot: RegistrySnapshot | null,
  requested?: string,
): ImageBackendReport {
  const infra = getInfraConfig();
  const providersConfigured = Boolean(snapshot?.ready);

  // Explicit media backends (Gemini / xAI / Kie / Wiro) win over a discovered
  // provider image model: the operator configured them on purpose.
  const media = mediaOrder("image");
  const mediaFirst = media[0];

  if (infra.imageBackend !== "comfyui" && mediaFirst) {
    return {
      configured: true,
      backend: mediaFirst.id,
      model: mediaFirst.imageModel,
      models: media.map((entry) => `${entry.id}:${entry.imageModel ?? "?"}`),
      message: `${mediaFirst.label}: ${mediaFirst.message}${media.length > 1 ? ` Fallbacks: ${media.slice(1).map((m) => m.label).join(", ")}.` : ""}`,
      providersConfigured,
    };
  }

  if (infra.imageBackend === "comfyui" && infra.comfyUiBaseUrl && !infra.comfyUiConfigError) {
    return {
      configured: true,
      backend: "comfyui",
      model: process.env.COMFYUI_CHECKPOINT ?? "comfyui-default-workflow",
      models: [],
      message: "Using the configured ComfyUI backend. Generation time depends on that server's GPU.",
      providersConfigured,
    };
  }

  if (snapshot) {
    const status = providerImageStatus(snapshot, requested);
    if (status.configured) {
      return {
        configured: true,
        backend: status.backend,
        model: status.model,
        models: status.models,
        message: status.message,
        providersConfigured,
      };
    }
    return {
      configured: false,
      backend: null,
      models: status.models,
      message: infra.comfyUiConfigError
        ? `${status.message} ${infra.comfyUiConfigError}`
        : status.message,
      providersConfigured,
    };
  }

  return {
    configured: false,
    backend: null,
    models: [],
    message: infra.comfyUiConfigError ?? "No image backend is configured.",
    providersConfigured,
  };
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
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "__CHECKPOINT__" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: "__WIDTH__", height: "__HEIGHT__", batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "__PROMPT__", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "__NEGATIVE__", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "x-ai", images: ["8", 0] } },
  };
}

function fillComfyTemplate(
  template: Record<string, unknown>,
  values: Record<string, string | number>,
): Record<string, unknown> {
  let serialised = JSON.stringify(template);
  for (const [key, value] of Object.entries(values)) {
    const token = `"__${key}__"`;
    const replacement = typeof value === "number" ? String(value) : JSON.stringify(String(value));
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

async function generateWithComfyUi(opts: { prompt: string; size?: string }): Promise<ImageGenResult> {
  const infra = getInfraConfig();
  if (!infra.comfyUiBaseUrl) {
    throw apiError("image_backend_not_configured", { message: "COMFYUI_BASE_URL is not set." });
  }
  const base = infra.comfyUiBaseUrl;
  const { width, height } = parseComfySize(opts.size);
  const template = infra.comfyUiWorkflow ?? defaultComfyWorkflow();
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
  const submitJson = (await submitted.json()) as { prompt_id?: unknown };
  const promptId = typeof submitJson.prompt_id === "string" ? submitJson.prompt_id : null;
  if (!promptId) {
    throw apiError("invalid_response", { message: "ComfyUI did not return a prompt_id. Check that the workflow is valid." });
  }

  const deadline = Date.now() + infra.comfyUiTimeoutMs;
  const historyUrl = `${base}/history/${encodeURIComponent(promptId)}`;
  let filename: string | null = null;
  let subfolder = "";
  let type = "output";

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    let res: Response;
    try {
      res = await fetch(historyUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const json = (await res.json()) as Record<string, unknown>;
    const entry = json[promptId] as
      | {
          outputs?: Record<string, { images?: { filename?: string; subfolder?: string; type?: string }[] }>;
          status?: { status_str?: string };
        }
      | undefined;
    if (!entry) continue;
    if (entry.status?.status_str === "error") {
      throw apiError("upstream_unavailable", {
        message: "ComfyUI reported an error while running the workflow. Check the ComfyUI console.",
      });
    }
    for (const node of Object.values(entry.outputs ?? {})) {
      const image = node.images?.[0];
      if (image?.filename) {
        filename = image.filename;
        subfolder = image.subfolder ?? "";
        type = image.type ?? "output";
        break;
      }
    }
    if (filename) break;
  }

  if (!filename) {
    throw apiError("upstream_timeout", {
      message: `ComfyUI did not finish within ${Math.round(infra.comfyUiTimeoutMs / 1000)}s. It may be queued or busy.`,
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
  return {
    backend: "comfyui",
    model: process.env.COMFYUI_CHECKPOINT ?? "comfyui-default-workflow",
    images: [{ url: `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`, mime: contentType }],
  };
}

/* -------------------------------------------------------------------------- */

export async function generateImage(opts: {
  snapshot: RegistrySnapshot;
  settings: AISettings;
  prompt: string;
  model?: string;
  size?: string;
  n: number;
  signal: AbortSignal;
}): Promise<ImageGenResult> {
  const infra = getInfraConfig();
  const status = imageBackendStatus(opts.snapshot, opts.model);
  if (!status.configured) {
    throw apiError("image_backend_not_configured", { message: status.message });
  }

  // Explicit media backends first (no `model` pin was requested).
  if (infra.imageBackend !== "comfyui" && !opts.model && mediaOrder("image").length > 0) {
    const media = await generateImageViaMedia({ prompt: opts.prompt, size: opts.size, signal: opts.signal });
    if (media) {
      return {
        backend: media.providerLabel,
        model: media.model,
        warnings: (media.attempts ?? [])
          .filter((attempt) => !attempt.ok)
          .map((attempt) => ({
            backend: attempt.id,
            label: attempt.label,
            code: attempt.code,
            reason: attempt.reason,
          })),
        images: media.urls.map((url) => ({ url, mime: url.startsWith("data:") ? url.slice(5, url.indexOf(";")) : undefined })),
      };
    }
  }

  if (infra.imageBackend === "comfyui" && infra.comfyUiBaseUrl) {
    return generateWithComfyUi({ prompt: opts.prompt, size: opts.size });
  }
  const result = await generateImageWithProvider(opts);
  return { backend: result.backend, model: result.model, images: result.images };
}
