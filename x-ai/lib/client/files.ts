"use client";

/**
 * Browser-side attachment intake.
 *
 * Images are validated, downscaled and re-encoded (see `lib/client/image.ts`).
 * Documents are read as data URLs and sent to the server, which extracts their
 * text — nothing is executed or rendered in the browser, and the file never
 * leaves this site except to the model you selected.
 */

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_RAW_IMAGE_BYTES,
  prepareImageFile,
  ImageRejectedError,
} from "./image";

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export const ACCEPTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "log",
  "html",
  "css",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "cs",
  "php",
  "sh",
  "sql",
  "toml",
  "ini",
] as const;

const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "application/xml",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "text/css",
  "text/javascript",
]);

export type AttachmentKind = "image" | "document";

export interface PendingAttachment {
  kind: AttachmentKind;
  dataUrl: string;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  compressed: boolean;
  originalBytes: number;
}

export function acceptAttribute(): string {
  return [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`)].join(",");
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function isDocumentFile(file: File): boolean {
  if (file.type.startsWith("image/")) return false;
  if (DOCUMENT_MIMES.has(file.type)) return true;
  return (ACCEPTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
}

export function isSupportedFile(file: File): boolean {
  return (
    (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type) ||
    file.type.startsWith("image/") ||
    isDocumentFile(file)
  );
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageRejectedError("That file could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function prepareAttachment(file: File): Promise<PendingAttachment> {
  if (file.type.startsWith("image/")) {
    const prepared = await prepareImageFile(file);
    return {
      kind: "image",
      dataUrl: prepared.dataUrl,
      name: prepared.name,
      mime: prepared.mime,
      bytes: prepared.bytes,
      width: prepared.width,
      height: prepared.height,
      compressed: prepared.compressed,
      originalBytes: prepared.originalBytes,
    };
  }

  if (!isDocumentFile(file)) {
    throw new ImageRejectedError(
      `“${file.name}” is not a supported file. Attach an image (PNG, JPEG, WebP, GIF), a PDF, a DOCX, or a text/code file.`,
    );
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new ImageRejectedError(
      `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${(
        MAX_DOCUMENT_BYTES /
        1024 /
        1024
      ).toFixed(0)} MB per document.`,
    );
  }

  const dataUrl = await readAsDataUrl(file);
  const mime = file.type || (extensionOf(file.name) === "pdf" ? "application/pdf" : "application/octet-stream");
  return {
    kind: "document",
    dataUrl,
    name: file.name || "document",
    mime,
    bytes: file.size,
    compressed: false,
    originalBytes: file.size,
  };
}

export { MAX_RAW_IMAGE_BYTES, ImageRejectedError };
