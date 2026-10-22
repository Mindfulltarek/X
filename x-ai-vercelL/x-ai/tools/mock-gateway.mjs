#!/usr/bin/env node
/**
 * OpenAI-compatible mock provider for LOCAL TESTING ONLY.
 *
 * Exists so the routing, vision, fallback, collaboration and image paths can be
 * exercised without spending real provider quota. It is NOT imported by the
 * app and must never be deployed.
 *
 *   node tools/mock-gateway.mjs
 *   MOCK_PORT=20129 MOCK_STYLE=openrouter MOCK_PREFIX=bee node tools/mock-gateway.mjs
 *
 * Catalogues served:
 *   MOCK_STYLE=openrouter → OpenRouter shape (architecture.input_modalities …)
 *   MOCK_STYLE=omniroute  → OmniRoute shape (type/kind + capabilities object)
 *   MOCK_STYLE=minimal    → id + name only (forces config-declared capabilities)
 *
 * Failure hooks, by model id substring:
 *   rate-limited → 429      missing → 404      broken → 500
 *   textonly     → rejects image input the way real text models do
 */

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 20128);
const KEY = process.env.MOCK_KEY ?? "test-key";
const STYLE = process.env.MOCK_STYLE ?? "openrouter";
const PREFIX = process.env.MOCK_PREFIX ?? "mock";
/** 1 = expose POST /images/generations; 0 = 404 (forces the chat-modalities path). */
const IMAGES_ENDPOINT = process.env.MOCK_IMAGES_ENDPOINT === "1";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** Capability truth for the mock models (what a real provider would publish). */
const SPECS = [
  { id: "fast-1", vision: false, coding: false, reasoning: false, image: false, ctx: 128000, in: 0, out: 0 },
  { id: "vision-1", vision: true, coding: false, reasoning: false, image: false, ctx: 200000, in: 0.2, out: 0.4 },
  { id: "reason-1", vision: false, coding: false, reasoning: true, image: false, ctx: 400000, in: 1.5, out: 3 },
  { id: "code-1", vision: false, coding: true, reasoning: true, image: false, ctx: 200000, in: 0.6, out: 1.2 },
  { id: "textonly-1", vision: false, coding: false, reasoning: false, image: false, ctx: 32000, in: 0.1, out: 0.2 },
  { id: "rate-limited-1", vision: true, coding: true, reasoning: true, image: false, ctx: 100000, in: 0, out: 0 },
  { id: "image-1", vision: false, coding: false, reasoning: false, image: true, ctx: 8000, in: 0, out: 0 },
];

function fullId(id) {
  return `${PREFIX}/${id}`;
}

function catalogEntry(spec) {
  const id = fullId(spec.id);
  const base = { id, object: "model", name: `${PREFIX} ${spec.id}`, owned_by: PREFIX };
  if (STYLE === "openrouter") {
    const input = spec.vision ? ["text", "image"] : ["text"];
    const output = spec.image ? ["image"] : ["text"];
    return {
      ...base,
      canonical_slug: id,
      context_length: spec.ctx,
      architecture: { modality: `${input.join("+")}->${output.join("+")}`, input_modalities: input, output_modalities: output },
      pricing: { prompt: String(spec.in / 1_000_000), completion: String(spec.out / 1_000_000) },
      supported_parameters: spec.reasoning ? ["tools", "response_format", "reasoning"] : ["tools", "response_format"],
      top_provider: { context_length: spec.ctx, max_completion_tokens: 8192 },
    };
  }
  if (STYLE === "omniroute") {
    return {
      ...base,
      type: spec.image ? "image" : "chat",
      kind: spec.image ? "image" : "chat",
      context_length: spec.ctx,
      capabilities: {
        vision: spec.vision,
        tool_calling: true,
        reasoning: spec.reasoning,
        structured_output: true,
      },
    };
  }
  return base;
}

const MODELS = SPECS.map(catalogEntry);

const seen = [];

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 40 * 1024 * 1024) reject(new Error("body too large"));
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
  return (messages ?? []).some(
    (m) => Array.isArray(m.content) && m.content.some((part) => part.type === "image_url"),
  );
}

function systemText(messages) {
  return (messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
}

function userText(messages) {
  return (messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((p) => p.text ?? "").join(" ")))
    .join("\n");
}

function replyFor(body) {
  const messages = body.messages ?? [];
  const sys = systemText(messages);
  const user = userText(messages);

  // Synthesis pass of the collaboration feature.
  if (sys.includes("You compare two independent answers")) {
    return JSON.stringify({
      verdict: "partial",
      summary: "Both answers agree on the main point; B adds a caveat about quotas.",
      disputes: [
        {
          topic: "Quota behaviour",
          primary: "Says the request will always succeed.",
          peer: "Notes that provider quotas can reject a request.",
          resolution: "B is right: quotas are provider-controlled, so A overstates availability.",
        },
      ],
      addendum: "Note that provider quotas can still reject a request.",
    });
  }

  // Independent peer answer.
  if (sys.includes("careful second analyst")) {
    return `Independent mock answer from ${body.model}. The question was: ${user.slice(0, 120)}. Provider quotas can reject a request, which the other answer may omit.`;
  }

  if (hasImage(messages)) {
    return [
      "## Scene summary",
      "A mock analysis of the attached image so the vision pipeline can be tested end to end.",
      "",
      "## Detailed analysis",
      "1. **Subject** — placeholder subject.",
      "2. **Composition & framing** — centred.",
      "3. **Lighting** — soft key from the left.",
      "",
      "## Final prompt",
      "```text",
      "mock subject in a cool blue environment, soft key light, cinematic; avoid: text, watermark",
      "```",
    ].join("\n");
  }

  const doc = user.includes("Attached file:");
  return [
    `Mock reply from ${body.model}.`,
    doc ? "I can see the attached document text." : "",
    "Streaming, routing and local storage are working.",
  ]
    .filter(Boolean)
    .join(" ");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  seen.push(url.pathname);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: "Invalid API key" } });
    return json(res, 200, { object: "list", data: MODELS });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, style: STYLE });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: "Invalid API key" } });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: { message: "Invalid JSON" } });
    }

    const model = String(body.model ?? "");
    const spec = SPECS.find((candidate) => model === fullId(candidate.id));

    if (model.includes("missing")) return json(res, 404, { error: { message: "Model not found" } });
    if (model.includes("rate-limited")) return json(res, 429, { error: { message: "Quota exceeded" } });
    if (model.includes("broken")) return json(res, 500, { error: { message: "Upstream exploded" } });
    if (hasImage(body.messages) && spec && !spec.vision) {
      return json(res, 400, { error: { message: "This model does not accept image input" } });
    }

    // OpenRouter-style image generation through chat modalities.
    if (Array.isArray(body.modalities) && body.modalities.includes("image")) {
      return json(res, 200, {
        id: "chatcmpl-mock-image",
        object: "chat.completion",
        model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Here is the image you asked for.",
              images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } }],
            },
          },
        ],
      });
    }

    const text = replyFor(body);
    const headers = { "X-Mock-Provider": PREFIX };

    if (!body.stream) {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
    }

    res.writeHead(200, { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const chunks = text.match(/[\s\S]{1,40}/g) ?? [];
    let index = 0;
    const timer = setInterval(() => {
      if (index < chunks.length) {
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: { content: chunks[index] } }],
          })}\n\n`,
        );
        index += 1;
      } else {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
      }
    }, 12);
    req.on("close", () => clearInterval(timer));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/images/generations") {
    if (!IMAGES_ENDPOINT) return json(res, 404, { error: { message: "Not found" } });
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: "Invalid API key" } });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: { message: "Invalid JSON" } });
    }
    if (!body.prompt) return json(res, 400, { error: { message: "prompt is required" } });
    return json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: PNG_B64 }] });
  }

  return json(res, 404, { error: { message: "Not found (mock provider)" } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] ${STYLE} provider on http://127.0.0.1:${PORT}/v1 (prefix ${PREFIX}, key ${KEY}, images=${IMAGES_ENDPOINT})`);
});
