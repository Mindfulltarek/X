"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleSlash,
  Database,
  ImageIcon,
  Loader2,
  RefreshCw,
  ServerCrash,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import type { HealthResponse, ModelsResponse, PublicProviderStatus } from "@/lib/types";
import type { ImageBackendStatus, MediaBackendInfo } from "@/lib/client/api";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  health: HealthResponse | null;
  healthLoading: boolean;
  onTestConnection: () => void;
  models: ModelsResponse | null;
  modelsLoading: boolean;
  onRefreshModels: () => void;
  imageBackend: ImageBackendStatus | null;
  onClearHistory: () => void;
  storageWarning: string | null;
  localUsage?: { usage?: number; quota?: number };
}

function StatusRow({
  state,
  title,
  detail,
}: {
  state: "ok" | "warn" | "off" | "loading";
  title: string;
  detail: string;
}) {
  const icon =
    state === "ok" ? (
      <CheckCircle2 size={15} className="text-emerald-400" aria-hidden />
    ) : state === "warn" ? (
      <TriangleAlert size={15} className="text-amber-300" aria-hidden />
    ) : state === "loading" ? (
      <Loader2 size={15} className="animate-spin text-ink-300" aria-hidden />
    ) : (
      <CircleSlash size={15} className="text-ink-500" aria-hidden />
    );
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.95rem] font-semibold text-ink-100">{title}</p>
        <p className="mt-0.5 text-[0.82rem] leading-6 text-ink-300">{detail}</p>
      </div>
    </div>
  );
}

const PROVIDER_STATE: Record<
  PublicProviderStatus["status"],
  { state: "ok" | "warn" | "off"; label: string }
> = {
  ok: { state: "ok", label: "Connected" },
  unauthorized: { state: "warn", label: "Key rejected" },
  forbidden: { state: "warn", label: "Access denied" },
  unavailable: { state: "warn", label: "Unreachable" },
  not_configured: { state: "off", label: "No API key" },
};

function ProviderRow({ provider }: { provider: PublicProviderStatus }) {
  const state = PROVIDER_STATE[provider.status];
  const dot =
    state.state === "ok"
      ? "bg-emerald-400"
      : state.state === "warn"
        ? "bg-amber-300"
        : "bg-ink-500";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-[0.9rem] font-semibold text-ink-100">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span className="truncate">{provider.label}</span>
        </p>
        <span className="shrink-0 text-[0.72rem] uppercase tracking-wide text-ink-400">{state.label}</span>
      </div>
      <p className="mt-1 text-[0.78rem] leading-5 text-ink-400">
        {provider.host} · {provider.modelCount} model{provider.modelCount === 1 ? "" : "s"}
        {typeof provider.latencyMs === "number" ? ` · ${provider.latencyMs} ms` : ""}
        {provider.catalogFromProvider ? "" : " · config only"}
        {provider.imageGeneration ? " · images" : ""}
      </p>
      {provider.message && provider.status !== "ok" && (
        <p className="mt-1 text-[0.78rem] leading-5 text-amber-200/90">{provider.message}</p>
      )}
    </div>
  );
}

function CapabilityStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <p className="text-[0.68rem] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink-100">{value}</p>
    </div>
  );
}

/** Per-service image status: which key is present, which model is used. */
function MediaProviders({ list }: { list?: MediaBackendInfo[] }) {
  if (!list || list.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {list.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2 text-[0.78rem] leading-5"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold text-ink-100">{entry.label}</span>
            <span
              className={
                entry.configured
                  ? "shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[0.68rem] font-semibold text-emerald-300"
                  : "shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[0.68rem] font-semibold text-ink-400"
              }
            >
              {entry.configured ? "ready" : "no key"}
            </span>
          </span>
          <span className="mt-0.5 block text-ink-400">{entry.message}</span>
          {entry.imageModel && (
            <span className="mt-0.5 block font-mono text-[0.7rem] text-ink-500">model: {entry.imageModel}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SettingsDialog({
  open,
  onClose,
  health,
  healthLoading,
  onTestConnection,
  models,
  modelsLoading,
  onRefreshModels,
  imageBackend,
  onClearHistory,
  storageWarning,
  localUsage,
}: SettingsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const providers: PublicProviderStatus[] = models?.providers ?? health?.providers ?? [];
  const connectedProviders = providers.filter((provider) => provider.status === "ok").length;
  const gatewayState: "ok" | "warn" | "off" | "loading" = healthLoading
    ? "loading"
    : health?.status === "connected"
      ? "ok"
      : health?.status === "degraded"
        ? "warn"
        : health?.status === "unavailable"
          ? "warn"
          : "off";

  const gatewayDetail = healthLoading
    ? "Contacting the configured providers…"
    : health?.status === "connected" || health?.status === "degraded"
      ? `${connectedProviders} of ${providers.length} provider${providers.length === 1 ? "" : "s"} responding${
          typeof health.latencyMs === "number" ? ` (slowest ${health.latencyMs} ms)` : ""
        }. ${typeof health.modelCount === "number" ? `${health.modelCount} chat models` : ""}${
          typeof health.visionModelCount === "number" ? `, ${health.visionModelCount} with vision` : ""
        }${typeof health.imageModelCount === "number" ? `, ${health.imageModelCount} image models` : ""}.`
      : (health?.message ?? "Run a connection test to check the providers.");

  const capabilityEntries = Object.entries(models?.capabilities ?? {})
    .filter(([key]) => ["vision", "coding", "reasoning", "fast", "web", "tools"].includes(key))
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto p-4 py-10">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative w-full max-w-2xl rounded-2xl border border-white/12 bg-midnight-900/95 shadow-panel animate-fade-up"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="settings-title" className="text-base font-semibold text-ink-100">
              Settings
            </h2>
            <p className="mt-0.5 text-[0.82rem] text-ink-300">
              Provider status and local data. API keys are configured only in the server environment.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
            aria-label="Close settings"
            ref={closeRef}
          >
            <X size={17} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section aria-labelledby="settings-providers">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="settings-providers" className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
                Providers
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onRefreshModels}
                  disabled={modelsLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1.5 text-xs text-ink-200 transition hover:border-electric-400/60 hover:text-white disabled:opacity-60"
                >
                  <RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />
                  Refresh models
                </button>
                <button
                  type="button"
                  onClick={onTestConnection}
                  disabled={healthLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1.5 text-xs text-ink-200 transition hover:border-electric-400/60 hover:text-white disabled:opacity-60"
                >
                  {healthLoading ? <Loader2 size={12} className="animate-spin" /> : <ServerCrash size={12} />}
                  Test
                </button>
              </div>
            </div>

            <StatusRow
              state={gatewayState}
              title={
                health?.status === "connected"
                  ? "All providers responding"
                  : health?.status === "degraded"
                    ? "Running with reduced providers"
                    : health?.status === "unavailable"
                      ? "Temporarily unavailable"
                      : health?.status === "not_configured"
                        ? "Not configured"
                        : "Unknown"
              }
              detail={gatewayDetail}
            />

            {providers.length > 0 && (
              <div className="mt-2 grid gap-2">
                {providers.map((provider) => (
                  <ProviderRow key={provider.id} provider={provider} />
                ))}
              </div>
            )}

            {health?.status === "not_configured" && (
              <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[0.82rem] leading-6 text-ink-300">
                This deployment has no AI provider yet. The site owner must set
                <code className="mx-1 rounded bg-white/10 px-1 py-0.5 font-mono text-[0.7rem]">AI_PROVIDERS</code>
                (JSON) or a provider key such as
                <code className="mx-1 rounded bg-white/10 px-1 py-0.5 font-mono text-[0.7rem]">OPENROUTER_API_KEY</code>
                in the host environment, then redeploy. See the README for the exact variables.
              </p>
            )}

            {(models?.issues ?? []).length > 0 && (
              <ul className="mt-2 space-y-1 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[0.8rem] leading-5 text-amber-100">
                {(models?.issues ?? []).slice(0, 4).map((issue) => (
                  <li key={issue} className="flex gap-1.5">
                    <TriangleAlert size={12} className="mt-1 shrink-0" aria-hidden />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="settings-models">
            <h3 id="settings-models" className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
              Models &amp; routing
            </h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <CapabilityStat label="Chat models" value={models ? models.models.length : "—"} />
              <CapabilityStat label="Vision models" value={models ? models.visionModels.length : "—"} />
              <CapabilityStat label="Image models" value={models ? models.imageModels.length : "—"} />
            </div>
            {capabilityEntries.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {capabilityEntries.map(([capability, count]) => (
                  <span key={capability} className="chip">
                    {capability} · {count}
                  </span>
                ))}
              </div>
            )}
            {models?.hygiene && models.hygiene.duplicatesRemoved + models.hygiene.deadRemoved > 0 && (
              <p className="mt-2 text-xs leading-5 text-ink-500">
                Catalogue cleaned: {models.hygiene.duplicatesRemoved} duplicate row
                {models.hygiene.duplicatesRemoved === 1 ? "" : "s"} and {models.hygiene.deadRemoved} unusable
                entr{models.hygiene.deadRemoved === 1 ? "y" : "ies"} removed, so the picker only lists models that
                can actually answer.
              </p>
            )}
            <p className="mt-2 text-xs leading-5 text-ink-500">
              Auto routing is {models?.autoAvailable ? "available" : "unavailable"}. It classifies each request
              (quick question, analysis, coding, image, document) and picks one model that can serve it, with
              fallbacks only if that model fails. Multi-model review is{" "}
              {models?.collaborationEnabled ? "enabled" : "off"}.
            </p>
          </section>

          <section aria-labelledby="settings-images">
            <h3 id="settings-images" className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
              Image generation
            </h3>
            <StatusRow
              state={imageBackend?.configured ? "ok" : "off"}
              title={
                imageBackend?.configured
                  ? `Configured (${imageBackend.backend}${imageBackend.model ? ` · ${imageBackend.model}` : ""})`
                  : "Not configured"
              }
              detail={imageBackend?.message ?? "Image generation is optional and depends on the providers you connected."}
            />
            <MediaProviders list={imageBackend?.providers} />
          </section>

          <section aria-labelledby="settings-storage">
            <h3 id="settings-storage" className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
              Local data
            </h3>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
              <p className="flex items-center gap-2 text-sm text-ink-100">
                <Database size={14} className="text-electric-300" aria-hidden />
                Chats are stored in this browser only
              </p>
              <p className="mt-1 text-[0.82rem] leading-6 text-ink-300">
                IndexedDB on this device holds your conversations and attached files. They are not synced across
                devices and disappear if you clear browser data.
                {localUsage?.usage ? ` Currently using about ${(localUsage.usage / 1024 / 1024).toFixed(1)} MB.` : ""}
              </p>
              {storageWarning && (
                <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-200">
                  {storageWarning}
                </p>
              )}
              <button
                type="button"
                onClick={onClearHistory}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 px-2.5 py-1.5 text-xs text-rose-200 transition hover:bg-rose-500/10"
              >
                <Trash2 size={12} />
                Clear local chats
              </button>
            </div>
          </section>

          <section aria-labelledby="settings-notes" className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
            <h3 id="settings-notes" className="flex items-center gap-2 text-sm text-ink-100">
              <ShieldCheck size={14} className="text-cyan-accent" aria-hidden />
              Honest limits
            </h3>
            <ul className="mt-1.5 space-y-1 text-[0.82rem] leading-6 text-ink-300">
              <li className="flex gap-1.5">
                <ImageIcon size={12} className="mt-1 shrink-0" aria-hidden />
                Answers come from whichever providers the site owner configured, subject to their quotas, pricing and
                model capabilities. X AI does not provide inference itself and does not promise unlimited or free use.
              </li>
              <li className="flex gap-1.5">
                <ShieldCheck size={12} className="mt-1 shrink-0" aria-hidden />
                API keys never reach the browser. Every provider call is made by the server, and images are only sent to
                models that declare vision support.
              </li>
            </ul>
            <div className="mt-2 flex flex-wrap gap-3 text-[0.82rem] text-ink-300">
              <Link href="/privacy" className="hover:text-ink-100">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-ink-100">
                Terms of Use
              </Link>
              <Link href="/ai-usage" className="hover:text-ink-100">
                AI Provider &amp; Usage
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
