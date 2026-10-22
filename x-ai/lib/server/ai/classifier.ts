import "server-only";

import type { ChatMessagePayload, OperationMode } from "@/lib/types";
import type { Capability, Classification, ExtractedFile, TaskKind } from "./types";

/**
 * Intent classification.
 *
 * The classifier is deliberately cheap and deterministic: no extra model call,
 * no latency, no cost. It reads the last user turn plus the attachments and
 * produces the hard requirements (`requires`) and soft preferences (`prefers`)
 * the router uses. Everything it decides is explainable in one sentence, which
 * is what the `signals` list is for.
 */

const CODE_FENCE = /```/;
const CODE_HINTS = [
  "```",
  "function ",
  "const ",
  "let ",
  "import ",
  "export ",
  "def ",
  "class ",
  "stack trace",
  "traceback",
  "exception",
  "typescript",
  "javascript",
  "python",
  "react",
  "next.js",
  "sql",
  "regex",
  "compile",
  "compiler",
  "refactor",
  "unit test",
  "npm ",
  "git ",
  "docker",
  "api endpoint",
  "bug",
  "null pointer",
  "segfault",
  "syntax error",
  "css",
  "tailwind",
  "typescript error",
  "linter",
];

const REASONING_HINTS = [
  "prove",
  "derive",
  "step by step",
  "step-by-step",
  "trade-off",
  "tradeoff",
  "compare",
  "analyse",
  "analyze",
  "evaluate",
  "critique",
  "architecture",
  "design a",
  "strategy",
  "root cause",
  "why ",
  "implications",
  "reasoning",
  "plan for",
  "math",
  "equation",
  "probability",
  "optimise",
  "optimize",
  "estimate",
  "in depth",
  "detailed",
  "thesis",
  "essay",
];

const SIMPLE_HINTS = [
  "hi",
  "hey",
  "hello",
  "thanks",
  "thank you",
  "what is your name",
  "who are you",
  "good morning",
  "good night",
  "ok",
  "okay",
];

const WEB_HINTS = [
  "latest",
  "today",
  "yesterday",
  "this week",
  "this month",
  "right now",
  "current price",
  "current version",
  "news",
  "who won",
  "stock price",
  "weather",
  "release date",
  "as of ",
  "up to date",
  "up-to-date",
  "search the web",
  "look up",
];

const IMAGE_GEN_HINTS = [
  "generate an image",
  "generate a picture",
  "generate an illustration",
  "create an image",
  "create a picture",
  "create an illustration",
  "make an image",
  "make a picture",
  "draw me",
  "draw a",
  "render an image",
  "image of a",
  "logo for",
  "poster of",
  "wallpaper of",
  "text-to-image",
];

const VIDEO_GEN_HINTS = [
  "generate a video",
  "generate an video",
  "create a video",
  "make a video",
  "make me a video",
  "render a video",
  "produce a video",
  "video of a",
  "video about",
  "promo video",
  "explainer video",
  "short video",
  "reel ",
  "tiktok video",
  "فيديو",
  "اعمل فيديو",
  "اصنع فيديو",
  "سجل فيديو",
];

const DOCUMENT_HINTS = ["pdf", "docx", "spreadsheet", "attached file", "this document", "the file"];

function lastUserText(messages: ChatMessagePayload[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user" && messages[i].content.trim()) return messages[i].content.trim();
  }
  return "";
}

function looksLikeCode(text: string): boolean {
  if (CODE_FENCE.test(text)) return true;
  const symbols = (text.match(/[{}();=<>[\]]/g) ?? []).length;
  if (text.length > 40 && symbols / text.length > 0.06) return true;
  return false;
}

export interface ClassifyInput {
  messages: ChatMessagePayload[];
  mode: OperationMode;
  files: ExtractedFile[];
  /** True when the deployment can actually offer web grounding. */
  webAvailable: boolean;
}

export function classify(input: ClassifyInput): Classification {
  const { messages, mode, files, webAvailable } = input;
  const text = lastUserText(messages);
  const lower = text.toLowerCase();
  const signals: string[] = [];

  const images = files.filter((f) => f.kind === "image");
  const documents = files.filter((f) => f.kind === "document" || f.kind === "text");

  const requires = new Set<Capability>();
  const prefers: Capability[] = [];

  if (images.length > 0) {
    requires.add("vision");
    signals.push(`${images.length} image attachment${images.length === 1 ? "" : "s"}`);
  }
  if (documents.length > 0) {
    signals.push(`${documents.length} document attachment${documents.length === 1 ? "" : "s"}`);
  }

  const isImagePromptMode = mode === "image-to-prompt";
  if (isImagePromptMode) {
    requires.add("vision");
    prefers.push("vision", "reasoning");
    signals.push("image-to-prompt mode");
  }

  /* ---------------- image generation intent ---------------- */
  let imageGenerationIntent = false;
  if (!isImagePromptMode && IMAGE_GEN_HINTS.some((hint) => lower.includes(hint))) {
    imageGenerationIntent = true;
  }
  // "generate an image prompt" is analysis, not generation.
  if (imageGenerationIntent && /image\s*prompt|prompt\s*for/i.test(lower)) imageGenerationIntent = false;

  /* ---------------- video generation intent ---------------- */
  let videoGenerationIntent = false;
  if (!isImagePromptMode && VIDEO_GEN_HINTS.some((hint) => lower.includes(hint))) {
    videoGenerationIntent = true;
  }
  // "how do I make a video", "video ideas", "why is my video…" are questions, not renders.
  if (videoGenerationIntent && /how (do|to|can)|ideas?\b|why |what is|explain/.test(lower)) {
    videoGenerationIntent = false;
  }
  if (videoGenerationIntent) {
    // A request for a video is not also a request for a still image.
    imageGenerationIntent = false;
  }

  /* ---------------- web ---------------- */
  const needsWeb = webAvailable && WEB_HINTS.some((hint) => lower.includes(hint));
  if (needsWeb) signals.push("asked for time-sensitive information");

  /* ---------------- coding ---------------- */
  const code = looksLikeCode(text) || CODE_HINTS.some((hint) => lower.includes(hint));
  if (code) signals.push("code-related wording");

  /* ---------------- reasoning ---------------- */
  const reasoning =
    REASONING_HINTS.some((hint) => lower.includes(hint)) || (text.length > 900 && !code);
  if (reasoning) signals.push(text.length > 900 ? "long, detailed request" : "analysis wording");

  /* ---------------- simple ---------------- */
  const simple =
    !code &&
    !reasoning &&
    text.length > 0 &&
    text.length <= 140 &&
    (SIMPLE_HINTS.some((hint) => lower === hint || lower.startsWith(`${hint} `)) || text.split(/\s+/).length <= 12);
  if (simple) signals.push("short, low-complexity message");

  /* ---------------- decide the task kind ---------------- */
  let kind: TaskKind;
  if (videoGenerationIntent) {
    kind = "video-gen";
    signals.push("asked for a video to be rendered");
  } else if (imageGenerationIntent) {
    kind = "image-gen";
    prefers.push("image-gen");
    signals.push("asked for a generated image");
  } else if (images.length > 0 || isImagePromptMode) {
    kind = "vision";
    prefers.push("reasoning", "fast");
  } else if (documents.length > 0 || DOCUMENT_HINTS.some((hint) => lower.includes(hint))) {
    kind = documents.length > 0 ? "document" : "general";
    if (documents.length > 0) prefers.push("long-context", "reasoning");
  } else if (code) {
    kind = "coding";
    prefers.push("coding", "reasoning");
  } else if (reasoning) {
    kind = "reasoning";
    prefers.push("reasoning", "long-context");
  } else if (needsWeb) {
    kind = "web";
    prefers.push("web", "fast", "reasoning");
  } else if (simple) {
    kind = "simple";
    prefers.push("fast");
  } else {
    kind = "general";
    prefers.push("reasoning", "fast");
  }

  if (needsWeb && kind !== "image-gen") prefers.unshift("web");

  return {
    kind,
    requires,
    prefers: [...new Set(prefers)],
    signals,
    imageGenerationIntent,
    videoGenerationIntent,
    needsWeb,
  };
}

/** One-sentence, human-readable explanation of a classification. */
export function describeClassification(classification: Classification): string {
  const kindLabels: Record<TaskKind, string> = {
    "video-gen": "a video request",
    simple: "a short question",
    general: "a general question",
    reasoning: "an analysis task",
    coding: "a coding task",
    vision: "an image task",
    document: "a document task",
    web: "a time-sensitive question",
    "image-gen": "an image-generation request",
  };
  const parts = [kindLabels[classification.kind]];
  if (classification.requires.size > 0) {
    parts.push(`needs ${[...classification.requires].join(" + ")}`);
  }
  if (classification.prefers.length > 0) {
    parts.push(`prefers ${classification.prefers.join(", ")}`);
  }
  return parts.join(" · ");
}
