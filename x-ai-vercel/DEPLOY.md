# Deploy X AI to Vercel — 5 steps

The app is a standard Next.js 15 project. Vercel builds it with `npm install` + `next build`;
nothing else is required.

## 1. Create the project

- Push this folder to a Git repo and import it in Vercel, **or** run `vercel` in this folder
  (`vercel link`, then `vercel --prod`).
- Framework preset is detected automatically (Next.js). Leave build settings at their defaults:
  Install `npm install`, Build `next build`, Output `.next`.

## 2. Add the two required environment variables

Project → **Settings → Environment Variables** → add for **Production** (and Preview if you want):

| Name | Value | Example |
| --- | --- | --- |
| `OMNIROUTE_BASE_URL` | URL of your gateway's `/v1` mount | `https://omniroute.example.com/v1` |
| `OMNIROUTE_API_KEY` | key created in OmniRoute → Dashboard → Endpoints | `sk-…` |

> **The gateway must be reachable from Vercel.** `http://localhost:20128/v1` will NOT work in
> production: inside a serverless function `localhost` is the function itself, not your computer.
> Host OmniRoute on a public/private server, or deploy this app on the same machine/VPS as
> OmniRoute. Never expose an unauthenticated OmniRoute to the internet. See README →
> "The localhost problem, explained".

## 3. Optional variables

| Name | Purpose |
| --- | --- |
| `OMNIROUTE_FALLBACK_MODELS` | comma-separated model ids tried after the selected one (retryable errors only) |
| `OMNIROUTE_VISION_MODEL` | vision model used when an image is sent to a text-only model |
| `OMNIROUTE_IMAGE_MODEL` + `IMAGE_BACKEND=omniroute` | enable image generation via an OmniRoute image model |
| `COMFYUI_BASE_URL` + `IMAGE_BACKEND=comfyui` | enable image generation via ComfyUI |
| `OMNIROUTE_TIMEOUT_MS`, `OMNIROUTE_STREAM_TIMEOUT_MS` | timeouts (default 60 s / 120 s) |
| `MAX_IMAGE_BYTES`, `RATE_LIMIT_*` | upload cap and rate limits |

Full list with defaults: `.env.example` and README → "Environment variables".

## 4. Deploy, then verify

1. Open the deployment → **/chat** → **Settings**.
2. Press **Test connection**. It should read **Connected** and show a model count.
   - *Not configured* → the variables are missing from that environment.
   - *Temporarily unavailable* → Vercel cannot reach the gateway URL (firewall, TLS, wrong host).
3. Send a message, then attach an image in **Image → Prompt** mode.

## 5. Things worth knowing

- API keys are read only on the server. There is no `NEXT_PUBLIC_` variable in this project, and no
  key ever reaches the browser.
- The built-in rate limiter is per-instance and best-effort. For a public site add Vercel Firewall /
  Cloudflare / nginx limits.
- Chats are stored in each visitor's browser (IndexedDB); nothing is stored on the server.
- Function timeouts: streaming chat may need more than the Hobby default. `app/api/chat/route.ts`
  declares `maxDuration = 120`; adjust to your plan's limit if Vercel warns about it.
