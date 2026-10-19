# X AI — Image Prompt Studio & AI Chat

A complete, working Next.js application for turning a **reference image into a highly detailed
image-generation prompt**, chatting with AI models through your own **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)**
gateway, and optionally generating images — with **no accounts, no login, and chats stored locally in
the browser**.

Built for a dark-navy "space" aesthetic: quiet royal-blue gradients, restrained cyan accents, thin
hairline borders, a luminous X mark, and a simple readable chat layout.

---

## Contents

1. [What is implemented](#what-is-implemented)
2. [What you must configure](#what-you-must-configure)
3. [Honest limits](#honest-limits)
4. [Stack and structure](#stack-and-structure)
5. [Local development](#local-development)
6. [OmniRoute setup](#omniroute-setup)
7. [Environment variables](#environment-variables)
8. [Deployment (Vercel and other hosts)](#deployment-vercel-and-other-hosts)
9. [The localhost problem, explained](#the-localhost-problem-explained)
10. [Model routing and fallback](#model-routing-and-fallback)
11. [Image understanding and image generation](#image-understanding-and-image-generation)
12. [Security model](#security-model)
13. [API reference](#api-reference)
14. [Manual test checklist](#manual-test-checklist)
15. [Troubleshooting](#troubleshooting)
16. [Development mock gateway](#development-mock-gateway)

---

## What is implemented

| Area | Status |
| --- | --- |
| Landing page (shader-gradient background, hero with two Start CTAs, capabilities, how-it-works, privacy note, footer credit) | ✅ fully implemented |
| Chat workspace (sidebar, search, grouped recent chats, **pin / rename / archive / delete**, model picker, modes) | ✅ fully implemented |
| Streaming chat through OmniRoute `/v1/chat/completions` | ✅ real streaming, no simulated typing |
| Image → Prompt mode with a 10-section analysis and a copyable prompt block | ✅ implemented server-side prompt engineering |
| Image attach: file picker, clipboard paste, drag & drop, full-viewport drop overlay | ✅ implemented |
| Local persistence: IndexedDB chats, messages and image Blobs; localStorage for small prefs | ✅ implemented |
| Model catalog from the real gateway (`GET /v1/models`) with capability detection | ✅ implemented |
| Guarded fallback across an operator-configured model list | ✅ implemented (retryable errors only) |
| Image generation | ✅ implemented, but **off until you configure a backend** |
| Privacy / Terms / AI Provider & Usage pages | ✅ implemented |
| SVG brand mark + favicon (X, not the reference "AI") | ✅ implemented |
| Type check, lint and production build | ✅ all green |

There is **no fake data** anywhere: if the gateway is not configured, the app says so; if a model
cannot read images, the request is refused with an explanation; if image generation is not
configured, the API returns `501` and the UI shows a setup state.

---

## What you must configure

X AI contains **no model of its own**. To make chat work you need:

1. A running **OmniRoute** instance (self-hosted) with at least one provider connected.
2. An **OmniRoute API key** created in its dashboard.
3. Two server environment variables: `OMNIROUTE_BASE_URL` and `OMNIROUTE_API_KEY`.

Optional: `OMNIROUTE_IMAGE_MODEL` (image generation through an OmniRoute image model) or
`COMFYUI_BASE_URL` (ComfyUI backend).

Everything else has sensible defaults. See [.env.example](.env.example).

---

## Honest limits

- **No "unlimited free AI".** Every answer consumes a provider account, quota or credit that the
  site operator configured. Free tiers, trials and rate limits are controlled by the providers and
  can change or run out at any time. The app never claims otherwise.
- **OmniRoute is a router, not a source of inference.** It must be installed and pointed at
  provider accounts/keys you are entitled to use. See its own README and docs.
- **A Vercel deployment cannot reach `http://localhost`.** See
  [The localhost problem](#the-localhost-problem-explained).
- **Image understanding ≠ image generation.** They are separate capabilities, detected separately,
  and both depend on which models your gateway exposes.
- **A text prompt cannot reproduce an image pixel-for-pixel.** The prompt engine is explicitly
  instructed to separate observed facts from inferences and never to promise reconstruction.
- **Local chats are not backed up.** IndexedDB lives in one browser on one device.

---

## Stack and structure

- **Next.js 15 (App Router) + React 19 + TypeScript** (strict mode).
- **Tailwind CSS** with a small token layer (`tailwind.config.ts`, `app/globals.css`).
- **lucide-react** icons, **react-markdown + remark-gfm** for safe Markdown, **zod** for request validation.
- **IndexedDB** (native, no wrapper library) for chats, messages and image blobs.

### Design system notes

- **`ShaderBackground`** (`components/landing/ShaderBackground.tsx`) reproduces the supplied
  reference gradient: indigo field, big amber / pink / electric-blue blobs warped by SVG
  `feTurbulence` + `feDisplacementMap`, star dust, and a legibility scrim. It is inline SVG + CSS, so
  it stays sharp at any resolution, covers the viewport in both directions, and needs no WebGL or
  remote asset. Two layers drift slowly; all motion stops under `prefers-reduced-motion`.
- **3D buttons** (`.btn-3d`, `.btn-3d-ghost` in `app/globals.css`) use a light top face, a solid dark
  edge and a press transform, so they physically depress on click, tap, or keyboard activation.
- **Neon accents** (`.neon-chip`, `.neon-box`, `.neon-blue`, `.neon-cyan`) are used for the mode
  switches (Chat / Image → Prompt), Attach, New, the sidebar handle and the archive state — kept to
  interactive elements so text stays readable.
- **Typography** is white on near-black cards with a larger body size (16 px messages, 17–18 px
  landing copy) for contrast on top of the gradient.
- **Pin / rename / archive**: every chat row reveals pin, rename, archive and delete actions on hover
  or keyboard focus. Pinned chats get their own group at the top, archived chats move out of the
  main list into **Archive**, which sits directly above Settings in the sidebar footer.

```
app/
  page.tsx                  Landing page
  chat/page.tsx             Workspace (client component shell)
  privacy|terms|ai-usage/   Policy pages
  icon.svg                  Favicon / app icon (SVG X mark)
  api/
    health/route.ts         GET  – gateway reachability (no secrets)
    models/route.ts         GET  – normalised public model catalog
    chat/route.ts           POST – streaming chat + vision, with fallback
    generate-image/route.ts GET  – backend status; POST – real generation
components/
  brand/XMark.tsx           SVG brand mark and wordmark
  landing/                  HeroX (CSS/SVG 3D X), ChatPreview, SiteFooter
  chat/                     ChatApp, Sidebar, Composer, MessageBubble, SettingsDialog,
                            ConfirmDialog, DropOverlay
  policy/PolicyLayout.tsx   Shared policy page shell
  Markdown.tsx              Sanitised-by-construction Markdown renderer (no rehype-raw)
lib/
  types.ts                  Shared client/server types (no secrets)
  server/                   config, gateway client, chat orchestrator, prompts,
                            image generation, rate limiting, validation, errors
  client/                   IndexedDB, settings, image pipeline, API client
tools/mock-gateway.mjs      Local-only test gateway (never deployed)
```

---

## Local development

Requirements: **Node.js 20+** and npm.

```bash
npm install
cp .env.example .env.local     # then edit the two required values
npm run dev                    # http://localhost:3000
```

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run build       # production build (must pass)
npm start           # run the production build
```

> **Note about this workspace copy:** `.env.local` is committed here pointing at the **development
> mock gateway** (`tools/mock-gateway.mjs`, port 20128) so the UI can be exercised end to end. The
> mock returns canned text — replace that file with your real OmniRoute settings before drawing any
> conclusion about answer quality. Start the mock with `node tools/mock-gateway.mjs`.

---

## OmniRoute setup

X AI is written against the OmniRoute API as documented in the official repository
(<https://github.com/diegosouzapw/OmniRoute>, docs in `docs/reference/API_REFERENCE.md`). The
integration points verified there are:

| Purpose | Endpoint |
| --- | --- |
| Model catalog | `GET {base}/models` (supports `?prefix=alias`, `?capability=vision`, `?kind=image`, `?q=`) |
| Chat | `POST {base}/chat/completions` (OpenAI-compatible, streaming supported) |
| Image generation | `POST {base}/images/generations` |
| Auth | `Authorization: Bearer <OmniRoute API key>` |

### 1. Install and run OmniRoute

Any documented method works (npm, Docker, Bun, from source). Docker is the least fiddly:

```bash
docker run -d --name omniroute --restart unless-stopped \
  -p 127.0.0.1:20128:20128 \
  -v omniroute-data:/app/data \
  diegosouzapw/omniroute:latest
```

The dashboard is then at `http://localhost:20128`, and the OpenAI-compatible API at
`http://localhost:20128/v1`. (Confirmed in the repository README: "Dashboard at
`http://localhost:20128` · API at `http://localhost:20128/v1`".)

### 2. Connect at least one provider

Dashboard → **Providers** → choose a provider whose current terms and quota fit your use → add its
API key or complete its account flow. Free tiers may require signup, approval or a payment method.

### 3. Create an API key

Dashboard → **Endpoints** → create/copy an API key. This is the value for `OMNIROUTE_API_KEY`. It
stays on the server; X AI never sends it to a browser.

### 4. Verify

```bash
curl http://localhost:20128/v1/models -H "Authorization: Bearer YOUR_KEY"
```

Then set in `.env.local`:

```env
OMNIROUTE_BASE_URL=http://localhost:20128/v1
OMNIROUTE_API_KEY=YOUR_KEY
```

Restart `npm run dev`. In the app: **Settings → Test connection** should report *Connected* with a
model count.

> OmniRoute is **not** OpenRouter. They are different projects; do not mix up their keys or URLs.

---

## Environment variables

All values are server-side only. **No `NEXT_PUBLIC_` variable is used anywhere, and no secret is
ever sent to the browser.**

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OMNIROUTE_BASE_URL` | ✅ | — | Gateway base URL. `http://localhost:20128`, `…/v1`, or a full URL; it is normalised to end in `/v1`. |
| `OMNIROUTE_API_KEY` | ✅ | — | Key from the OmniRoute dashboard. Server-side only. |
| `OMNIROUTE_FALLBACK_MODELS` | — | empty | Comma-separated ordered model ids tried after the selected one (retryable failures only). |
| `OMNIROUTE_VISION_MODEL` | — | empty | Vision model used when an image is attached but the selected model is text-only. |
| `OMNIROUTE_AUTO_FALLBACK` | — | `true` | Allow OmniRoute's `auto` / `auto/vision` route as a last resort. |
| `OMNIROUTE_MAX_FALLBACK_ATTEMPTS` | — | `3` | Hard cap on model attempts per request. |
| `OMNIROUTE_TIMEOUT_MS` | — | `60000` | Per-request timeout for catalog/non-streaming calls. |
| `OMNIROUTE_STREAM_TIMEOUT_MS` | — | `120000` | Timeout for a streaming completion. |
| `IMAGE_BACKEND` | — | auto | `omniroute` or `comfyui`. Auto-detected from the two variables below. |
| `OMNIROUTE_IMAGE_MODEL` | — | empty | Provider image model id, e.g. an id from `GET /v1/models?kind=image`. |
| `COMFYUI_BASE_URL` | — | empty | ComfyUI server, e.g. `http://127.0.0.1:8188`. |
| `COMFYUI_CHECKPOINT` | — | `v1-5-pruned-emaonly.safetensors` | Checkpoint used by the built-in workflow. |
| `COMFYUI_NEGATIVE_PROMPT` | — | built-in | Negative prompt for the built-in workflow. |
| `COMFYUI_WORKFLOW_JSON` | — | built-in SD1.5 txt2img | Custom API-format workflow with `__PROMPT__`, `__NEGATIVE__`, `__SEED__`, `__WIDTH__`, `__HEIGHT__`, `__CHECKPOINT__` placeholders. |
| `COMFYUI_TIMEOUT_MS` | — | `180000` | How long to wait for a ComfyUI job. |
| `MAX_IMAGE_BYTES` | — | `12582912` (12 MB) | Server-side inline image limit. |
| `RATE_LIMIT_ENABLED` | — | `true` | Enables the in-memory limiter. |
| `RATE_LIMIT_WINDOW_MS` | — | `60000` | Limiter window. |
| `RATE_LIMIT_CHAT_PER_WINDOW` | — | `30` | Chat requests per IP per window. |
| `RATE_LIMIT_IMAGE_PER_WINDOW` | — | `6` | Image generations per IP per window. |
| `RATE_LIMIT_READ_PER_WINDOW` | — | `120` | Health/models requests per IP per window. |

---

## Deployment (Vercel and other hosts)

### Vercel

```bash
npm i -g vercel
vercel link
vercel env add OMNIROUTE_BASE_URL production     # https://your-gateway.example.com/v1
vercel env add OMNIROUTE_API_KEY production
# optional: OMNIROUTE_FALLBACK_MODELS, OMNIROUTE_VISION_MODEL, OMNIROUTE_IMAGE_MODEL
vercel --prod
```

Or set the same values in **Project → Settings → Environment Variables**, then deploy from the
dashboard. No `vercel.json` is required; the API routes use the Node runtime and `maxDuration` hints.

After deploying:

1. Open `/chat` → **Settings**. The status should read **Connected**.
2. If it reads **Not configured**, the variables are missing from the *production* environment
   (they are per-environment).
3. If it reads **Temporarily unavailable**, the server cannot reach the gateway (see below).

### Any Node host (VPS, Docker, Railway, Fly, Render)

```bash
npm ci
npm run build
OMNIROUTE_BASE_URL=… OMNIROUTE_API_KEY=… npm start   # serves on :3000
```

Put it behind a reverse proxy with TLS. This is the easiest way to let the app reach an
OmniRoute instance on the same private network.

---

## The localhost problem, explained

`OMNIROUTE_BASE_URL=http://localhost:20128/v1` works **only** when the gateway runs on the same
machine as the server process — i.e. your laptop during `npm run dev`.

It cannot work on Vercel: `localhost` inside a serverless function is the function's own sandbox,
not your computer, and Vercel's functions cannot dial back into your machine. A public visitor's
browser cannot help either, because every gateway call is made server-side by design (that is what
keeps your key secret).

Options, in order of preference:

1. **Host OmniRoute on a reachable server** (VPS, home server with a domain, Docker on a cloud VM)
   and point `OMNIROUTE_BASE_URL` at its HTTPS address. Restrict access at the network layer
   (firewall allowlist, VPN, or a reverse proxy that only forwards `/v1/*`).
2. **Run X AI next to OmniRoute** (same Docker network / same VPS). Then `OMNIROUTE_BASE_URL` can be
   a private address such as `http://omniroute:20128/v1` and nothing is exposed publicly.
3. **Use a private tunnel** (Cloudflare Tunnel, Tailscale Funnel, ngrok) that exposes OmniRoute with
   authentication in front of it.

In every case:

- Keep `/v1` protected by an OmniRoute API key (never an unauthenticated instance).
- **Never expose the OmniRoute dashboard or an unauthenticated API to the public internet.**
- Do not put the key in a client bundle, a `NEXT_PUBLIC_` variable, `localStorage`, or source control.
- If the public site is meant for real users, add platform-level abuse protection (Vercel Firewall,
  Cloudflare, nginx `limit_req`) — the built-in limiter is best-effort (see below).

---

## Model routing and fallback

1. **Auto (default).** `model: "auto"` is passed straight to OmniRoute, which routes among the
   provider connections its operator enabled. When the user attaches an image, X AI sends
   `auto/vision` — OmniRoute's documented vision route — so the request lands on a vision-capable
   model without inventing aliases.
2. **Explicit model.** The picker is populated from `GET /v1/models?prefix=alias` (the prefix mode
   OmniRoute recommends for model pickers). An id that is not in that catalog is rejected up front
   with a clear message instead of being forwarded.
3. **Capability check.** If an image is attached and the chosen model is text-only, X AI either uses
   `OMNIROUTE_VISION_MODEL` (and tells you it did) or refuses with an explanation. Images are never
   sent to text-only models.
4. **Fallback.** After the selected model, the ordered `OMNIROUTE_FALLBACK_MODELS` list is tried, then
   (optionally) `auto`. Only **retryable** outcomes trigger a retry: `429`, `5xx`, timeouts, and
   "model unavailable"/`404`. `400`, `401`, `403` and validation errors are returned immediately —
   retrying them would be pointless and could look like quota evasion. Attempts are capped by
   `OMNIROUTE_MAX_FALLBACK_ATTEMPTS` with a short backoff between tries.
5. **Attribution.** The response reports which model actually answered (from the gateway's
   `X-OmniRoute-Model` / `X-OmniRoute-Provider` headers) and the UI shows
   "routed from auto" plus the fallback count.

Logging is metadata only: request id, route, model id, status class, duration. Prompt text, image
bytes and keys are never logged.

---

## Image understanding and image generation

### Image → Prompt

- Attach one image (button, paste, or drag & drop anywhere in the window) and press send. With an
  empty message the server injects a dedicated analysis instruction.
- The system prompt requires ten sections (subject, composition, camera feel *marked as inferred*,
  lighting, colour, background, materials, mood/style, aspect ratio, observed-vs-inferred) followed by
  **one** fenced `text` block containing the final prompt with negative constraints.
- The fenced block renders with a **Copy prompt** button.
- Follow-ups ("make it more photorealistic", "keep the pose") reuse the conversation context; if the
  image is not in the current turn the model works from the earlier prompt and is told not to invent
  new details.
- The prompt explicitly forbids promising a pixel-perfect reconstruction.

### Image generation (optional)

Two honest backends, selected by configuration:

- **OmniRoute image models** — `POST {base}/images/generations` with `OMNIROUTE_IMAGE_MODEL`.
  OmniRoute documents this endpoint and normalises provider output into OpenAI's `data[]` shape
  (`b64_json` or `url`).
- **ComfyUI** — `COMFYUI_BASE_URL` plus the built-in SD1.5 txt2img workflow (or your own
  `COMFYUI_WORKFLOW_JSON`). The server submits the graph, polls `/history`, then downloads the result
  from `/view`.

If neither is configured, `GET /api/generate-image` reports `configured: false`, the "Generate image"
button explains why it cannot run, and `POST` returns `501 image_backend_not_configured`. No
placeholder image is ever returned. Generation cost, GPU load and availability belong to whichever
backend you configure.

---

## Security model

- **Secrets stay server-side.** `lib/server/config.ts` is marked `server-only`; no key is read by a
  client component, and there is no `NEXT_PUBLIC_` variable in the project.
- **The browser only talks to this site's `/api/*` routes** using relative URLs.
- **Upstream errors are sanitised.** A status class is mapped to a stable code and a human sentence;
  the raw upstream body never reaches the client (it is only reduced to a short, key-redacted snippet
  for the server log).
- **Validation everywhere.** Zod schemas on every POST body, size caps on JSON bodies and inline
  images, MIME allowlist (`png/jpeg/webp/gif`), model-id shape checks.
- **Abort handling.** Upstream calls use timeouts plus the incoming request's abort signal, so a
  closed tab does not leave a stream running forever.
- **Rate limiting.** In-memory, per-IP, per-route. It protects a single Node process only — serverless
  deployments run several isolated instances, so treat it as a speed bump and add platform-level
  protection for anything public.
- **No admin surface.** There is deliberately no public endpoint that can read or change provider
  settings, because the first version has no login to protect one with.
- **Markdown is safe by construction:** `react-markdown` without `rehype-raw`; HTML in model output
  is shown as text. Links are `target="_blank" rel="noopener noreferrer"`.
- **Headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a restrictive
  `Permissions-Policy` are set in `next.config.ts`. (No CSP is set because Next.js injects inline
  scripts; add a nonce-based CSP if your host requires one.)

---

## API reference

### `GET /api/health`

```json
{ "status": "connected", "latencyMs": 42, "modelCount": 187, "gatewayVersion": "3.8.x", "checkedAt": 1760000000000 }
```

`status` is `connected`, `not_configured` or `unavailable`. Never includes the gateway URL or key.
Results are cached for 10 seconds (including failures).

### `GET /api/models?refresh=1`

```json
{
  "status": "connected",
  "models": [{ "id": "provider/model", "label": "provider/model", "provider": "provider", "kind": "chat", "vision": true, "contextLength": 200000 }],
  "visionModels": ["provider/model"],
  "imageModels": ["provider/image-model"],
  "autoAvailable": true,
  "autoVisionAvailable": true,
  "fetchedAt": 1760000000000
}
```

Only safe public metadata is returned. Failures return `status: "unavailable"` with a message and an
empty list, so the UI can degrade gracefully instead of showing a fake catalog.

### `POST /api/chat`

```json
{
  "mode": "image-to-prompt",          // or "chat"
  "model": "auto",                    // or an id from /api/models
  "messages": [{ "role": "user", "content": "" }],
  "imageDataUrl": "data:image/jpeg;base64,…",
  "stream": true
}
```

Responds with `text/event-stream`; each frame is one JSON object:

```
data: {"type":"meta","requestedModel":"auto/vision","model":"provider/vision","provider":"provider","fallbackAttempts":0,"requestId":"…"}
data: {"type":"delta","text":"## Scene summary\n"}
data: {"type":"done","model":"provider/vision","fallbackAttempts":0}
data: {"type":"error","code":"rate_limited_upstream","message":"…","retryable":true}
```

With `"stream": false` the route returns `{ ok, text, model, provider, requestedModel, fallbackAttempts }`.
Errors before streaming starts return `{ ok:false, code, message, retryable }` with an appropriate
status (`400`, `413`, `415`, `422`, `429`, `502`, `503`, `504`).

### `GET` / `POST /api/generate-image`

`GET` → `{ configured, backend, message, gatewayConfigured }`.
`POST` → `{ prompt, model?, size?, n? }` → `{ ok:true, backend, model, images:[{ url, mime }], tookMs }`,
or `501` when no backend is configured.

---

## Manual test checklist

Verified against the development mock gateway **and** the type/lint/build pipeline:

- [x] Landing page renders; "Start" opens `/chat` with no intermediate screen.
- [x] Send a text message → streams, shows the model that answered, persists after reload.
- [x] Attach an image in Image → Prompt mode with a blank message → full analysis + copyable prompt.
- [x] Copy button copies the fenced prompt; "Copy" copies the whole answer.
- [x] Regenerate replaces the last answer without losing the conversation.
- [x] Generate image → produces a stored image card with a download link (backend-dependent).
- [x] Unknown model → clear 400 with an explanation; text-only model + image → vision substitution notice.
- [x] Rate-limited model → automatic fallback to the next eligible model, `fallbackAttempts: 1`.
- [x] Sidebar search matches chat titles and message text; chats group by date.
- [x] Rename, delete a chat, and "Clear local chats" all require/confirm appropriately.
- [x] Settings → Test connection reports Connected / Not configured / Temporarily unavailable.
- [x] Reload restores chats and their images from IndexedDB.
- [x] No console errors; no horizontal overflow at 390 px and 1440 px.
- [x] `npm run typecheck`, `npm run lint`, `npm run build` all pass.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Status "Not configured" | `OMNIROUTE_BASE_URL` / `OMNIROUTE_API_KEY` missing for this environment | Add them and redeploy (`vercel env add … production`). |
| Status "Temporarily unavailable" | Gateway unreachable from the server (localhost on Vercel, firewall, TLS, wrong port) | Use a reachable URL; see [the localhost problem](#the-localhost-problem-explained). |
| "The gateway rejected the configured OmniRoute API key" | Revoked key, wrong key, or a key without access to that model | Recreate the key in Dashboard → Endpoints. |
| Model list is empty | Gateway reachable but no provider connected, or the key cannot see models | Connect a provider in OmniRoute; check key permissions. |
| "…is not in the gateway's model catalog" | Model id typo or a model your key cannot see | Refresh the list in Settings or use Auto. |
| Image requests fail with 422 | Selected model has no vision capability | Pick a vision model, set `OMNIROUTE_VISION_MODEL`, or use Auto. |
| Upload fails at ~4 MB | Platform request-body limit | X AI already downscales to ≤ 2048 px, but try a smaller image. |
| Image generation returns 501 | No image backend configured | Set `OMNIROUTE_IMAGE_MODEL` or `COMFYUI_BASE_URL`. |
| ComfyUI times out | Queue busy or huge workflow | Raise `COMFYUI_TIMEOUT_MS`, check the ComfyUI console. |
| Chats disappeared | Browser data cleared / private window / different browser | Expected: local-only storage. |
| "Local storage is unavailable" warning | IndexedDB blocked (private mode, site settings) | The session still works; enable storage to save chats. |
| Streaming stops instantly | Proxy buffering or gateway timeout | Check the host's function timeout; increase `OMNIROUTE_STREAM_TIMEOUT_MS`. |

**Correlating an error:** every server log line starts with `[x-ai] rid=…` and contains only route,
model, status class and duration.

---

## Development mock gateway

`tools/mock-gateway.mjs` is an OpenAI-compatible stub used **only for local UI testing**. It returns
canned replies and is never imported by the application, never bundled, and must never be deployed.

```bash
node tools/mock-gateway.mjs        # http://127.0.0.1:20128/v1, key: test-key
```

Test hooks: model ids containing `limited` → `429`, `missing` → `404`, `textonly` → rejects images.

---

## Credits

Developed by **[TAREK](https://tarek0p.pages.dev/)**.

OmniRoute is a separate open-source project by its own authors — see
<https://github.com/diegosouzapw/OmniRoute>. X AI is not affiliated with OmniRoute, any model
provider, or any of their brands.
