# X AI — Image Prompt Studio & AI Chat

A complete, working Next.js application for turning a **reference image into a highly detailed
image-generation prompt**, chatting with **any number of OpenAI-compatible AI providers**, and
optionally generating images — with **no accounts, no login, and chats stored locally in the
browser**.

The server keeps a live registry of every model its providers expose, **classifies each request**
(quick question · analysis · coding · vision · document · web · image generation) and **routes it to
one model that can actually serve it**, with bounded fallbacks and an optional **second-opinion pass
by a different model on a different provider**.

Built for a dark-navy "space" aesthetic: quiet royal-blue gradients, restrained cyan accents, thin
hairline borders, a luminous X mark, and a simple readable chat layout.

---

## Contents

1. [What is implemented](#what-is-implemented)
2. [What you must configure](#what-you-must-configure)
3. [Honest limits](#honest-limits)
4. [Stack and structure](#stack-and-structure)
5. [Local development](#local-development)
6. [Multi-provider configuration](#multi-provider-configuration)
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
| Chat workspace (sidebar, search, grouped recent chats, **pin / rename / archive / delete**, capability-grouped model picker) | ✅ fully implemented |
| Streaming chat through any OpenAI-compatible provider (`/chat/completions`) | ✅ real streaming, no simulated typing |
| Image → Prompt mode with a 10-section analysis and a copyable prompt block | ✅ implemented server-side prompt engineering |
| Image attach: file picker, clipboard paste, drag & drop, full-viewport drop overlay | ✅ implemented |
| Local persistence: IndexedDB chats, messages and image Blobs; localStorage for small prefs | ✅ implemented |
| Multi-provider registry: every configured provider's catalogue merged into one capability-labelled model list | ✅ implemented |
| Intent classifier + capability-aware router (one model per request, never a fan-out) | ✅ implemented |
| Guarded fallback with error classification and bounded retries | ✅ implemented |
| Optional multi-model review (independent answer from a second provider + synthesis) | ✅ implemented, `AI_COLLABORATION=review` |
| Vision end-to-end: images are only sent to models that declare vision support | ✅ implemented |
| Documents: PDF / DOCX / text attachments are extracted to text server-side | ✅ implemented (best-effort for PDFs) |
| Image generation from a discovered image model, or a ComfyUI backend | ✅ implemented, **off until one is available** |
| Image generation through Gemini / xAI / Kie.ai / Wiro.ai | ✅ implemented, **off until that service's key is set** |
| Privacy / Terms / AI Provider & Usage pages | ✅ implemented |
| SVG brand mark + favicon (X, not the reference "AI") | ✅ implemented |
| Type check, lint and production build | ✅ all green |

There is **no fake data** anywhere: if the gateway is not configured, the app says so; if a model
cannot read images, the request is refused with an explanation; if image generation is not
configured, the API returns `501` and the UI shows a setup state.

---

## What you must configure

X AI contains **no model of its own**. To make chat work you need **one API key for at least one
OpenAI-compatible provider** — for example OpenRouter, OpenAI, Groq, DeepSeek, Mistral, Together,
xAI, Cerebras or NVIDIA NIM. The simplest possible deployment is a single variable:

```env
OPENROUTER_API_KEY=sk-or-…
```

That one key is enough: the server discovers OpenRouter's catalogue, keeps the capability metadata
(vision, image output, context size, price), and routes every request. To control exactly which
providers and models are used — priorities, manual capability declarations, custom gateways — use
the `AI_PROVIDERS` JSON variable described in
[Multi-provider configuration](#multi-provider-configuration).

Optional: `AI_COLLABORATION=review` (second opinion), `AI_IMAGE_MODEL` (pin an image model),
`COMFYUI_BASE_URL` (ComfyUI image backend). Everything else has sensible defaults. See
[.env.example](.env.example).

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
    health/route.ts         GET  – provider status (no secrets)
    models/route.ts         GET  – merged public model catalogue + capability counts
    chat/route.ts           POST – classify, route, stream, fallback, second opinion
    generate-image/route.ts GET  – backend status; POST – real generation
    diagnostics/route.ts    GET  – why routing behaves the way it does (gated detail)
components/
  brand/XMark.tsx           SVG brand mark and wordmark
  landing/                  HeroX (CSS/SVG 3D X), ChatPreview, SiteFooter
  chat/                     ChatApp, Sidebar, Composer, MessageBubble, SettingsDialog,
                            ConfirmDialog, DropOverlay
  policy/PolicyLayout.tsx   Shared policy page shell
  Markdown.tsx              Sanitised-by-construction Markdown renderer (no rehype-raw)
lib/
  types.ts                  Shared client/server types (no secrets)
  server/
    ai/
      types.ts              Capability / model / provider / route types
      capabilities.ts       Capability detection for OpenRouter, OmniRoute and minimal catalogues
      providers.ts          Environment → provider list (AI_PROVIDERS, presets, legacy OMNIROUTE_*)
      registry.ts           Merged, cached model registry + runtime model health
      classifier.ts         Intent classification (simple/general/reasoning/coding/vision/document/web/image-gen)
      router.ts             Candidate selection: hard capability filters, scoring, fallback ordering
      client.ts             OpenAI-compatible HTTP client (chat + two image formats)
      fallback.ts           Error classification, bounded retries, provider/model health
      collaborate.ts        Second-opinion peer + synthesis pass
      files.ts              Image / PDF / DOCX / text attachment extraction
      images.ts             Image generation through the provider registry
      orchestrator.ts       Request pipeline + SSE protocol
    config.ts               Rate limits and the optional ComfyUI backend
    prompts.ts              System prompts
    errors.ts               Error taxonomy and safe logging
    rate-limit.ts           In-memory per-IP limiter
    validate.ts             Zod request schemas
    imagegen.ts             Backend selection (provider image model or ComfyUI)
  client/                   IndexedDB, settings, file/image pipelines, API client
tools/mock-gateway.mjs      Local-only test gateway (never deployed)
```

---

## Local development

Requirements: **Node.js 20+** and npm.

```bash
npm install
cp .env.example .env.local     # then add one provider key (or AI_PROVIDERS)
npm run dev                    # http://localhost:3000
```

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run build       # production build (must pass)
npm start           # run the production build
```

> **Note about this workspace copy:** `.env.local` points at the **development mock provider**
> (`tools/mock-gateway.mjs`, port 20128) so the UI can be exercised end to end. The mock returns
> canned text — replace that file with a real provider key before drawing any conclusion about answer
> quality. Start the mock with `node tools/mock-gateway.mjs`.

---

## Multi-provider configuration

Everything AI-related is configured with **server-side environment variables**. There is no admin UI
that changes them, and no endpoint that returns them: setting them and redeploying is the only way to
change behaviour (a redeploy is required because Next.js reads `process.env` at boot).

### Option A — one preset key (fastest)

Any of these variables that is present enables that provider automatically:

| Provider | Variable | Endpoint used |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| OpenAI | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| Groq | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |
| DeepSeek | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |
| Mistral | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1` |
| Together AI | `TOGETHER_API_KEY` | `https://api.together.xyz/v1` |
| xAI | `XAI_API_KEY` | `https://api.x.ai/v1` |
| Cerebras | `CEREBRAS_API_KEY` | `https://api.cerebras.ai/v1` |
| NVIDIA NIM | `NVIDIA_API_KEY` | `https://integrate.api.nvidia.com/v1` |

Set one, redeploy, open **Settings → Providers** — the provider appears with its model count.
Presets are skipped for any provider you define yourself in `AI_PROVIDERS`, and can be disabled
entirely with `AI_DISABLE_PRESETS=1`.

### Option B — `AI_PROVIDERS` (full control)

One JSON array. Each entry is a provider; `models` is optional and is how you declare capabilities for
providers that publish no metadata, or pin priorities.

```env
AI_PROVIDERS=[
  {
    "id": "openrouter",
    "label": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "priority": 10,
    "discover": true,
    "models": [
      { "id": "anthropic/claude-sonnet-4.5", "priority": 1, "capabilities": ["vision","reasoning","coding"] },
      { "id": "openai/gpt-5-mini", "priority": 5, "capabilities": ["vision","fast","reasoning"] }
    ]
  },
  {
    "id": "groq",
    "label": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKeyEnv": "GROQ_API_KEY",
    "priority": 30,
    "models": [{ "id": "llama-3.3-70b-versatile", "capabilities": ["fast"] }]
  }
]
```

| Field | Meaning |
| --- | --- |
| `id` | Stable provider id (`a-z0-9-_`). Used in model ids as `provider::model`. |
| `label` | Display name. |
| `baseUrl` | OpenAI-compatible base. `https://host`, `https://host/v1` and full endpoint URLs are normalised to `…/v1`. |
| `apiKeyEnv` | **Name** of the environment variable holding the key (recommended). |
| `apiKey` | Inline key. Supported, but `apiKeyEnv` is safer: the value never appears in the JSON. |
| `priority` | Lower = preferred. Used by the router, not by the provider. |
| `discover` | `true` (default) = also read `GET {baseUrl}/models` and merge the result. |
| `models[]` | Manual models: `id`, `label`, `capabilities` (`vision`, `coding`, `reasoning`, `fast`, `tools`, `web`, `image-gen`, `json`, `long-context`, `document`), `priority`, `costIn`/`costOut` (USD per 1M tokens), `latency`, `contextLength`, `maxTokens`, `enabled`, `maxCompletionTokens`, `webSuffix`. |
| `imageGeneration` | `false` to exclude this provider from image generation. |
| `webSearch` | `online-suffix` if the provider grounds on the web by appending a model suffix (e.g. OpenRouter's `:online`). |

Declared `capabilities` **win over discovered metadata**. That is the escape hatch for a gateway that
publishes nothing useful — the router will then trust your declaration instead of guessing from names.

### How to add a provider, a model, or change priority

1. Add the key: `vercel env add MYPROVIDER_API_KEY production` (or edit `.env.local` locally).
2. Add or edit its entry in `AI_PROVIDERS` (nothing to change if you used a preset key).
3. To pin a model first, set `priority` low on the model and/or the provider.
4. **Redeploy** (Vercel: *Deployments → Redeploy*; locally: restart `npm run dev`). Cached catalogues
   live in memory only, so a restart also clears them.
5. Verify — see [Checking a deployment](#checking-a-deployment).

### Checking a deployment

```bash
node tools/check-providers.mjs https://your-site.example
```

Prints one line per provider (status · chat models · vision models · image models · latency · host),
the routing capabilities, and a pass/fail summary with the exact variable to fix. It only reads the
public endpoints, sends no key, and exits non-zero when something is wrong. It also detects an
out-of-date deployment (a build whose `/api/models` has no `providers`/`capabilities` fields).

In the browser the same information is in **/chat → Settings**:

| What | Where |
| --- | --- |
| Is each provider reachable, and with which key variable? | Settings → **Providers** (status, host, model count, latency, error message) |
| Can this deployment read images / generate images? | Settings → **Models & routing** (vision and image counts must be > 0) |
| Why did a request go to that model? | `/api/diagnostics` (`issues`, per-model table with `AI_DIAGNOSTICS_TOKEN`) |

A healthy deployment looks like this: every provider `ok`, chat count > 0, **vision count > 0** if you
want image prompts, and `image output > 0` if you want image generation.

### OmniRoute and other gateways

Any OpenAI-compatible gateway works as a provider entry, including
[OmniRoute](https://github.com/diegosouzapw/OmniRoute) — a gateway, not free inference: you install
it, connect provider accounts, and use the API key from its dashboard (`http://localhost:20128/v1`
locally). OmniRoute is **not** OpenRouter; their keys and URLs are not interchangeable. Pointing X AI
at OpenRouter does not involve OmniRoute at all.

### Legacy single-gateway variables

`OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY` are still read and are treated as one OpenAI-compatible
provider (id `gateway`, highest priority). `OMNIROUTE_FALLBACK_MODELS` and `OMNIROUTE_VISION_MODEL`
are exposed as manual models on it. They exist for backwards compatibility; new deployments should
use `AI_PROVIDERS` or a preset key.

---

## Environment variables

All values are server-side only. **No `NEXT_PUBLIC_` variable is used anywhere, and no secret is
ever sent to the browser.**

### Providers and routing

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AI_PROVIDERS` | — | empty | JSON array of providers (see above). |
| `OPENROUTER_API_KEY` … `NVIDIA_API_KEY` | one of these or `AI_PROVIDERS` | — | Enables that provider with its documented endpoint. |
| `AI_DISABLE_PRESETS` | — | `false` | `1` = ignore all preset `*_API_KEY` variables. |
| `AI_ROUTER_ENABLED` | — | `true` | Turns the classifier/router on (Auto). |
| `AI_FORCED_MODEL` | — | — | Force every request through one `provider::model` key. |
| `AI_COLLABORATION` | — | `off` | `review` = second-opinion pass for analysis/coding/document requests. |
| `AI_MAX_CANDIDATES` | — | `4` | Max candidates per request (primary + fallbacks). |
| `AI_MAX_MODELS_PER_REQUEST` | — | `3` | Max distinct models involved in one request (collab needs ≥ 2). |
| `AI_IMAGE_MODEL` | — | auto | Pin the image-generation model id. |
| `AI_SYSTEM_SUFFIX` | — | — | Extra instruction appended to every system prompt (operator policy). |
| `AI_MAX_OUTPUT_TOKENS` | — | `4096` | `max_tokens` (or `max_completion_tokens`) sent upstream. |
| `AI_REQUEST_TIMEOUT_MS` | — | `60000` | Timeout for non-streaming provider calls. |
| `AI_STREAM_TIMEOUT_MS` | — | `120000` | Watchdog for a streaming answer. |
| `AI_DISCOVERY_TIMEOUT_MS` | — | `12000` | Per-provider catalogue timeout. |
| `AI_DISCOVERY_CACHE_SECONDS` | — | `300` | How long a catalogue is cached in memory. |
| `AI_MAX_FILE_BYTES` | — | `12582912` (12 MB) | Max attachment size (images and documents). |
| `AI_MAX_DOCUMENT_CHARS` | — | `60000` | Max extracted characters per document. |
| `AI_DIAGNOSTICS_TOKEN` | — | — | Enables the verbose per-model section of `/api/diagnostics`. |
| `AI_APP_URL` / `AI_APP_NAME` | — | — | Sent as `HTTP-Referer` / `X-Title` to OpenRouter-style providers. |
| `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY` | — | — | Legacy single gateway (still supported). |

### Image generation

| Variable | Default | Purpose |
| --- | --- | --- |
| `IMAGE_BACKEND` | auto | `comfyui` to force the ComfyUI backend. Otherwise any discovered image model is used. |
| `COMFYUI_BASE_URL` | — | Self-hosted ComfyUI, e.g. `http://127.0.0.1:8188`. |
| `COMFYUI_CHECKPOINT` | `v1-5-pruned-emaonly.safetensors` | Checkpoint for the built-in workflow. |
| `COMFYUI_NEGATIVE_PROMPT` | built-in | Negative prompt for the built-in workflow. |
| `COMFYUI_WORKFLOW_JSON` | built-in SD1.5 txt2img | Custom API-format graph with `__PROMPT__`, `__NEGATIVE__`, `__SEED__`, `__WIDTH__`, `__HEIGHT__`, `__CHECKPOINT__`. |
| `COMFYUI_TIMEOUT_MS` | `180000` | How long to wait for a ComfyUI job. |

### Image services (Gemini / xAI / Kie.ai / Wiro.ai)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Google AI Studio key → image generation via `models/{model}:generateContent` with `responseModalities:["TEXT","IMAGE"]`. |
| `AI_GEMINI_IMAGE_MODEL` | `gemini-2.5-flash-image` | Gemini image model id. |
| `XAI_API_KEY` | — | xAI key → `POST /images/generations`. |
| `AI_XAI_IMAGE_MODEL` | `grok-imagine-image-2.0` | xAI image model id. |
| `KIE_API_KEY` | — | Kie.ai task API (`/api/v1/jobs/createTask` + `recordInfo`). |
| `AI_KIE_IMAGE_MODEL` | `flux1-kontext` | Kie image model id (ids come from docs.kie.ai). |
| `WIRO_API_KEY`, `WIRO_API_SECRET` | — | Wiro.ai task API (`/v1/Run/{owner}/{model}` + `/v1/Task/Detail`); the secret is only needed for signature projects. |
| `AI_WIRO_IMAGE_MODEL` | *(unset)* | Required `owner/model` slug from wiro.ai — never guessed. |
| `AI_IMAGE_PROVIDERS` | `google,xai,kie,wiro` | Backend preference; the first configured service that succeeds wins, the rest are fallbacks. |
| `GEMINI_BASE_URL`, `XAI_BASE_URL`, `KIE_BASE_URL`, `WIRO_BASE_URL` | official endpoints | Tests / self-hosted mock only (`tools/mock-media.mjs`). |

### Limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `RATE_LIMIT_ENABLED` | `true` | In-memory per-IP limiter (single process only). |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Limiter window. |
| `RATE_LIMIT_CHAT_PER_WINDOW` | `30` | Chat requests per IP per window. |
| `RATE_LIMIT_IMAGE_PER_WINDOW` | `6` | Image generations per IP per window. |
| `RATE_LIMIT_READ_PER_WINDOW` | `120` | Health/models/diagnostics requests per IP per window. |

---

## Deployment (Vercel and other hosts)

### Vercel

```bash
npm i -g vercel
vercel link
vercel env add OPENROUTER_API_KEY production     # or AI_PROVIDERS + your own *_API_KEY(s)
# optional: AI_COLLABORATION=review, AI_IMAGE_MODEL, COMFYUI_BASE_URL, AI_DIAGNOSTICS_TOKEN
vercel --prod
```

Or set the same values in **Project → Settings → Environment Variables**, then deploy from the
dashboard. No `vercel.json` is required; the API routes use the Node runtime and `maxDuration` hints.

After deploying:

1. Open `/chat` → **Settings**. **Providers** should list each provider as *Connected* with a model
   count, and **Models & routing** should show non-zero chat / vision counts.
2. If it reads **Not configured**, the variables are missing from the *production* environment
   (they are per-environment), or the key was rejected — the message says which variable.
3. If a provider reads **Unreachable**, the server cannot reach that endpoint (see below).

### Any Node host (VPS, Docker, Railway, Fly, Render)

```bash
npm ci
npm run build
OPENROUTER_API_KEY=… npm start   # serves on :3000
```

Put it behind a reverse proxy with TLS. This is the easiest way to let the app reach an
OmniRoute instance on the same private network.

---

## The localhost problem, explained

`OMNIROUTE_BASE_URL=http://localhost:20128/v1` (or any provider URL on `localhost`) works **only** when that service runs on the same
machine as the server process — i.e. your laptop during `npm run dev`.

It cannot work on Vercel: `localhost` inside a serverless function is the function's own sandbox,
not your computer, and Vercel's functions cannot dial back into your machine. A public visitor's
browser cannot help either, because every gateway call is made server-side by design (that is what
keeps your key secret).

Options, in order of preference:

1. **Host OmniRoute on a reachable server** (VPS, home server with a domain, Docker on a cloud VM)
   and point its `baseUrl` at its HTTPS address. Restrict access at the network layer
   (firewall allowlist, VPN, or a reverse proxy that only forwards `/v1/*`).
2. **Run X AI next to that service** (same Docker network / same VPS). Then its `baseUrl` can be
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

## How routing works

`GET /api/models` returns every model the configured providers expose, each labelled with the
capabilities that provider published (OpenRouter's `architecture.input_modalities` /
`output_modalities`, OmniRoute's `capabilities` object, or your `AI_PROVIDERS` declaration).
Name-based heuristics are used only as ranking hints, never to claim a capability that the provider
did not publish.

Every chat request goes through `lib/server/ai/orchestrator.ts`:

1. **Classify.** The last user turn and the attachments produce a task kind (`simple`, `general`,
   `reasoning`, `coding`, `vision`, `document`, `web`, `image-gen`) plus hard requirements
   (e.g. "an image was attached ⇒ vision is required") and soft preferences.
2. **Filter.** Models that cannot satisfy the requirements are removed, as are models whose provider
   is unauthorised, models that recently failed (rejected an image, 404, quota), and pure image models.
3. **Score.** Preferences, operator priority, published price and latency class decide the order.
   The first model is the one that answers; the rest are fallbacks.
4. **Call, with fallback.** One model is called. If it fails, the failure is classified:

   | Upstream | Action |
   | --- | --- |
   | `401` / `403` / `402` | Provider blocked for this request, next provider. |
   | `404` | Model removed from rotation for 10 minutes, next model. |
   | `422` / "no image support" | Model marked non-vision, next model. |
   | `429` / `408` / `5xx` | One retry with backoff, then next model. |
   | `400` / `413` | **Stop.** The request itself is wrong; retrying would hide a bug. |

   Attempts are capped by `AI_MAX_CANDIDATES`; a `done` frame lists which models failed and why.
5. **Explain.** The `meta` frame carries the task kind, the routing reason, the candidate count, how
   many images/documents were sent, and whether a second opinion is running. The UI shows the model,
   the provider, a `fallback` chip when one was used, and an `image read` chip when an image was
   actually sent to a vision model.

### Multi-model review (optional)

With `AI_COLLABORATION=review`, requests that are analysis, coding or document tasks (and longer than
80 characters) also start a **peer model on a different provider in parallel** with the primary
answer, so nothing is slower. When both answers are in, a third call compares them and returns
structured JSON — agreement level, up to three concrete disagreements with the reasoning behind the
resolution, and a short optional addendum. That report is shown under the answer ("Second opinion")
and the primary answer is left untouched.

Limits and honesty: at most `AI_MAX_MODELS_PER_REQUEST` distinct models, only for task kinds where a
second model can help, skipped silently when no eligible second model exists, and any failure
(peer down, comparison timed out, unreadable JSON) is reported as `partial`/`skipped` with a reason —
never as a fabricated verdict.

Logging is metadata only: request id, route, task kind, model id, status class, duration, fallback
count. Prompt text, image bytes and keys are never logged.

---

## Image understanding and image generation

### Reading an attached image

- Attach one image (button, paste, or drag & drop anywhere in the window) and either type a question
  or just press send: with an empty message the server asks the model to describe what is visible.
- Images are only ever sent to models that declare vision support. If the selected model cannot read
  images the request is refused with an explanation instead of silently dropping the picture.
- The badge row under the answer shows `image read` when the image was actually sent.

The prompt-engineering analysis that used to sit behind a UI toggle is still available over the API
as `"mode": "image-to-prompt"` (ten-section analysis + one copyable prompt block). The web UI no
longer exposes a mode switch: you just ask for what you want.

### Attachments other than images

Images, PDFs, DOCX files and plain-text/code files can be attached (button, paste for images, or
drag & drop anywhere in the window). Documents are decoded **on the server**:

- text/code files are read as UTF-8;
- `.docx` is unzipped and its `word/document.xml` body is stripped to text;
- `.pdf` gets a best-effort text-layer extraction — a scanned PDF has no text layer, and the UI says
  so instead of pretending the file was read.

Extracted text is capped by `AI_MAX_DOCUMENT_CHARS`, marked in the prompt as data (not
instructions), and the answer's badge row shows how many documents were actually sent.

### Image generation

Three honest paths, in order:

1. **A discovered image model.** Any model whose provider metadata says it outputs images (e.g. an
   image model on OpenRouter/OpenAI) is used automatically — no extra configuration. The wire format
   is detected: `POST {base}/images/generations` first, and only if the provider answers `404`/`405`
   (that endpoint does not exist) does the server switch to the documented chat-modalities form
   (`POST /chat/completions` with `modalities: ["image","text"]`).
2. **`AI_IMAGE_MODEL`** pins a specific image model.
3. **ComfyUI** — `COMFYUI_BASE_URL` plus the built-in SD1.5 txt2img workflow (or your own
   `COMFYUI_WORKFLOW_JSON`). The server submits the graph, polls `/history`, then downloads the result
   from `/view`.

If none is available, `GET /api/generate-image` reports `configured: false`, the "Generate image"
button explains why it cannot run, and `POST` returns `501 image_backend_not_configured`. No
placeholder image is ever returned. Cost, GPU load and availability belong to whichever backend you
configure. Asking the chat for "an image of …" routes straight to the image model when one exists.

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
{
  "status": "connected",
  "latencyMs": 27,
  "modelCount": 12,
  "visionModelCount": 4,
  "imageModelCount": 2,
  "providerCount": 2,
  "providers": [{ "id": "alpha", "label": "Alpha", "status": "ok", "host": "provider.example", "modelCount": 7, "latencyMs": 27 }],
  "collaboration": true,
  "routerEnabled": true,
  "checkedAt": 1760000000000
}
```

`status` is `connected`, `degraded` (some provider is down), `not_configured` or `unavailable`.
Never includes a base URL with credentials or an API key — providers are reduced to host + counts.

### `GET /api/models?refresh=1`

```json
{
  "status": "connected",
  "models": [{ "id": "alpha::alpha/vision-1", "modelId": "alpha/vision-1", "label": "alpha vision-1", "providerLabel": "Alpha", "capabilities": ["vision","tools","json"], "kind": "chat", "vision": true, "contextLength": 200000 }],
  "providers": [{ "id": "alpha", "label": "Alpha", "status": "ok", "host": "provider.example", "modelCount": 7 }],
  "capabilities": { "vision": 4, "coding": 2, "reasoning": 6, "fast": 3, "tools": 12 },
  "visionModels": ["alpha::alpha/vision-1"],
  "imageModels": ["alpha::alpha/image-1"],
  "autoAvailable": true,
  "autoVisionAvailable": true,
  "collaborationEnabled": true,
  "issues": [],
  "fetchedAt": 1760000000000
}
```

Model ids are `provider::model`, so two providers exposing the same upstream id stay distinguishable.
Only safe public metadata is returned. Failures return `status: "not_configured"` / `"degraded"` with a
message and an empty list, so the UI degrades gracefully instead of showing a fake catalogue.

### `GET /api/diagnostics`

Explains the AI layer without exposing secrets: configuration source, limits, per-provider status
(including the **name** of the key variable and whether it is set), capability histogram, image
backend and configuration issues. Add `AI_DIAGNOSTICS_TOKEN` and pass `?token=…` to include the
per-model table (capabilities, their source, priority, price).

### `POST /api/chat`

```json
{
  "mode": "image-to-prompt",          // or "chat"
  "model": "auto",                    // or a "provider::model" id from /api/models
  "messages": [{ "role": "user", "content": "What is in this image?" }],
  "attachments": [
    { "name": "photo.jpg", "mime": "image/jpeg", "dataUrl": "data:image/jpeg;base64,…" },
    { "name": "brief.pdf", "mime": "application/pdf", "dataUrl": "data:application/pdf;base64,…" }
  ],
  "stream": true
}
```

`imageDataUrl` (single image) is still accepted as a shorthand for one attachment.

Responds with `text/event-stream`; each frame is one JSON object:

```
data: {"type":"meta","requestedModel":"auto","model":"alpha/vision-1","provider":"Alpha",
       "route":{"kind":"vision","reason":"auto-selected …","candidates":3,"images":1,"documents":0},
       "collaboration":{"enabled":false,"reason":"not useful for vision tasks"},
       "fallbackAttempts":0,"requestId":"…"}
data: {"type":"delta","text":"## Scene summary\n"}
data: {"type":"collab","stage":"done","verdict":"partial","peerModel":"beta/reason-1",
       "disputes":[{"topic":"…","primary":"…","peer":"…","resolution":"…"}],"addendum":"…"}
data: {"type":"image","images":[{"url":"data:image/png;base64,…"}],"model":"alpha/image-1"}
data: {"type":"done","model":"alpha/vision-1","provider":"Alpha","fallbackAttempts":0,
       "attempts":[{"model":"alpha/rate-limited-1","code":"rate_limited_upstream"}]}
data: {"type":"error","code":"model_no_vision","message":"…","retryable":false}
```

`collab` and `image` frames are optional. With `"stream": false` the route returns
`{ ok, text, model, provider, modelKey, requestedModel, fallbackAttempts, attempts, route }`.
Errors before streaming starts return `{ ok:false, code, message, retryable }` with an appropriate
status (`400`, `413`, `415`, `422`, `429`, `502`, `503`, `504`).

### `GET` / `POST /api/generate-image`

`GET` → `{ configured, backend, model?, models[], message, gatewayConfigured }`.
`POST` → `{ prompt, model?, size?, n? }` → `{ ok:true, backend, model, images:[{ url, mime }], tookMs }`,
or `501` when no backend is configured.
