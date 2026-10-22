import "server-only";

/** Parsing helpers for OpenAI-compatible chat and image responses. */

function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as { text?: unknown; type?: unknown };
        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  }
  return "";
}

/** Text delta from one SSE `data:` JSON chunk. */
export function extractStreamDelta(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  const choices = (parsed as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const choice = choices[0] as {
    delta?: { content?: unknown };
    message?: { content?: unknown };
    text?: unknown;
  };
  const value = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
  return contentToText(value);
}

/** Full text from a non-streaming chat completion body. */
export function extractFullContent(json: unknown): string {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const choice = choices[0] as { message?: { content?: unknown }; text?: unknown };
  const text = contentToText(choice?.message?.content);
  if (text) return text;
  return typeof choice?.text === "string" ? choice.text : "";
}

/** Whether the provider refused the completion (content policy, etc.). */
export function extractFinishReason(json: unknown): string | undefined {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const reason = (choices[0] as { finish_reason?: unknown })?.finish_reason;
  return typeof reason === "string" ? reason : undefined;
}

export interface ParsedImage {
  url: string;
  mime?: string;
  revisedPrompt?: string;
}

function pushIfValid(out: ParsedImage[], url: unknown, revisedPrompt?: unknown) {
  if (typeof url !== "string" || url.length < 16) return;
  const prompt = typeof revisedPrompt === "string" ? revisedPrompt : undefined;
  if (url.startsWith("data:image/")) {
    const mime = url.slice(5, url.indexOf(";")) || "image/png";
    out.push({ url, mime, revisedPrompt: prompt });
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") out.push({ url, mime: "image/png", revisedPrompt: prompt });
  } catch {
    /* not a usable URL */
  }
}

/**
 * Extracts images from either the OpenAI `/images/generations` shape
 * (`data[]`) or a chat completion that returned `message.images[]`.
 */
export function extractImages(json: unknown): ParsedImage[] {
  const out: ParsedImage[] = [];

  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const record = item as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown };
      if (typeof record.b64_json === "string" && record.b64_json.length > 64) {
        out.push({
          url: `data:image/png;base64,${record.b64_json}`,
          mime: "image/png",
          revisedPrompt: typeof record.revised_prompt === "string" ? record.revised_prompt : undefined,
        });
      } else {
        pushIfValid(out, record.url, record.revised_prompt);
      }
    }
  }

  const choices = (json as { choices?: unknown })?.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const message = (choice as { message?: { images?: unknown; content?: unknown } })?.message;
      const images = message?.images;
      if (Array.isArray(images)) {
        for (const image of images) {
          if (!image || typeof image !== "object") continue;
          const record = image as { image_url?: { url?: unknown } | string; url?: unknown };
          const url =
            typeof record.image_url === "string"
              ? record.image_url
              : record.image_url && typeof record.image_url === "object"
                ? record.image_url.url
                : record.url;
          pushIfValid(out, url);
        }
      }
      if (Array.isArray(message?.content)) {
        for (const part of message!.content as unknown[]) {
          if (!part || typeof part !== "object") continue;
          const record = part as { type?: unknown; image_url?: { url?: unknown } | string };
          if (record.type !== "image_url" && record.type !== "output_image") continue;
          const url =
            typeof record.image_url === "string"
              ? record.image_url
              : record.image_url && typeof record.image_url === "object"
                ? record.image_url.url
                : undefined;
          pushIfValid(out, url);
        }
      }
    }
  }

  return out;
}

/** Reads a JSON object out of a model reply that may be wrapped in prose or fences. */
export function parseJsonLoose<T = Record<string, unknown>>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fenced?.[1], trimmed];
  const objectLike = /\{[\s\S]*\}/.exec(trimmed)?.[0];
  if (objectLike) candidates.push(objectLike);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as T;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
