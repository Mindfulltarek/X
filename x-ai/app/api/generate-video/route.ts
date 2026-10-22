import { NextResponse } from "next/server";

import type { GenerateVideoRequestBody, GenerateVideoResponse, VideoBackendPayload } from "@/lib/types";
import { getRegistry } from "@/lib/server/ai/registry";
import { generateVideo, pollVideo, videoBackendStatus } from "@/lib/server/ai/video";
import { mediaBackends } from "@/lib/server/ai/media";
import { ApiError, apiError, errorBody, logServerEvent, newRequestId } from "@/lib/server/errors";
import { checkRateLimit, clientKeyFromHeaders, rateLimits } from "@/lib/server/rate-limit";
import { generateVideoRequestSchema, readJsonBody, zodMessage } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET  /api/generate-video            → is the video backend configured? (no upstream call)
 * GET  /api/generate-video?project=id → poll an existing render
 * POST /api/generate-video            → { prompt } to start one, { project } to keep polling
 *
 * The backend is JSON2Video (`POST /v2/movies` + polling `GET /v2/movies`), whose
 * renders are asynchronous. If a render is still running when this request runs
 * out of time, the response is `202` with `status: "pending"` and a `project`
 * id — the client polls again with that id. A render is never faked: the only
 * `url` returned is the MP4 URL reported by the backend.
 */
export async function GET(req: Request) {
  const limit = checkRateLimit("video-status", clientKeyFromHeaders(req.headers), rateLimits().read);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(apiError("rate_limited", { message: "Too many requests.", status: 429, retryable: true })),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const status = videoBackendStatus();
  const project = new URL(req.url).searchParams.get("project");

  if (!project) {
    const payload: VideoBackendPayload = {
      configured: status.configured,
      backend: status.backend,
      providerLabel: status.providerLabel,
      apiKeyEnv: status.apiKeyEnv,
      resolution: status.resolution,
      maxSeconds: status.maxSeconds,
      message: status.message,
      providers: mediaBackends().filter((entry) => entry.kinds.includes("video")),
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }

  if (!status.configured) {
    return NextResponse.json(errorBody(apiError("video_backend_not_configured", { message: status.message })), {
      status: 501,
    });
  }

  try {
    const result = await pollVideo({ project, signal: req.signal });
    const payload: GenerateVideoResponse = {
      ok: result.status === "done",
      status: result.status,
      url: result.url,
      durationSeconds: result.durationSeconds,
      size: result.size,
      project: result.project,
      resolution: result.resolution,
      waitedMs: result.waitedMs,
      backend: status.backend,
      provider: result.provider,
      providerLabel: result.providerLabel,
    };
    return NextResponse.json(payload, {
      status: result.status === "done" ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("internal");
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const started = Date.now();

  const limit = checkRateLimit("video", clientKeyFromHeaders(req.headers), rateLimits().image);
  if (!limit.allowed) {
    return NextResponse.json(
      errorBody(
        apiError("rate_limited", { message: "Too many video requests. Please wait a moment.", status: 429, retryable: true }),
      ),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: GenerateVideoRequestBody;
  try {
    const raw = await readJsonBody(req, 64 * 1024);
    const parsed = generateVideoRequestSchema.safeParse(raw);
    if (!parsed.success) throw apiError("invalid_payload", { message: zodMessage(parsed.error) });
    body = parsed.data as GenerateVideoRequestBody;
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("invalid_payload");
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }

  const status = videoBackendStatus();
  if (!status.configured) {
    return NextResponse.json(
      errorBody(apiError("video_backend_not_configured", { message: status.message })),
      { status: 501 },
    );
  }

  try {
    const snapshot = await getRegistry();
    const result = body.project
      ? await pollVideo({ project: body.project, signal: req.signal })
      : await generateVideo({ prompt: body.prompt ?? "", snapshot, signal: req.signal });

    const payload: GenerateVideoResponse = {
      ok: result.status === "done",
      status: result.status,
      url: result.url,
      durationSeconds: result.durationSeconds,
      size: result.size,
      project: result.project,
      resolution: result.resolution,
      waitedMs: result.waitedMs,
      backend: status.backend,
      provider: result.provider,
      providerLabel: result.providerLabel,
      storyboard: result.storyboard
        ? {
            title: result.storyboard.title,
            scenes: result.storyboard.scenes.map((scene) => ({ text: scene.text, duration: scene.duration })),
            source: result.storyboard.source,
            author: result.storyboard.author,
          }
        : undefined,
    };

    logServerEvent({
      requestId,
      route: "video",
      status: result.status === "done" ? 200 : 202,
      durationMs: Date.now() - started,
      detail: `backend=${status.backend} project=${result.project} status=${result.status} storyboard=${result.storyboard?.source ?? "n/a"}`,
    });

    return NextResponse.json(payload, {
      status: result.status === "done" ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : apiError("internal");
    logServerEvent({
      requestId,
      route: "video",
      status: apiErr.status,
      code: apiErr.code,
      durationMs: Date.now() - started,
      detail: apiErr.details,
    });
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status });
  }
}
