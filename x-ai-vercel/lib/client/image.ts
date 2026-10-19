"use client";

/**
 * Client-side image intake: type/size validation, optional downscaling, and
 * conversion to a data URL that is small enough for a serverless request body.
 *
 * Why compress: Vercel caps request bodies (serverless functions) well below a
 * raw 12 MP photo. Keeping the outbound payload under ~2.8 MB means uploads
 * work in real deployments instead of failing at the platform edge. Large
 * photos are downscaled to a 2048 px longest edge, which preserves the visual
 * evidence a vision model needs.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024; // before compression
export const MAX_OUTBOUND_BYTES = 2.8 * 1024 * 1024; // sent to our API

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

export interface PreparedImage {
  dataUrl: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  name: string;
  originalBytes: number;
  compressed: boolean;
}

function isAcceptedType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

function approximateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  return Math.floor((base64.length * 3) / 4);
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageRejectedError("That file could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function decode(blob: Blob): Promise<{ width: number; height: number; bitmap?: ImageBitmap; img?: HTMLImageElement }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { width: bitmap.width, height: bitmap.height, bitmap };
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageRejectedError("That image could not be decoded."));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new ImageRejectedError("This browser could not process that image.");
  return blob;
}

/**
 * Validates a file, then (only if needed) downscales + re-encodes it so the
 * outbound data URL fits the budget. Throws ImageRejectedError with a friendly
 * message for anything unsupported.
 */
export async function prepareImageFile(file: File): Promise<PreparedImage> {
  if (!isAcceptedType(file.type)) {
    throw new ImageRejectedError(
      `${file.name || "That file"} is a ${file.type || "unknown"} file. Attach a PNG, JPEG, WebP or GIF image.`,
    );
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new ImageRejectedError(
      `${file.name || "That image"} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${(
        MAX_RAW_IMAGE_BYTES /
        1024 /
        1024
      ).toFixed(0)} MB.`,
    );
  }

  const decoded = await decode(file);
  const { width, height } = decoded;

  let bestDataUrl = await readAsDataUrl(file);
  let bytes = approximateDataUrlBytes(bestDataUrl);
  let compressed = false;
  let mime = file.type;

  const needsShrink = bytes > MAX_OUTBOUND_BYTES || Math.max(width, height) > 2048 || file.type === "image/gif";

  if (needsShrink) {
    const maxEdge = 2048;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageRejectedError("This browser could not process that image.");
    ctx.imageSmoothingQuality = "high";
    if (decoded.bitmap) {
      ctx.drawImage(decoded.bitmap, 0, 0, targetW, targetH);
      decoded.bitmap.close();
    } else if (decoded.img) {
      ctx.drawImage(decoded.img, 0, 0, targetW, targetH);
    }

    // JPEG keeps photos compact; transparency is sacrificed only when needed.
    const qualities = [0.92, 0.86, 0.8, 0.72, 0.62];
    let attempt = 0;
    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      const dataUrl = await readAsDataUrl(blob);
      const size = approximateDataUrlBytes(dataUrl);
      if (size < MAX_OUTBOUND_BYTES || attempt === qualities.length - 1) {
        bestDataUrl = dataUrl;
        bytes = size;
        mime = "image/jpeg";
        compressed = true;
        break;
      }
      attempt += 1;
    }
  }

  if (bytes > MAX_OUTBOUND_BYTES) {
    throw new ImageRejectedError("That image is still too large after resizing. Try a smaller image.");
  }

  return {
    dataUrl: bestDataUrl,
    mime,
    bytes,
    width,
    height,
    name: file.name || "image",
    originalBytes: file.size,
    compressed,
  };
}

/** Reads an image from the clipboard event, if present. */
export function imageFileFromClipboard(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length > 0) return Array.from(dt.files);
  const files: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
