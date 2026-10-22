/**
 * Mock media providers for local verification only.
 *
 * Speaks the *documented* request/response shapes of four services so the
 * adapters in `lib/server/ai/media.ts` can be exercised without spending real
 * credit. Each service gets its own path prefix, so one process can serve all
 * four:
 *
 *   GEMINI_BASE_URL=http://127.0.0.1:20301/v1beta   Google Gemini (:generateContent)
 *   XAI_BASE_URL=http://127.0.0.1:20301/xai         xAI Imagine (images + videos)
 *   KIE_BASE_URL=http://127.0.0.1:20301/kie         Kie.ai task API
 *   WIRO_BASE_URL=http://127.0.0.1:20301/wiro/v1    Wiro.ai task API
 *
 * Usage: node tools/mock-media.mjs           (PORT / MOCK_MEDIA_FAIL select mode)
 *   MOCK_MEDIA_FAIL=gemini|xai|kie|wiro       → that service answers 401
 *   MOCK_MEDIA_PENDING=xai|kie|wiro           → that service never finishes
 */

import http from "node:http";

const PORT = Number(process.env.MOCK_MEDIA_PORT ?? 20301);
const FAIL = (process.env.MOCK_MEDIA_FAIL ?? "").toLowerCase();
const PENDING = (process.env.MOCK_MEDIA_PENDING ?? "").toLowerCase();

// 1x1 transparent PNG — a real, decodable image.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/1V0ZAAAAAElFTkSuQmCC";
// https URLs: the adapters (like the real services) only accept https media links.
const IMAGE_URL = "https://mock.local/files/generated.png";
const VIDEO_URL = "https://mock.local/files/generated.mp4";

const started = Date.now();
const pollCount = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function unauthorized(res, service) {
  json(res, 401, { error: { message: `mock ${service}: invalid api key`, type: "invalid_request_error" } });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({ __raw: raw });
      }
    });
  });
}

/** Second poll of any async task reports success, so tests finish quickly. */
function tick(key) {
  const next = (pollCount.get(key) ?? 0) + 1;
  pollCount.set(key, next);
  return next;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const body = req.method === "POST" ? await readBody(req) : {};
  const auth = req.headers.authorization ?? "";
  const apiKey = req.headers["x-api-key"] ?? req.headers["x-goog-api-key"] ?? "";

  console.log(`[mock-media] ${req.method} ${path} auth=${Boolean(auth || apiKey)} ${JSON.stringify(body).slice(0, 160)}`);

  /* ----------------------------- static files ----------------------------- */
  if (path === "/files/generated.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(Buffer.from(PNG_B64, "base64"));
    return;
  }
  if (path === "/files/generated.mp4") {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.end(Buffer.alloc(64));
    return;
  }

  /* --------------------------- Google Gemini ------------------------------ */
  if (path.startsWith("/v1beta/models/")) {
    if (FAIL === "gemini") return unauthorized(res, "gemini");
    if (!apiKey) return json(res, 400, { error: { message: "API key not valid." } });
    if (!path.endsWith(":generateContent")) return json(res, 404, { error: { message: "no route" } });
    return json(res, 200, {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "Here is the image you asked for." },
              { inlineData: { mimeType: "image/png", data: PNG_B64 } },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });
  }

  /* ------------------------------- xAI ------------------------------------ */
  if (path === "/xai/images/generations") {
    if (FAIL === "xai") return unauthorized(res, "xai");
    if (!auth.startsWith("Bearer ")) return json(res, 401, { error: { message: "missing bearer" } });
    if (!body.model || !body.prompt) return json(res, 400, { error: { message: "model and prompt required" } });
    return json(res, 200, {
      created: Math.floor(Date.now() / 1000),
      data: [{ url: IMAGE_URL, revised_prompt: String(body.prompt) }],
    });
  }
  if (path === "/xai/videos/generations") {
    if (FAIL === "xai") return unauthorized(res, "xai");
    if (!body.model || !body.prompt) return json(res, 400, { error: { message: "model and prompt required" } });
    return json(res, 200, { request_id: "xai-video-1", status: "pending" });
  }
  if (path.startsWith("/xai/videos/")) {
    if (PENDING === "xai") return json(res, 200, { status: "pending" });
    const n = tick(path);
    if (n < 1) return json(res, 200, { status: "pending" });
    return json(res, 200, { status: "done", video: { url: VIDEO_URL, duration: 6 } });
  }

  /* ------------------------------- Kie.ai --------------------------------- */
  if (path === "/kie/api/v1/jobs/createTask") {
    if (FAIL === "kie") return unauthorized(res, "kie");
    if (!body.model) return json(res, 200, { code: 400, msg: "model is required" });
    const kind = /video|veo|kling|sora|hailuo/i.test(String(body.model)) ? "video" : "image";
    return json(res, 200, { code: 200, msg: "success", data: { taskId: `kie-${kind}-1` } });
  }
  if (path === "/kie/api/v1/jobs/recordInfo") {
    const taskId = url.searchParams.get("taskId") ?? "";
    if (!taskId) return json(res, 400, { code: 400, msg: "taskId required" });
    if (PENDING === "kie") return json(res, 200, { code: 200, data: { taskId, state: "generating" } });
    const isVideo = taskId.includes("video");
    return json(res, 200, {
      code: 200,
      data: {
        taskId,
        state: "success",
        // Kie documents this field as a JSON *string*.
        resultJson: JSON.stringify({
          resultUrls: [isVideo ? VIDEO_URL : IMAGE_URL],
          creditsConsumed: 1,
        }),
      },
    });
  }

  /* ------------------------------- Wiro.ai -------------------------------- */
  if (path.startsWith("/wiro/v1/Run/")) {
    if (FAIL === "wiro") return unauthorized(res, "wiro");
    if (!apiKey) return json(res, 401, { result: false, errors: ["invalid api key"] });
    const slug = path.replace("/wiro/v1/Run/", "");
    const kind = /video|veo|kling|sora/i.test(slug) ? "video" : "image";
    return json(res, 200, {
      result: true,
      taskid: `wiro-${kind}-1`,
      socketaccesstoken: `mock-socket-${kind}`,
      totalrunningtask: 1,
    });
  }
  if (path === "/wiro/v1/Task/Detail") {
    const token = String(body.tasktoken ?? body.taskid ?? "wiro-image-1");
    if (PENDING === "wiro") return json(res, 200, { id: token, status: "task_queue", pexit: "" });
    const isVideo = token.includes("video");
    return json(res, 200, {
      id: token,
      status: "task_postprocess_end",
      pexit: "0",
      tasklist: [
        {
          outputs: [{ url: isVideo ? VIDEO_URL : IMAGE_URL }],
        },
      ],
    });
  }

  /* -------------------------------- misc ---------------------------------- */
  if (path === "/health") return json(res, 200, { ok: true, uptimeMs: Date.now() - started, fail: FAIL || null, pending: PENDING || null });
  return json(res, 404, { error: { message: `no mock route for ${path}` } });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-media] listening on http://0.0.0.0:${PORT} fail=${FAIL || "none"} pending=${PENDING || "none"}`);
});
