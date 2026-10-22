import "server-only";

import { inflateRawSync, inflateSync } from "node:zlib";

import { apiError } from "../errors";
import type { ExtractedFile, FileInput } from "./types";

/**
 * Attachment intake.
 *
 * The browser sends every attachment as a `data:` URL. This module turns it
 * into something a chat model can actually consume:
 *
 *   image  → kept as a data URL and sent as an OpenAI-style `image_url` part.
 *   text   → decoded as UTF-8.
 *   pdf    → best-effort text extraction (PDF has no plain-text layer in
 *            general; scanned PDFs yield nothing and we say so).
 *   docx   → the XML body of the OOXML package is inflated and stripped.
 *
 * Nothing is uploaded anywhere; extraction happens in the API route.
 */

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/sql",
]);
const TEXT_EXTENSIONS = new Set([
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
  "htm",
  "css",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
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
  "bash",
  "sql",
  "toml",
  "ini",
  "env",
]);

const MAX_ATTACHMENTS = 6;

interface ParsedDataUrl {
  mime: string;
  base64: string;
  bytes: number;
  buffer: Buffer;
}

function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const match = /^data:([\w.+-]+\/[\w.+-]+)?(?:;[\w=.-]+)*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) {
    throw apiError("unsupported_file_type", {
      message: "One of the attached files was not a readable base64 data URL.",
    });
  }
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  const mime = (match[1] ?? "application/octet-stream").toLowerCase();
  return { mime, base64, bytes: buffer.byteLength, buffer };
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

/** Decodes a PDF literal string (`(...)`) including escapes and octal codes. */
function decodePdfLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (/[0-7]/.test(next)) {
      const octal = /^[0-7]{1,3}/.exec(raw.slice(i + 1))?.[0] ?? next;
      out += String.fromCharCode(Number.parseInt(octal, 8));
      i += octal.length - 1;
    } else if (next === "\n") {
      /* line continuation */
    } else out += next;
    i += 1;
  }
  return out;
}

/** Pulls visible text out of a PDF content stream. */
function textFromContentStream(stream: string): string {
  const parts: string[] = [];
  const token = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bT[Jj*]|\bTD\b|\bTd\b|\bET\b/g;
  let match: RegExpExecArray | null;
  let buffer = "";
  while ((match = token.exec(stream)) !== null) {
    const value = match[0];
    if (value.startsWith("(")) {
      buffer += decodePdfLiteral(value.slice(1, -1));
    } else if (value.startsWith("<")) {
      // Hex strings: 2 hex digits per byte, interpreted as UTF-16-ish when possible.
      const hex = value.slice(1, -1).replace(/\s+/g, "");
      let decoded = "";
      for (let i = 0; i + 3 < hex.length; i += 4) {
        const code = Number.parseInt(hex.slice(i, i + 4), 16);
        if (Number.isFinite(code) && code > 0) decoded += String.fromCharCode(code);
      }
      buffer += decoded;
    } else if (/^(TJ|Tj)$/.test(value)) {
      parts.push(buffer);
      buffer = "";
    } else {
      if (buffer) parts.push(buffer);
      buffer = "";
      parts.push("\n");
    }
  }
  if (buffer) parts.push(buffer);
  return parts
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPdfText(buffer: Buffer): { text: string; warning?: string } {
  const latin = buffer.toString("latin1");
  const chunks: string[] = [];

  let cursor = 0;
  while (cursor < latin.length) {
    const start = latin.indexOf("stream", cursor);
    if (start < 0) break;
    const headerEnd = latin.indexOf("\n", start);
    if (headerEnd < 0) break;
    const end = latin.indexOf("endstream", headerEnd);
    if (end < 0) break;
    let dataStart = headerEnd + 1;
    // Skip the extra CR of CRLF and one optional leading space/newline.
    if (latin[dataStart] === "\r") dataStart += 1;
    if (latin[dataStart] === "\n") dataStart += 1;

    const slice = buffer.subarray(dataStart, end);
    let text = "";
    try {
      text = inflateSync(slice).toString("latin1");
    } catch {
      try {
        text = inflateRawSync(slice).toString("latin1");
      } catch {
        text = slice.toString("latin1");
      }
    }
    if (/\bT[Jj]\b/.test(text)) {
      const extracted = textFromContentStream(text);
      if (extracted) chunks.push(extracted);
    }
    cursor = end + "endstream".length;
  }

  const text = chunks.join("\n").replace(/\u0000/g, "").trim();
  if (text.length < 24) {
    return {
      text: "",
      warning:
        "No text layer was found in that PDF, which usually means it contains scanned pages. Paste the text, or attach a screenshot of the pages.",
    };
  }
  return { text };
}

/* -------------------------------------------------------------------------- */
/* DOCX                                                                        */
/* -------------------------------------------------------------------------- */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  // End of central directory record.
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const local = entry.localOffset;
  if (local + 30 > buffer.length) return null;
  if (buffer.readUInt32LE(local) !== 0x04034b50) return null;
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  try {
    return entry.method === 0 ? data : inflateRawSync(data);
  } catch {
    try {
      return inflateRawSync(data);
    } catch {
      return null;
    }
  }
}

function stripXml(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDocxText(buffer: Buffer): { text: string; warning?: string } {
  const entries = readZipEntries(buffer);
  const document = entries.find((e) => e.name === "word/document.xml");
  if (!document) {
    return { text: "", warning: "That .docx file could not be opened as a Word document." };
  }
  const xml = readZipEntry(buffer, document);
  if (!xml) return { text: "", warning: "That .docx file could not be decompressed." };
  const text = stripXml(xml.toString("utf8"));
  if (!text) return { text: "", warning: "That .docx file contains no extractable text." };
  return { text };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface ExtractResult {
  files: ExtractedFile[];
  /** Non-fatal notes surfaced in the meta event / UI. */
  warnings: string[];
}

export function extractFiles(inputs: FileInput[], opts: { maxFileBytes: number; maxDocumentChars: number }): ExtractResult {
  const files: ExtractedFile[] = [];
  const warnings: string[] = [];

  for (const input of inputs.slice(0, MAX_ATTACHMENTS)) {
    const name = (input.name || "attachment").slice(0, 160);
    const extension = extensionOf(name);
    let parsed: ParsedDataUrl;
    try {
      parsed = parseDataUrl(input.dataUrl);
    } catch (err) {
      warnings.push(`${name}: ${(err as Error).message}`);
      continue;
    }
    if (parsed.bytes > opts.maxFileBytes) {
      throw apiError("image_too_large", {
        message: `"${name}" is ${(parsed.bytes / 1024 / 1024).toFixed(1)} MB. The limit for this deployment is ${(
          opts.maxFileBytes /
          1024 /
          1024
        ).toFixed(0)} MB.`,
      });
    }
    const mime = input.mime || parsed.mime;

    if (mime.startsWith("image/") || IMAGE_MIMES.has(mime)) {
      if (!IMAGE_MIMES.has(mime)) {
        warnings.push(`${name}: ${mime} images can't be read by the models — use PNG, JPEG, WebP or GIF.`);
        continue;
      }
      files.push({
        name,
        mime,
        kind: "image",
        imageDataUrl: `data:${mime};base64,${parsed.base64}`,
        bytes: parsed.bytes,
      });
      continue;
    }

    if (mime === "application/pdf" || extension === "pdf") {
      const { text, warning } = extractPdfText(parsed.buffer);
      if (warning) warnings.push(`${name}: ${warning}`);
      if (!text) continue;
      const truncated = text.length > opts.maxDocumentChars;
      files.push({
        name,
        mime: "application/pdf",
        kind: "document",
        text: truncated ? text.slice(0, opts.maxDocumentChars) : text,
        bytes: parsed.bytes,
        truncated,
        warning: truncated ? "Only the first part of this PDF was sent." : undefined,
      });
      continue;
    }

    if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      extension === "docx"
    ) {
      const { text, warning } = extractDocxText(parsed.buffer);
      if (warning) warnings.push(`${name}: ${warning}`);
      if (!text) continue;
      const truncated = text.length > opts.maxDocumentChars;
      files.push({
        name,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        kind: "document",
        text: truncated ? text.slice(0, opts.maxDocumentChars) : text,
        bytes: parsed.bytes,
        truncated,
        warning: truncated ? "Only the first part of this document was sent." : undefined,
      });
      continue;
    }

    if (mime.startsWith("text/") || TEXT_MIMES.has(mime) || TEXT_EXTENSIONS.has(extension)) {
      const text = parsed.buffer.toString("utf8").replace(/\u0000/g, "");
      const truncated = text.length > opts.maxDocumentChars;
      files.push({
        name,
        mime: mime.startsWith("text/") ? mime : "text/plain",
        kind: "text",
        text: truncated ? text.slice(0, opts.maxDocumentChars) : text,
        bytes: parsed.bytes,
        truncated,
        warning: truncated ? "Only the first part of this file was sent." : undefined,
      });
      continue;
    }

    warnings.push(`${name}: ${mime || "unknown type"} files aren't supported. Attach an image, PDF, DOCX or plain text file.`);
  }

  return { files, warnings };
}
