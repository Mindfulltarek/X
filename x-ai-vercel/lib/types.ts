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
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  /** Markdown text from the model or plain text from the user. */
  content: string;
  createdAt: number;
  /** Model that produced an assistant message (as reported by the gateway). */
  model?: string;
  provider?: string;
  /** How the model was selected: explicitly chosen id, or an auto route. */
  requestedModel?: string;
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

export interface PublicModel {
  id: string;
  label: string;
  provider?: string;
  /** chat | image | embedding | video | audio | music | rerank | … */
  kind: string;
  vision: boolean;
  contextLength?: number;
}

export type GatewayStatus = "connected" | "not_configured" | "unavailable";

export interface HealthResponse {
  status: GatewayStatus;
  /** Present when status !== "connected". */
  message?: string;
  latencyMs?: number;
  /** Number of models visible to the configured key, when reachable. */
  modelCount?: number;
  gatewayVersion?: string;
  checkedAt: number;
}

export interface ModelsResponse {
  status: GatewayStatus;
  message?: string;
  models: PublicModel[];
  visionModels: string[];
  imageModels: string[];
  /** Whether the gateway can route a bare `auto` model. */
  autoAvailable: boolean;
  /** Documented OmniRoute vision route (auto/vision), when auto is available. */
  autoVisionAvailable: boolean;
  fetchedAt: number;
}

export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  mode: OperationMode;
  model: string;
  messages: ChatMessagePayload[];
  /** Single attached image for the current turn, as a data URL. */
  imageDataUrl?: string;
  chatId?: string;
  /** Defaults to true; false returns a single JSON answer instead of SSE. */
  stream?: boolean;
}

export type ChatStreamEvent =
  | {
      type: "meta";
      requestedModel: string;
      model: string;
      provider?: string;
      fallbackAttempts: number;
      requestId?: string;
      /** Present when the server changed the model for a capability reason. */
      notice?: string;
    }
  | { type: "delta"; text: string }
  | { type: "done"; model: string; provider?: string; fallbackAttempts: number }
  | { type: "error"; code: string; message: string; retryable: boolean; details?: string };

export interface GenerateImageRequestBody {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
}

export interface GeneratedImage {
  /** Data URL (preferred) or an HTTPS URL returned by the backend. */
  url: string;
  mime?: string;
  revisedPrompt?: string;
}

export interface GenerateImageResponse {
  ok: true;
  backend: string;
  model?: string;
  images: GeneratedImage[];
  tookMs: number;
}

export interface ApiErrorBody {
  ok: false;
  code: string;
  message: string;
  retryable?: boolean;
  details?: string;
}
