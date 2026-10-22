import { handleChatRequest } from "@/lib/server/ai/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/chat
 *
 * Body (JSON):
 *   { mode, model, messages, attachments?: [{name,mime,dataUrl}], imageDataUrl?, chatId?, stream? }
 *
 * `model` is `auto` or a `provider::model` key from GET /api/models.
 *
 * Streaming response (`text/event-stream`), one JSON object per `data:` line:
 *   { type:"meta",  requestedModel, model, provider?, fallbackAttempts, route, collaboration }
 *   { type:"delta", text }
 *   { type:"collab", stage, peerModel?, verdict?, disputes?, ... }   // optional
 *   { type:"image", images:[{url}], model?, backend? }              // image requests
 *   { type:"done",  model, provider, fallbackAttempts, attempts }
 *   { type:"error", code, message, retryable, details? }
 *
 * Everything provider-related happens server-side in `lib/server/ai/*`.
 * The browser never sees a provider URL, an API key, or a raw upstream body.
 */
export async function POST(req: Request) {
  return handleChatRequest(req);
}
