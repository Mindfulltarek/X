/**
 * Shared types used by both the client and the server route handlers.
 * No secrets or server-only values belong in this file.
 */

export type ChatRole = "user" | "assistant";

export type OperationMode = "chat" | "image-to-prompt";

export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** True for images produced by the image-generation backend. */
  generated?: boolean;
  /** True for documents/text files (their text is sent to the model). */
  document?: boolean;
}

export interface CollabInfo {
  verdict: "agree" | "partial" | "conflict" | "unknown";
  peerModel?: string;
  peerProvider?: string;
  summary?: string;
  addendum?: string;
  disputes?: { topic: string; primary: string; peer: string; resolution: string }[];
}

/** A rendered video returned by the video backend. */
export interface VideoAsset {
  url: string;
  /** Length of the render in seconds, as reported by the backend. */
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** Backend project id, so a pending render can be polled later. */
  project?: string;
  /** True while the render is still running on the backend. */
  pending?: boolean;
  /** How the storyboard was produced: by a chat model or straight from the prompt. */
  storyboardSource?: "model" | "prompt";
  author?: string;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  /** Markdown text from the model or plain text from the user. */
  content: string;
  createdAt: number;
  /** Model that produced an assistant message. */
  model?: string;
  /** Provider label that served it (no URL, no key). */
  provider?: string;
  /** What the user asked for: `auto` or a `provider::model` key. */
  requestedModel?: string;
  /** Videos rendered for this message. */
  videos?: VideoAsset[];
  /** Second-opinion report, when collaboration ran. */
  collab?: CollabInfo | null;
  /** True when a fallback model produced this answer. */
  fallbackUsed?: boolean;
  /** True when the attached image(s) were actually sent to a vision model. */
  visionUsed?: boolean;
  documentsUsed?: number;
  attachments?: AttachmentMeta[];
  /** Present on assistant messages that failed. */
  error?: { code: string; message: string } | null;
  /** True while the assistant message is still being streamed/persisted. */
  pending?: boolean;
}

export interface StoredChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  mode: OperationMode;
  messageCount: number;
  /** Denormalised snippet of the last message for the recent-chats list. */
  preview: string;
  /** Pinned chats are listed first and survive archiving. */
  pinned?: boolean;
  /** Archived chats are hidden from the main list. */
  archived?: boolean;
}

/** A model as exposed to the browser: no keys, no upstream URLs. */
export interface PublicModel {
  /** Client-facing id: `provider::model`. */
  id: string;
  /** The upstream model id (shown as a subtitle). */
  modelId?: string;
  label: string;
  provider?: string;
  providerLabel?: string;
  capabilities?: string[];
  /** chat | image | … (kept for backwards compatibility with the picker). */
  kind: string;
  vision: boolean;
  contextLength?: number;
  costIn?: number;
  costOut?: number;
}

export type GatewayStatus = "connected" | "degraded" | "not_configured" | "unavailable";

export interface PublicProviderStatus {
  id: string;
  label: string;
  status: "ok" | "unauthorized" | "forbidden" | "unavailable" | "not_configured";
  message?: string;
  /** Hostname only — never the full URL with credentials. */
  host: string;
  modelCount: number;
  latencyMs?: number;
  catalogFromProvider: boolean;
  imageGeneration: boolean;
}

export interface HealthResponse {
  status: GatewayStatus;
  message?: string;
  latencyMs?: number;
  modelCount?: number;
  visionModelCount?: number;
  imageModelCount?: number;
  providerCount?: number;
  providers?: PublicProviderStatus[];
  collaboration?: boolean;
  routerEnabled?: boolean;
  checkedAt: number;
}

export interface ModelsResponse {
  status: GatewayStatus;
  message?: string;
  models: PublicModel[];
  providers: PublicProviderStatus[];
  /** Model counts per capability, for the settings panel. */
  capabilities: Record<string, number>;
  visionModels: string[];
  imageModels: string[];
  autoAvailable: boolean;
  autoVisionAvailable: boolean;
  collaborationEnabled: boolean;
  /** Non-fatal configuration problems, safe to display. */
  issues: string[];
  fetchedAt: number;
}

export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

export interface ChatAttachmentInput {
  name: string;
  mime: string;
  /** data: URL. */
  dataUrl: string;
}

export interface ChatRequestBody {
  mode: OperationMode;
  model: string;
  messages: ChatMessagePayload[];
  /** Up to a handful of images / documents for the current turn. */
  attachments?: ChatAttachmentInput[];
  /** Legacy single-image field, still accepted. */
  imageDataUrl?: string;
  chatId?: string;
  /** Defaults to true; false returns a single JSON answer instead of SSE. */
  stream?: boolean;
}

export interface StreamRouteInfo {
  kind: string;
  reason: string;
  candidates: number;
  images: number;
  documents: number;
}

export interface StreamingCollab {
  enabled: boolean;
  peerModel?: string;
  reason?: string;
}

export type ChatStreamEvent =
  | {
      type: "meta";
      requestedModel: string;
      model: string;
      provider?: string;
      providerLabel?: string;
      modelKey?: string;
      fallbackAttempts: number;
      requestId?: string;
      /** Present when the server changed the model for a capability reason. */
      notice?: string;
      route?: StreamRouteInfo;
      collaboration?: StreamingCollab;
    }
  | { type: "delta"; text: string }
  | {
      type: "collab";
      stage: "start" | "done" | "skipped" | "partial";
      peerModel?: string;
      peerProvider?: string;
      synthesisModel?: string;
      verdict?: "agree" | "partial" | "conflict" | "unknown";
      summary?: string;
      addendum?: string;
      disputes?: { topic: string; primary: string; peer: string; resolution: string }[];
      reason?: string;
    }
  | {
      type: "image";
      images: { url: string; mime?: string; revisedPrompt?: string }[];
      model?: string;
      backend?: string;
    }
  | {
      type: "video";
      status: "done" | "pending";
      videos: VideoAsset[];
      project?: string;
      backend?: string;
      resolution?: string;
      storyboard?: { title?: string; scenes: { text: string; duration: number }[]; source: "model" | "prompt"; author?: string };
    }
  | {
      type: "done";
      model: string;
      provider?: string;
      fallbackAttempts: number;
      attempts?: { model: string; code?: string }[];
    }
  | { type: "error"; code: string; message: string; retryable: boolean; details?: string };

export interface GenerateImageRequestBody {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
}

export interface GenerateVideoRequestBody {
  prompt: string;
  /** Progressively poll an existing render instead of starting a new one. */
  project?: string;
}

/** One image/video service, as reported to the browser (never a key). */
export interface MediaBackendInfo {
  id: string;
  label: string;
  kinds: string[];
  configured: boolean;
  apiKeyEnv?: string;
  imageModel?: string;
  videoModel?: string;
  message: string;
}

export interface VideoBackendPayload {
  configured: boolean;
  backend: string | null;
  providerLabel?: string;
  apiKeyEnv?: string;
  resolution: string;
  maxSeconds: number;
  message: string;
  /** Every video-capable service and whether it is configured. */
  providers?: MediaBackendInfo[];
}

export interface GenerateVideoResponse {
  ok: boolean;
  status: "done" | "pending";
  provider?: string;
  providerLabel?: string;
  warnings?: MediaWarning[];
  url?: string;
  durationSeconds?: number;
  size?: { width: number; height: number };
  project: string;
  resolution: string;
  waitedMs: number;
  backend: string | null;
  storyboard?: { title?: string; scenes: { text: string; duration: number }[]; source: "model" | "prompt"; author?: string };
  error?: { code: string; message: string } | null;
}

export interface GeneratedImage {
  /** Data URL (preferred) or an HTTPS URL returned by the backend. */
  url: string;
  mime?: string;
  revisedPrompt?: string;
}

/** One backend that was tried and did not answer, with a sanitised reason. */
export interface MediaWarning {
  backend: string;
  label: string;
  code?: string;
  reason?: string;
}

export interface GenerateImageResponse {
  ok: true;
  backend: string;
  model?: string;
  images: GeneratedImage[];
  tookMs: number;
  /** Earlier backends that failed before this one succeeded. */
  warnings?: MediaWarning[];
}

export interface ApiErrorBody {
  ok: false;
  code: string;
  message: string;
  retryable?: boolean;
  details?: string;
}
