#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible mock gateway for LOCAL TESTING ONLY.
 *
 * It exists so you can exercise X AI's request handling (streaming, vision
 * capability gating, fallback, image endpoint) without installing OmniRoute.
 * It is NOT part of the application, is never imported by the app, and must
 * never be deployed. Real functionality requires a real OmniRoute gateway —
 * X AI does not ship fake AI.
 *
 * Usage:
 *   node tools/mock-gateway.mjs            # listens on 127.0.0.1:20128
 *   MOCK_PORT=40128 node tools/mock-gateway.mjs
 *
 * Then in .env.local:
 *   OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
 *   OMNIROUTE_API_KEY=test-key
 *   OMNIROUTE_IMAGE_MODEL=mock/image-1
 *
 * Test hooks:
 *   - model ids containing "limited"  → HTTP 429 (exercises fallback)
 *   - model ids containing "missing"  → HTTP 404
 *   - model ids containing "textonly" → rejects image input with 400
 */

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 20128);
const KEY = process.env.MOCK_KEY ?? "test-key";

const MODELS = [
  { id: "auto", object: "model", owned_by: "omniroute", type: "chat", capabilities: { vision: true } },
  { id: "mock/vision-1", object: "model", owned_by: "mock", type: "chat", capabilities: { vision: true }, context_length: 200000 },
  { id: "mock/text-1", object: "model", owned_by: "mock", type: "chat", capabilities: { vision: false }, context_length: 128000 },
  { id: "mock/limited-1", object: "model", owned_by: "mock", type: "chat", capabilities: { vision: true } },
  { id: "mock/image-1", object: "model", owned_by: "mock", type: "image", capabilities: { vision: false } },
];

// 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const seen = [];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-OmniRoute-Version": "mock-0.0.1",
    "X-OmniRoute-Request-Id": `mock-${seen.length}`,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 30 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function hasImage(messages) {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((part) => part.type === "image_url"),
  );
}

function replyFor(body) {
  const hasImg = hasImage(body.messages ?? []);
  if (body.model === "mock/image-1") {
    return "That is an image model; use /v1/images/generations instead.";
  }
  if (hasImg) {
    return [
      "## Scene summary",
      "A mock analysis of the attached image so the X AI pipeline can be tested end to end.",
      "",
      "## Detailed analysis",
      "1. **Subject** — placeholder subject.",
      "2. **Composition & framing** — centred.",
      "3. **Perspective & camera** — inferred 50mm look.",
      "4. **Lighting** — soft key from the left.",
      "5. **Color & grading** — cool blue palette.",
      "6. **Background** — uncluttered.",
      "7. **Materials & textures** — matte surfaces.",
      "8. **Mood & style** — calm, cinematic.",
      "9. **Aspect ratio** — 3:2 (inferred).",
      "10. **Observed vs inferred** — camera and lens are inferred.",
      "",
      "## Final prompt",
      "```text",
      "mock subject standing in a cool blue environment, cinematic soft key light, matte surfaces, calm mood, shallow depth of field, 3:2 framing; avoid: text, watermark, extra limbs",
      "```",
    ].join("\n");
  }
  return `Mock reply from ${body.model}. X AI's request pipeline, streaming and local storage are working.`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  seen.push(url.pathname);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      return json(res, 401, { error: { message: "Invalid API key" } });
    }
    return json(res, 200, { object: "list", data: MODELS });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      return json(res, 401, { error: { message: "Invalid API key" } });
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: { message: "Invalid JSON" } });
    }

    const model = String(body.model ?? "");
    if (model.includes("missing")) return json(res, 404, { error: { message: "Model not found" } });
    if (model.includes("limited")) return json(res, 429, { error: { message: "Quota exceeded" } });
    if (hasImage(body.messages ?? []) && model.includes("textonly")) {
      return json(res, 400, { error: { message: "This model does not accept image input" } });
    }

    const text = replyFor(body);
    const servedModel = model === "auto" ? "mock/vision-1" : model === "auto/vision" ? "mock/vision-1" : model;
    const headers = {
      "X-OmniRoute-Model": servedModel,
      "X-OmniRoute-Provider": servedModel.split("/")[0] ?? "mock",
      "X-OmniRoute-Request-Id": `mock-${seen.length}`,
      "X-OmniRoute-Version": "mock-0.0.1",
    };

    if (!body.stream) {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          model: servedModel,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        }),
      );
    }

    res.writeHead(200, { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const chunks = text.match(/[\s\S]{1,40}/g) ?? [];
    let i = 0;
    const timer = setInterval(() => {
      if (i < chunks.length) {
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            model: servedModel,
            choices: [{ index: 0, delta: { content: chunks[i] } }],
          })}\n\n`,
        );
        i += 1;
      } else {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
      }
    }, 15);
    req.on("close", () => clearInterval(timer));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/images/generations") {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      return json(res, 401, { error: { message: "Invalid API key" } });
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: { message: "Invalid JSON" } });
    }
    if (!body.prompt) return json(res, 400, { error: { message: "prompt is required" } });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-OmniRoute-Model": body.model ?? "mock/image-1",
      "X-OmniRoute-Provider": "mock",
    });
    return res.end(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: PNG_B64 }] }));
  }

  if (req.method === "GET" && url.pathname === "/v1/images/generations") {
    return json(res, 200, { data: MODELS.filter((m) => m.type === "image") });
  }

  return json(res, 404, { error: { message: "Not found (mock gateway)" } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-gateway] listening on http://127.0.0.1:${PORT}/v1 (key: ${KEY})`);
});
