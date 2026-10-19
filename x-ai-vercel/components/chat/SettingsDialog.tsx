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

import type { HealthResponse, ModelsResponse } from "@/lib/types";
import type { ImageBackendStatus } from "@/lib/client/api";

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

  const gatewayState: "ok" | "warn" | "off" | "loading" = healthLoading
    ? "loading"
    : health?.status === "connected"
      ? "ok"
      : health?.status === "unavailable"
        ? "warn"
        : "off";

  const gatewayDetail = healthLoading
    ? "Contacting the gateway…"
    : health?.status === "connected"
      ? `Reachable in ${health.latencyMs ?? "?"} ms. ${
          typeof health.modelCount === "number" ? `${health.modelCount} models visible to the configured key.` : ""
        } ${health.gatewayVersion ? `Gateway version ${health.gatewayVersion}.` : ""}`.trim()
      : (health?.message ?? "Run a connection test to check the gateway.");

  const visionCount = models?.visionModels.length ?? 0;

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
              Connection status and local data. Gateway credentials are configured only in the server environment.
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
          <section aria-labelledby="settings-gateway">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="settings-gateway" className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
                Gateway connection
              </h3>
              <button
                type="button"
                onClick={onTestConnection}
                disabled={healthLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1.5 text-xs text-ink-200 transition hover:border-electric-400/60 hover:text-white disabled:opacity-60"
              >
                {healthLoading ? <Loader2 size={12} className="animate-spin" /> : <ServerCrash size={12} />}
                Test connection
              </button>
            </div>
            <StatusRow
              state={gatewayState}
              title={
                health?.status === "connected"
                  ? "Connected"
                  : health?.status === "unavailable"
                    ? "Temporarily unavailable"
                    : health?.status === "not_configured"
                      ? "Not configured"
                      : "Unknown"
              }
              detail={gatewayDetail}
            />
            {health?.status === "not_configured" && (
              <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[0.82rem] leading-6 text-ink-300">
                This deployment has no OmniRoute gateway attached yet. The site owner must set
                <code className="mx-1 rounded bg-white/10 px-1 py-0.5 font-mono text-[0.7rem]">OMNIROUTE_BASE_URL</code>
                and
                <code className="mx-1 rounded bg-white/10 px-1 py-0.5 font-mono text-[0.7rem]">OMNIROUTE_API_KEY</code>
                in the server environment. See the README for setup and the Vercel limitation about <code>localhost</code>.
              </p>
            )}
          </section>

          <section aria-labelledby="settings-models">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="settings-models" className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
                Models
              </h3>
              <button
                type="button"
                onClick={onRefreshModels}
                disabled={modelsLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1.5 text-xs text-ink-200 transition hover:border-electric-400/60 hover:text-white disabled:opacity-60"
              >
                <RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />
                Refresh list
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <p className="text-[0.68rem] uppercase tracking-wide text-ink-500">Chat models</p>
                <p className="mt-1 text-lg font-semibold text-ink-100">{models?.models.length ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <p className="text-[0.68rem] uppercase tracking-wide text-ink-500">Vision models</p>
                <p className="mt-1 text-lg font-semibold text-ink-100">{models ? visionCount : "—"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <p className="text-[0.68rem] uppercase tracking-wide text-ink-500">Image models</p>
                <p className="mt-1 text-lg font-semibold text-ink-100">{models ? models.imageModels.length : "—"}</p>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-500">
              Auto routing ({models?.autoAvailable ? "available" : "not reported"}) lets OmniRoute choose among the
              provider connections you configured. Vision requests sent with Auto use OmniRoute&apos;s documented{" "}
              <code className="rounded bg-white/10 px-1 font-mono text-[0.7rem]">auto/vision</code> route.
            </p>
            {models?.message && <p className="mt-1 text-xs leading-5 text-amber-200/90">{models.message}</p>}
          </section>

          <section aria-labelledby="settings-images">
            <h3 id="settings-images" className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink-300">
              Image generation
            </h3>
            <StatusRow
              state={imageBackend?.configured ? "ok" : "off"}
              title={
                imageBackend?.configured
                  ? `Configured (${imageBackend.backend})`
                  : "Not configured"
              }
              detail={imageBackend?.message ?? "Image generation is optional and depends on the deployed backend."}
            />
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
                IndexedDB on this device holds your conversations and attached images. They are not synced across
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
                Usage depends on the providers connected to the gateway, their quotas and model capabilities. X AI
                does not provide inference itself and does not promise unlimited or free use.
              </li>
              <li className="flex gap-1.5">
                <ShieldCheck size={12} className="mt-1 shrink-0" aria-hidden />
                API keys never reach the browser. All provider calls are made by the server.
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
