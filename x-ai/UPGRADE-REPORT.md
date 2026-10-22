# X AI — multi-model platform upgrade

**Report date:** 2026-10-22
**Scope:** turn the existing single-gateway deployment into a multi-provider, multi-model platform with
an intelligent router, optional multi-model collaboration, bounded fallback, and a working vision
pipeline — without rebuilding the app or replacing what already worked.
**Verified on:** a production build (`next build` + `next start`) against two local mock providers
(one publishing an OpenRouter-shaped catalogue, one an OmniRoute-shaped catalogue) plus a Playwright
browser run. **No real provider key was available in this environment**, so no live-model answer
quality or billing claims are made here (see §9).

---

## 1. What I inspected first (and what was actually wrong)

I read the repository before changing anything: `package.json`, `app/api/*`, `lib/server/*`,
`lib/client/*`, `components/chat/*`, `.env.example`, `DEPLOY.md`, `tools/mock-gateway.mjs`.

Findings:

| Observation | Consequence |
| --- | --- |
| The deployed `OMNIROUTE_BASE_URL` resolves to **OpenRouter** (`https://openrouter.ai/api/v1`), not to a self-hosted OmniRoute. Its `/api/models` returned 468 rows identical to OpenRouter's catalogue. | The "OmniRoute" settings were really generic provider settings. |
| `lib/server/gateway.ts` read only `id`/`name` plus a flat `vision`/`kind` field. | OpenRouter puts modalities in `architecture.input_modalities` / `output_modalities`, so **0 of 307 vision models and 0 of 12 image models were detected**. |
| `planCandidates()` had no vision model to route to, and `validate.ts` threw a generic `bad_request`. | The user-visible symptom: *"That request could not be understood. Please try again."* when attaching an image. |
| One gateway, one key, one flat fallback list, no capability model, no notion of "which model can do what". | No multi-provider support, no real routing. |
| Everything else (streaming, SSE contract, IndexedDB storage, sidebar, design system, rate limiting, error taxonomy, prompts) worked and was kept. | No rebuild; the new layer replaces `gateway.ts` + `chat-orchestrator.ts` and plugs into the same routes and UI. |

---

## 2. The new AI layer

`lib/server/ai/` — one system, no duplicates. `lib/server/gateway.ts` and
`lib/server/chat-orchestrator.ts` were **deleted**; `lib/server/config.ts` now holds only rate limits
and the optional ComfyUI backend.

```
providers.ts     env → provider list (AI_PROVIDERS JSON, 9 preset keys, legacy OMNIROUTE_*)
capabilities.ts  capability detection: OpenRouter shape, OmniRoute shape, generic shape
registry.ts      merged + cached model registry, runtime model health (no-vision / 404 / quota)
classifier.ts    intent classification → task kind + hard requirements + soft preferences
router.ts        candidate selection and ordering (no fan-out)
client.ts        OpenAI-compatible HTTP client (chat, /images/generations, chat-modalities images)
fallback.ts      error classification, bounded retries, provider/model blocking
files.ts         image / PDF / DOCX / text extraction (server-side)
images.ts        image generation through the registry
collaborate.ts   second-opinion peer + synthesis pass
orchestrator.ts  the request pipeline and the SSE protocol
```

Routes: `/api/chat` (thin wrapper over the orchestrator), `/api/models` (merged catalogue +
capability counts + provider status), `/api/health` (per-provider status, vision/image counts),
`/api/generate-image` (status + generation), **`/api/diagnostics`** (new: explains the configuration
without exposing secrets; verbose per-model table only with `AI_DIAGNOSTICS_TOKEN`).

---

## 3. Provider configuration (deliverable: how to add providers/models/priorities)

Three supported forms, in precedence order:

1. **`AI_PROVIDERS`** — JSON array, full control (`id`, `label`, `baseUrl`, `apiKeyEnv`|`apiKey`,
   `priority`, `discover`, `models[]`, `imageGeneration`, `webSearch`, `headers`).
2. **Preset keys** — any of `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`,
   `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `XAI_API_KEY`, `CEREBRAS_API_KEY`,
   `NVIDIA_API_KEY` that exists adds that provider with its documented endpoint.
   `AI_DISABLE_PRESETS=1` turns presets off.
3. **Legacy** — `OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY` still work as one OpenAI-compatible
   provider, so the current deployment keeps running unchanged until it is reconfigured.

Rules that are enforced, not documented-only:

- Base URLs are normalised (`https://host`, `https://host/v1`, or a full endpoint → `…/v1`).
- A key is read from the **variable named by the provider**, never hardcoded; invalid JSON or a
  missing key produces a specific message ("environment variable ALPHA_KEY is not set",
  "AI_PROVIDERS is invalid: 0.baseUrl …").
- Declared `capabilities` **override** discovered metadata — the escape hatch for providers that
  publish nothing.
- No key, base URL or header ever leaves the server. `/api/models` and `/api/health` expose only
  label, host, status, counts and latency; `/api/diagnostics` exposes the *name* of the key variable
  and whether it is set.
- Changing configuration requires a redeploy (documented in README + DEPLOY.md).

OmniRoute is supported as **one more OpenAI-compatible provider** and is documented as a gateway, not
as free inference, and explicitly not OpenRouter. All OmniRoute-specific env-var assumptions were
removed from the model layer.

---

## 4. Router (deliverable: intent → model)

Per request, `classifier.ts` → `router.ts`:

1. **Classify** the last user turn + attachments into `simple | general | reasoning | coding |
   vision | document | web | image-gen`, a set of **hard requirements** (e.g. image attached ⇒
   `vision`) and ordered **preferences**.
2. **Filter** models that cannot satisfy the requirements, models on unauthorised providers, models
   flagged unhealthy at runtime, and pure image-output models.
3. **Score** (preferences, operator priority, published price per 1M tokens, latency class, whether
   the capability came from provider metadata or a name heuristic) and order.
4. **Return one primary + fallbacks** (capped by `AI_MAX_CANDIDATES`, at most 2 per provider for
   diversity). Never a fan-out to all models.

The reason, task kind, candidate count and attachment counts are sent in the SSE `meta` frame and can
be inspected in `/api/diagnostics`. `AI_FORCED_MODEL`, `AI_ROUTER_ENABLED` and per-model `priority`
give the operator direct control.

---

## 5. Multi-model collaboration (optional, `AI_COLLABORATION=review`)

- Only for `reasoning` / `coding` / `document` requests longer than 80 characters — never for
  greetings, vision transcription or image generation.
- Requires ≥ 2 eligible models (`AI_MAX_MODELS_PER_REQUEST`, default 3).
- The **peer** model (preferring a *different provider*) answers independently **in parallel** with
  the streamed primary answer, so it costs no extra waiting time.
- A **synthesis** call then compares both answers and returns strict JSON: `verdict`
  (`agree|partial|conflict`), up to 3 disputes with `topic / primary / peer / resolution`, and an
  optional short `addendum`. The resolution is required to cite the reasoning of each answer.
- The primary answer is never rewritten. The report appears under it as a collapsible
  **"Second opinion"** panel with the verdict, the peer model, the disagreements and the addendum.
- **Graceful partial failure** is the default behaviour: peer down → `skipped` + reason; synthesis
  timeout/unreadable JSON → `partial` + reason; the primary answer is always kept.

---

## 6. Fallback (deliverable: error classification + bounded retry)

| Upstream | Action |
| --- | --- |
| `401` / `403` | Provider blocked for this request → next provider. Never retried. |
| `402` | Treated as exhausted credit → provider blocked, next provider. |
| `404` | Model removed from rotation for 10 min → next model. |
| `422` (typically "no image support") | Model marked non-vision → next model. |
| `429` / `408` / `5xx` / timeout | One retry with backoff, then next model. |
| `400` / `413` / other | **Stop.** The request is wrong; retrying would hide a bug. |

- Attempts are capped by `AI_MAX_CANDIDATES` (default 4) and the candidate list is already
  capability-filtered, so a fallback can never send an image to a text-only model.
- Request shapes are adapted only where the protocol difference is *known* (e.g. `/images/generations`
  absent → chat-modalities; `max_completion_tokens` vs `max_tokens`).
- The final error is a stable code + one human sentence + a retryable flag; the raw upstream body
  never reaches the browser (only a key-redacted snippet in server logs).
- Runtime health is per server instance, so a model that just 404'd or rejected an image is not
  retried on the next request.

---

## 7. The vision bug (root cause → fix)

**Root cause:** capability metadata was never parsed (OpenRouter publishes
`architecture.input_modalities`), so the registry contained **zero vision models**. With no vision
candidate, the request fell through to a generic validation error — *"That request could not be
understood"*.

**Fix, end to end:**

1. `capabilities.ts` parses OpenRouter, OmniRoute and generic shapes (modalities, `supported_parameters`,
   pricing, context, type/kind), and marks where each capability came from.
2. Router: an attached image sets a hard `vision` requirement; the selected model is checked *before*
   any call. A text-only model is refused with
   `422 model_no_vision` + the names of the vision models available on the deployment — no silent
   downgrade, no generic error.
3. Request format: images are sent as OpenAI `content: [{type:"text"},{type:"image_url"}]` parts on the
   final user turn only, after client-side downscaling (≤ 2048 px, ≤ 2.8 MB) and server-side MIME/size
   validation.
4. Response/error parsing: SSE deltas, non-SSE JSON bodies, empty answers, `422 no-vision` and
   `content-policy` results all map to explicit outcomes.
5. UI: an **"image read"** chip appears when an image was actually sent to a vision model, so the user
   can tell "the model saw it" from "the model ignored it".
6. If a deployment genuinely has no vision model, the UI says so and names the variable to fix.

Documents (PDF/DOCX/text) go through the same pipeline: extracted server-side to text, marked as data
(not instructions), counted in the badge row.

---

## 8. Status area (deliverable: what answered, without secrets)

- **Message badge row:** model id, `via <provider>`, `fallback` chip, `image read` chip, `N doc(s)`
  chip, and a **Second opinion** panel when collaboration ran.
- **Settings → Providers:** one row per provider — status dot, host, model count, latency,
  "config only" vs live catalogue, error message when not OK.
- **Settings → Models & routing:** chat / vision / image counts, per-capability chips, whether Auto
  routing and multi-model review are on.
- **Settings → Image generation:** the backend and model in use, or why it is unavailable.
- **Header / sidebar:** "Providers connected" (or "Reduced providers" when one is down).
- The chat UI itself stays as simple as before: no extra panels unless something relevant happened.

---

## 9. Testing (what was actually executed)

`npm run typecheck` ✅ · `npm run lint` ✅ (no warnings) · `npm run build` ✅

Server-level tests against the two local mock providers (OpenRouter-style + OmniRoute-style):

| # | Test | Result |
| --- | --- | --- |
| 1 | `GET /api/models` | 12 chat models, 4 vision, 2 image, capability histogram, both providers `ok`, `status: connected` |
| 2 | "hi there" | routed to a `fast` model, streamed, `meta.route.kind = simple` |
| 3 | Long analysis prompt | routed to a reasoning model, **collab ran**: peer from the *other* provider, verdict `partial`, 1 dispute + resolution |
| 4 | Coding prompt | primary rate-limited → 1 retry → **fallback** to the next model, `attempts` reported, answer delivered |
| 5 | Image + Auto | routed to a vision model, image parts sent, analysis returned, `images: 1` |
| 6 | Image + explicitly text-only model | `422 model_no_vision`, message lists the available vision models |
| 7 | Text file attachment | `document` task, `documents: 1`, extracted text in the upstream request |
| 8 | "generate an image of …" | routed to the image model, `image` SSE frame, PNG returned |
| 9 | Second provider stopped | `/api/models?refresh=1` → `degraded`; collab degraded to `partial` with a reason; primary answer preserved |
| 10 | No configuration | `/api/health` + `/api/chat` 503 `not_configured` naming the variable; image endpoint `configured: false` |
| 11 | Wrong provider key | provider shown as *Key rejected*: "The provider rejected the API key in ALPHA_KEY"; chat fails with that message |
| 12 | Unknown model id | `400 model_not_found` with a clear message |
| 13 | `GET /api/generate-image`, `POST /api/generate-image`, `GET /api/diagnostics` | correct status, a real image, and a diagnostics dump with no secrets |

Browser run (Playwright, production build, 1440×900): landing → chat → text answer with badges →
collaboration panel → image attachment with `image read` → document attachment → model picker grouped
by provider (optgroups Alpha/Beta) → Settings with both providers connected → "Generate image" from a
fenced prompt producing a downloadable card. **0 console errors, 0 page errors.**

Packaging: the deliverable zip was re-extracted into a clean directory, `npm ci` (469 packages) and
`next build` both succeeded, and `next start` with **no** environment variables returned
`landing 200`, `chat 200`, `api/chat 503 not_configured` — i.e. it fails honestly, not with fake data.

**Not tested (no credentials in this environment):** real model answer quality, real provider quotas,
and a live OpenRouter image-generation call. Both image wire formats are implemented and the
endpoint-detection path is exercised, but I did not make a real paid image request.

---

## 10. Deploying this build

1. Upload/import the project (or `vercel --prod`).
2. Set **one** variable, e.g. `OPENROUTER_API_KEY`, or `AI_PROVIDERS` + your own `*_API_KEY`(s).
   Optional: `AI_COLLABORATION=review`, `AI_IMAGE_MODEL`, `COMFYUI_BASE_URL`.
3. Redeploy (env changes are read at boot).
4. Open **/chat → Settings**: each provider must read *Connected* with a model count, and vision
   count must be > 0 if you want image prompts.
5. `curl https://your-site/api/health` and `/api/models` for a quick check; `/api/diagnostics`
   explains how providers and models were resolved.

The deployment no longer depends on any Windows PC, `localhost` service or Cloudflare tunnel: it talks
to whatever HTTPS endpoints you configure. (A `localhost` provider URL still only works when that
service runs next to the server — documented, not used in production.)

---

## 11. Honest limitations

- The platform never provides inference itself: every answer consumes the operator's provider quota,
  at the provider's price and under the provider's terms.
- Routing quality depends on the metadata a provider publishes. When it publishes none, capabilities
  come from your `AI_PROVIDERS` declarations; name-based heuristics are used only as ranking hints and
  flagged as such in the diagnostics.
- PDF text extraction is best-effort: scanned PDFs have no text layer, and the UI says so.
- Collaboration costs extra tokens. It is off by default, bounded, and skipped automatically when it
  cannot help.
- The rate limiter is in-memory and per instance — fine as a speed bump on one instance, not a
  distributed defence.
- No claim is made about "unlimited" or "free" usage anywhere in the app.

---

## Addendum (2026-10-22, later): video generation through JSON2Video

Added after the initial delivery, on request, keeping the same rules (no invented endpoints, no fake
output, no key in the browser).

**What it is.** JSON2Video is a *renderer*, not a text-to-video model: it turns a JSON "movie" into an
MP4. So the pipeline is: chat model writes a storyboard → the storyboard is compiled to the documented
Movie JSON → `POST /v2/movies` returns a project id → `GET /v2/movies?project=…` is polled until
`done` → the returned MP4 URL is shown. If no chat model is reachable, or its reply is not usable JSON,
the storyboard is built deterministically from the user's own sentences and the UI says which one was
used (`storyboard written by a model` vs `storyboard from your prompt`).

**Wire contract used (from json2video.com/docs/v2).** `x-api-key` header; body
`{ resolution, quality, fps, scenes:[{ duration, background-color, elements:[{ type:"text", text,
settings:{…CSS…} }] }], "client-data": {…} }`; create → `{ success, project, timestamp }`;
status → `{ success, movie:{ status: queued|running|done|error|timeout, url, duration, size,
message } }`. Resolution enum and the 2 MB body limit are respected; 401 is reported as
"key rejected or quota exhausted", 413 as "too large" and never retried blindly.

**New surface.** `GET /api/generate-video` (status, no upstream call), `GET ?project=` (poll),
`POST { prompt }` / `POST { project }`. Chat gains a `video-gen` intent lane and a `video` SSE event;
the assistant bubble renders a `<video>` card with duration, resolution, storyboard provenance and a
download link. Settings gains a **Video generation** row. `/api/diagnostics` reports it.

**Cost/time controls.** `AI_VIDEO_MAX_SECONDS` (default 20) caps total length, `AI_VIDEO_RESOLUTION`
(default `hd`), `AI_VIDEO_ENABLED=0` disables. A render that outlives the request budget returns
`202 status:"pending"` with the project id instead of pretending to be finished.

**Verified** against a local mock that implements the documented endpoints (queued → running → done,
401 on a wrong key): status, render, polling, the chat lane, the deterministic storyboard fallback
with every chat provider stopped, the 401 path and the 501 path; plus typecheck, lint, production
build, and a browser run (0 console errors) — screenshots `chat-video.png`, `settings-video.png`.

**Not verified:** a real JSON2Video render (no account/key in this environment), and real video
quality. Nothing here claims otherwise.

**Enable it:** add `JSON2VIDEO_API_KEY` in Vercel → Environment Variables (Production) → redeploy.
