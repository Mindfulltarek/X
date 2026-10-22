# Deploy X AI to Vercel — 5 steps

The app is a standard Next.js 15 project. Vercel builds it with `npm install` + `next build`;
nothing else is required.

## 1. Create the project

- Push this folder to a Git repo and import it in Vercel, **or** run `vercel` in this folder
  (`vercel link`, then `vercel --prod`).
- Framework preset is detected automatically (Next.js). Leave build settings at their defaults:
  Install `npm install`, Build `next build`, Output `.next`.

## 2. Add at least one provider key

Project → **Settings → Environment Variables** → add for **Production** (and Preview if you want):

| Name | Value | Example |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | an OpenRouter key (simplest option) | `sk-or-v1-…` |
| — or any preset — | `OPENAI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `XAI_API_KEY`, `CEREBRAS_API_KEY`, `NVIDIA_API_KEY` | |
| — or `AI_PROVIDERS` — | a JSON array describing your own providers/models. Keys stay in their own variables and are referenced with `apiKeyEnv`. | see README |
| — or legacy — | `OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY` (one gateway, still supported) | `https://omniroute.example.com/v1` |

Only **one** of these is required to get chat working. The server discovers each provider's model
catalogue, keeps the capability metadata, and routes requests to a model that can handle them.

> **Provider endpoints must be reachable from Vercel.** `http://localhost:20128/v1` will NOT work in
> production: inside a serverless function `localhost` is the function itself, not your computer.
> Host the gateway/provider on a public or privately-routed server, or deploy this app on the same
> machine as the gateway. Never expose an unauthenticated gateway to the internet. See README →
> "The localhost problem, explained".

> **Changing configuration requires a redeploy.** Environment variables are read at boot; Vercel will
> prompt you to redeploy after you edit them. Cached model catalogues live in memory only.

## 3. Optional variables

| Name | Purpose |
| --- | --- |
| `AI_PROVIDERS` | full provider/model/priority control (JSON) |
| `AI_COLLABORATION=review` | second-opinion pass by a different model on a different provider |
| `AI_MAX_CANDIDATES`, `AI_MAX_MODELS_PER_REQUEST` | routing caps (defaults 4 / 3) |
| `AI_IMAGE_MODEL` | pin the image-generation model |
| `AI_DISABLE_PRESETS=1` | ignore the preset `*_API_KEY` variables |
| `AI_SYSTEM_SUFFIX` | extra instruction appended to every system prompt |
| `AI_REQUEST_TIMEOUT_MS`, `AI_STREAM_TIMEOUT_MS`, `AI_DISCOVERY_TIMEOUT_MS` | timeouts (60 s / 120 s / 12 s) |
| `AI_MAX_FILE_BYTES`, `AI_MAX_DOCUMENT_CHARS` | attachment limits (12 MB / 60 000 chars) |
| `AI_DIAGNOSTICS_TOKEN` | enables the detailed section of `/api/diagnostics` |
| `COMFYUI_BASE_URL` + `IMAGE_BACKEND=comfyui` | image generation via a self-hosted ComfyUI |
| `RATE_LIMIT_*` | rate limits |

Full list with defaults: `.env.example` and README → "Environment variables".

## 4. Deploy, then verify

1. Open the deployment → **/chat** → **Settings**.
2. Press **Test**. Every provider should read *Connected* with a model count, and **Models & routing**
   should show non-zero chat and vision counts.
   - *Not configured* → the variable is missing from that environment (or `AI_PROVIDERS` is invalid JSON).
   - *Key rejected* → the provider refused the key; the message names the variable to fix.
   - *Unreachable* → Vercel cannot reach that endpoint (firewall, TLS, wrong host).
3. Send a message, attach an image in **Image → Prompt** mode, and try a long analysis question to
   see the routing reason and (if enabled) the second-opinion panel.
4. `curl https://your-site/api/health` and `curl https://your-site/api/models` for a quick check;
   `/api/diagnostics` explains how providers and models were resolved (no secrets are returned).

## 5. Things worth knowing

- API keys are read only on the server. There is no `NEXT_PUBLIC_` variable in this project, and no
  key ever reaches the browser.
- The built-in rate limiter is per-instance and best-effort. For a public site add Vercel Firewall /
  Cloudflare / nginx limits.
- Chats are stored in each visitor's browser (IndexedDB); nothing is stored on the server.
- Function timeouts: streaming chat may need more than the Hobby default. `app/api/chat/route.ts`
  declares `maxDuration = 120`; adjust to your plan's limit if Vercel warns about it.
- The second-opinion pass adds one or two extra provider calls per enabled request. Bounded by
  `AI_MAX_MODELS_PER_REQUEST` (default 3) and skipped automatically when no second model is eligible.
