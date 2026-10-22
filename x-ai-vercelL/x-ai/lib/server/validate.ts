import "server-only";

import { z } from "zod";

import { getProviders } from "./ai/providers";
import { apiError } from "./errors";

/** Request validation + image payload checks for the API routes. */

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(24_000),
});

export const chatAttachmentSchema = z
  .object({
    name: z.string().trim().max(160).default("attachment"),
    mime: z.string().trim().max(160).default("application/octet-stream"),
    dataUrl: z.string().max(40_000_000),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    mode: z.enum(["chat", "image-to-prompt"]).default("chat"),
    model: z.string().trim().min(1).max(200).default("auto"),
    messages: z.array(chatMessageSchema).min(1).max(80),
    attachments: z.array(chatAttachmentSchema).max(6).optional(),
    /** Legacy single-image field; folded into `attachments` by the orchestrator. */
    imageDataUrl: z.string().optional(),
    chatId: z.string().max(120).optional(),
    stream: z.boolean().optional(),
  })
  .strict()
  .transform((value) => {
    if (value.imageDataUrl && !(value.attachments && value.attachments.length > 0)) {
      const mime = /^data:([\w./+-]+);/.exec(value.imageDataUrl)?.[1] ?? "image/png";
      return { ...value, attachments: [{ name: "pasted-image", mime, dataUrl: value.imageDataUrl }] };
    }
    return value;
  });

export const generateVideoRequestSchema = z
  .object({
    prompt: z.string().trim().min(3).max(2_000).optional(),
    /** Poll an existing render instead of starting a new one. */
    project: z
      .string()
      .trim()
      .min(4)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "project must be an id returned by POST /api/generate-video")
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.prompt) !== Boolean(value.project), {
    message: "Send either a prompt (to render) or a project id (to poll), not both.",
  });

export const generateImageRequestSchema = z
  .object({
    prompt: z.string().trim().min(3).max(8_000),
    model: z.string().trim().min(1).max(200).optional(),
    size: z
      .string()
      .regex(/^(512x512|768x768|1024x1024|1024x1536|1536x1024|1024x1792|1792x1024|512x768|768x512)$/)
      .optional(),
    n: z.number().int().min(1).max(4).optional(),
  })
  .strict();

const SUPPORTED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME)[number];

export interface ValidatedImage {
  dataUrl: string;
  mime: SupportedImageMime;
  bytes: number;
}

/**
 * Validates an inline `data:` image URL.
 * Rejects non-image types, malformed base64 and payloads above the limit.
 */
export function validateImageDataUrl(dataUrl: string): ValidatedImage {
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw apiError("unsupported_image_type", {
      message: "The attached image was not a valid base64 image data URL.",
    });
  }
  const mime = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME.includes(mime as SupportedImageMime)) {
    throw apiError("unsupported_image_type", {
      message: `Unsupported image type "${mime}". Use PNG, JPEG, WebP or GIF.`,
    });
  }
  const base64 = match[2].replace(/\s/g, "");
  // Approximate decoded size: 3 bytes per 4 base64 chars.
  const bytes = Math.floor((base64.length * 3) / 4);
  const max = getProviders().settings.maxFileBytes;
  if (bytes > max) {
    throw apiError("image_too_large", {
      message: `That image is about ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit for this deployment is ${(
        max /
        1024 /
        1024
      ).toFixed(0)} MB.`,
    });
  }
  if (bytes < 64) {
    throw apiError("unsupported_image_type", { message: "The attached image appears to be empty." });
  }
  return { dataUrl: `data:${mime};base64,${base64}`, mime: mime as SupportedImageMime, bytes };
}

/** Safe model-id shape for the rare case where the catalog is unavailable. */
export function isSafeModelId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:@/\-]{0,190}$/.test(id);
}

/** Parses a JSON body with a hard size limit. */
export async function readJsonBody(req: Request, limitBytes = 16 * 1024 * 1024): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw apiError("invalid_payload", { message: "Expected an application/json request body." });
  }
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader) {
    const declared = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(declared) && declared > limitBytes) {
      throw apiError("payload_too_large", {
        message: `That upload is too large. The limit is ${(limitBytes / 1024 / 1024).toFixed(0)} MB.`,
      });
    }
  }
  const text = await req.text();
  if (text.length > limitBytes) {
    throw apiError("payload_too_large", {
      message: `That upload is too large. The limit is ${(limitBytes / 1024 / 1024).toFixed(0)} MB.`,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw apiError("invalid_payload", { message: "The request body was not valid JSON." });
  }
}

/** Flattens zod issues into a short, safe message. */
export function zodMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid request.";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}
