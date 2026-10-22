#!/usr/bin/env node
/**
 * Check which AI providers a deployed X AI instance can actually reach.
 *
 *   node tools/check-providers.mjs https://your-site.vercel.app
 *   node tools/check-providers.mjs http://localhost:3000
 *
 * It reads only the public endpoints (`/api/health`, `/api/models`,
 * `/api/diagnostics`) — the same ones a browser hits. No key is sent, no key is
 * printed, and nothing is changed on the server.
 *
 * Exit codes: 0 = at least one provider healthy and routing usable,
 *             1 = something is wrong (details printed), 2 = bad usage.
 */

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!base || !/^https?:\/\//i.test(base)) {
  console.error("Usage: node tools/check-providers.mjs https://your-site.example");
  process.exit(2);
}

const C = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};
const say = (msg = "") => console.log(msg);

async function get(path) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: (err?.message ?? "network error").slice(0, 120) };
  }
  const ms = Date.now() - started;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, ms, body };
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

const problems = [];
const notes = [];

say(`${C.bold}X AI provider check${C.reset} ${C.dim}→ ${base}${C.reset}\n`);

/* ------------------------------- endpoints ------------------------------- */

const health = await get("/api/health");
const models = await get("/api/models");
const diag = await get("/api/diagnostics");

const line = (name, res, summary) => {
  const state = res.status === 0 ? `${C.red}unreachable${C.reset}` : `${C.green}HTTP ${res.status}${C.reset}`;
  say(`  ${pad(name, 20)} ${state}  ${C.dim}${res.ms} ms${C.reset}  ${summary ?? ""}`);
};

line("GET /api/health", health, health.body?.status ? `status: ${health.body.status}` : "");
line("GET /api/models", models, models.body?.status ? `status: ${models.body.status}` : "");
line("GET /api/diagnostics", diag, diag.body?.ready !== undefined ? `ready: ${diag.body.ready}` : "");

if (health.status === 0 && models.status === 0) {
  say(`\n${C.red}The server did not answer at all.${C.reset} Check the URL, or whether the deployment built successfully.`);
  process.exit(1);
}

/* --------------------------- old build detection -------------------------- */

const modelBody = models.body ?? {};
const isNewBuild = Array.isArray(modelBody.providers) && typeof modelBody.capabilities === "object";
if (!isNewBuild) {
  say(
    `\n${C.yellow}This deployment is running the OLD build.${C.reset} The response has no "providers" / "capabilities" fields,\n` +
      `so per-provider status cannot be checked — and image uploads will keep failing (vision models are not detected).\n\n` +
      `Fix: upload/deploy the new build first, then set the keys, then redeploy.`,
  );
  say(`\n  models: ${modelBody.models?.length ?? "?"} · vision: ${modelBody.visionModels?.length ?? "?"} · image: ${modelBody.imageModels?.length ?? "?"}`);
  process.exit(1);
}

/* ------------------------------- providers ------------------------------- */

const providers = modelBody.providers ?? [];
const allModels = Array.isArray(modelBody.models) ? modelBody.models : [];

say(`\n${C.bold}PROVIDERS${C.reset}${C.dim}  (config source: ${diag.body?.configSource ?? "?"})${C.reset}`);
if (providers.length === 0) {
  say(`  ${C.red}none configured${C.reset}`);
  problems.push(
    diag.body?.issues?.[0]?.message ??
      health.body?.message ??
      "No provider is configured: set AI_PROVIDERS or a provider key, then redeploy.",
  );
} else {
  const rows = providers.map((provider) => {
    const owned = allModels.filter((model) => model.provider === provider.id);
    const vision = owned.filter((model) => (model.capabilities ?? []).includes("vision") || model.vision).length;
    const images = (modelBody.imageModels ?? []).filter((key) => String(key).startsWith(`${provider.id}::`)).length;
    return {
      id: provider.id,
      label: provider.label ?? provider.id,
      status: provider.status,
      models: owned.length || provider.modelCount || 0,
      vision,
      images,
      latency: provider.latencyMs,
      host: provider.host,
      message: provider.message,
      hasKey: diag.body?.providers?.find((entry) => entry.id === provider.id)?.hasKey,
      keyEnv: diag.body?.providers?.find((entry) => entry.id === provider.id)?.apiKeyEnv,
    };
  });

  const header = `  ${pad("provider", 22)}${pad("status", 16)}${pad("chat", 8)}${pad("vision", 8)}${pad("images", 8)}${pad("latency", 9)}host`;
  say(`${C.dim}${header}${C.reset}`);
  for (const row of rows) {
    const colour =
      row.status === "ok" ? C.green : row.status === "unauthorized" || row.status === "forbidden" ? C.red : C.yellow;
    say(
      `  ${pad(row.label, 22)}${colour}${pad(row.status, 16)}${C.reset}${pad(row.models, 8)}${pad(row.vision, 8)}${pad(
        row.images,
        8,
      )}${pad(row.latency !== undefined ? `${row.latency}ms` : "—", 9)}${C.dim}${row.host ?? ""}${C.reset}`,
    );
    if (row.status !== "ok") {
      problems.push(
        `${row.label}: ${row.message ?? row.status}` +
          (row.keyEnv ? ` (variable: ${row.keyEnv}${row.hasKey ? "" : " — not set"})` : ""),
      );
    } else if (row.models === 0) {
      problems.push(`${row.label}: connected but returned no models — check the key's model access.`);
    }
  }
}

/* ------------------------------ capabilities ----------------------------- */

const caps = modelBody.capabilities ?? {};
const visionModels = modelBody.visionModels ?? [];
const imageModels = modelBody.imageModels ?? [];

say(`\n${C.bold}ROUTING${C.reset}`);
say(`  chat models        ${modelBody.models?.length ?? 0}`);
say(`  vision models      ${visionModels.length}${visionModels.length === 0 ? `  ${C.yellow}(images cannot be read)${C.reset}` : ""}`);
say(`  image output       ${imageModels.length}${imageModels.length === 0 ? `  ${C.dim}(image generation unavailable)${C.reset}` : ""}`);
if (Object.keys(caps).length > 0) {
  say(`  capabilities       ${Object.entries(caps).map(([key, value]) => `${key}:${value}`).join("  ")}`);
}
say(`  auto routing       ${modelBody.autoAvailable ? "available" : "unavailable"}`);
say(`  second opinion     ${modelBody.collaborationEnabled ? "enabled" : `off ${C.dim}(AI_COLLABORATION=review to enable)${C.reset}`}`);
say(`  image backend      ${diag.body?.images?.configured ? `${diag.body.images.model ?? diag.body.images.backend}` : `not configured ${C.dim}(needs an image model or ComfyUI)${C.reset}`}`);

if (visionModels.length === 0) {
  problems.push(
    "No vision-capable model was found, so attaching an image will return 422. Add a vision model (or declare \"capabilities\": [\"vision\"] for it in AI_PROVIDERS).",
  );
}

/* -------------------------------- summary -------------------------------- */

const okProviders = providers.filter((provider) => provider.status === "ok").length;
const issues = (modelBody.issues ?? []).concat(diag.body?.issues ?? []);
const uniqueIssues = [...new Set(issues.map((issue) => (typeof issue === "string" ? issue : issue?.message)).filter(Boolean))];

say(`\n${C.bold}RESULT${C.reset}`);
say(`  ${okProviders}/${providers.length} provider(s) connected · ${modelBody.models?.length ?? 0} chat models · ${visionModels.length} vision · ${imageModels.length} image`);

if (uniqueIssues.length > 0) {
  say(`\n${C.yellow}Configuration notes${C.reset}`);
  for (const issue of uniqueIssues.slice(0, 8)) say(`  • ${issue}`);
}

if (problems.length === 0) {
  say(`\n${C.green}✓ Everything needed for chat, vision and routing is working.${C.reset}`);
  say(`${C.dim}  Next: open /chat → Settings → Providers, send a message, then attach an image to see the "image read" chip.${C.reset}`);
  process.exit(0);
}

say(`\n${C.red}✗ Problems found${C.reset}`);
for (const problem of problems) say(`  • ${problem}`);
say(`\n${C.dim}Full detail (no secrets): ${base}/api/diagnostics${C.reset}`);
say(`${C.dim}Environment variables are read at boot — after changing them you must redeploy.${C.reset}`);
process.exit(1);
