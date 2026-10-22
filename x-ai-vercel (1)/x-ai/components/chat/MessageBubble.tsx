"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  GitBranch,
  ImageIcon,
  RefreshCw,
  Sparkles,
  User,
  Users,
} from "lucide-react";

import { Markdown } from "@/components/Markdown";
import { XMark } from "@/components/brand/XMark";
import type { StoredMessage } from "@/lib/types";

function timeLabel(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export interface MessageBubbleProps {
  message: StoredMessage;
  /** Live text while streaming (assistant only). */
  streamingText?: string;
  streaming?: boolean;
  /** Human-readable activity label, e.g. "Analysing image…". */
  statusLabel?: string;
  attachmentUrl?: (id: string) => string | undefined;
  onRegenerate?: () => void;
  onGenerateImage?: () => void;
  canGenerateImage?: boolean;
  generatingImage?: boolean;
  children?: React.ReactNode;
}

export function MessageBubble({
  message,
  streamingText,
  streaming,
  statusLabel,
  attachmentUrl,
  onRegenerate,
  onGenerateImage,
  canGenerateImage,
  generatingImage,
  children,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const text = streaming ? (streamingText ?? "") : message.content;
  const attachments = (message.attachments ?? []).filter((a) => !a.generated);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={`flex w-full gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} animate-fade-up`}
      data-testid={`message-${message.role}`}
    >
      {/* Avatar */}
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-ink-300">
            <User size={15} aria-hidden />
            <span className="sr-only">You</span>
          </span>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-electric-500/30 bg-midnight-850">
            <XMark size={22} glow={false} title="X AI" />
          </span>
        )}
      </div>

      <div className={`flex min-w-0 max-w-[min(46rem,100%)] flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={[
            "w-full rounded-2xl border px-4 py-3.5 text-base leading-7",
            isUser
              ? "border-white/15 bg-white/[0.07] text-white"
              : "border-white/12 bg-midnight-900/70 text-ink-100",
            message.error ? "border-rose-400/30 bg-rose-500/[0.06]" : "",
          ].join(" ")}
        >
          {attachments.length > 0 && (
            <div className={`mb-2 flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
              {attachments.map((att) => {
                const url = attachmentUrl?.(att.id);
                if (att.document) {
                  return (
                    <span key={att.id} className="chip max-w-[16rem] truncate" title={att.name}>
                      <FileText size={12} aria-hidden /> {att.name}
                    </span>
                  );
                }
                return url ? (
                  <a
                    key={att.id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block overflow-hidden rounded-xl border border-white/12"
                    title={`Open ${att.name}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={att.name ? `Attached image: ${att.name}` : "Attached image"}
                      className="max-h-56 w-auto max-w-[16rem] object-cover transition group-hover:opacity-90"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <span
                    key={att.id}
                    className="chip max-w-[16rem] truncate"
                    title="Local preview unavailable — the stored image could not be loaded"
                  >
                    <ImageIcon size={12} aria-hidden /> {att.name}
                  </span>
                );
              })}
            </div>
          )}

          {streaming && !text && (
            <div className="flex items-center gap-2 text-sm text-ink-300" role="status" aria-live="polite">
              <span className="flex gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-electric-300" />
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-electric-300 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-cyan-accent [animation-delay:300ms]" />
              </span>
              {statusLabel ?? "Thinking…"}
            </div>
          )}

          {isUser ? (
            text && <p className="whitespace-pre-wrap break-words">{text}</p>
          ) : text ? (
            <>
              <Markdown content={text} />
              {streaming && (
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-caret bg-cyan-accent align-middle" aria-hidden />
              )}
            </>
          ) : null}

          {message.error && (
            <div className="mt-1 flex items-start gap-2 text-sm text-rose-200">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
              <span>{message.error.message}</span>
            </div>
          )}

          {message.collab && <CollabPanel collab={message.collab} />}

          {children}
        </div>

        {/* Meta row */}
        <div className={`mt-1.5 flex flex-wrap items-center gap-2 px-1 text-[0.75rem] font-medium text-ink-300 ${isUser ? "flex-row-reverse" : ""}`}>
          <span>{timeLabel(message.createdAt)}</span>
          {!isUser && (message.model || message.requestedModel) && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-electric-400/40 bg-electric-500/10 px-2 py-0.5 text-cyan-100"
              title={`Model that produced this answer: ${message.model ?? message.requestedModel}`}
            >
              <Sparkles size={10} className="text-cyan-accent" aria-hidden />
              {message.model ?? message.requestedModel}
            </span>
          )}
          {!isUser && message.provider && <span className="text-ink-400">via {message.provider}</span>}
          {!isUser && message.fallbackUsed && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-100"
              title="The first choice failed, so a fallback model answered"
            >
              <GitBranch size={10} aria-hidden /> fallback
            </span>
          )}
          {!isUser && message.visionUsed && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2 py-0.5 text-cyan-100"
              title="Your image was sent to a vision-capable model"
            >
              <Eye size={10} aria-hidden /> image read
            </span>
          )}
          {!isUser && Boolean(message.documentsUsed) && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-ink-200"
              title="Attached document text was included in the request"
            >
              <FileText size={10} aria-hidden /> {message.documentsUsed} doc
              {(message.documentsUsed ?? 0) === 1 ? "" : "s"}
            </span>
          )}
          {!isUser && message.requestedModel?.startsWith("auto") && message.model && (
            <span className="text-ink-500">(router picked it)</span>
          )}

          {!isUser && text && !streaming && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
                aria-label="Copy this answer"
              >
                {copied ? <Check size={11} className="text-cyan-accent" /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </button>
              {onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
                  aria-label="Regenerate this answer"
                >
                  <RefreshCw size={11} />
                  Regenerate
                </button>
              )}
            </span>
          )}

          {!isUser && text && !streaming && onGenerateImage && (
            <button
              type="button"
              onClick={onGenerateImage}
              disabled={generatingImage}
              className="inline-flex items-center gap-1 rounded-md border border-electric-500/30 px-2 py-0.5 text-electric-200 transition hover:border-electric-400/70 hover:bg-electric-500/10 disabled:opacity-60"
              title={
                canGenerateImage
                  ? "Generate an image from this answer's prompt"
                  : "No image backend is configured on this deployment"
              }
            >
              <ImageIcon size={11} />
              {generatingImage ? "Generating…" : "Generate image"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small image result card used for generated images. */
export function GeneratedImageCard({ url, label }: { url: string; label?: string }) {
  return (
    <div className="mt-3 inline-block max-w-full overflow-hidden rounded-xl border border-white/12 bg-midnight-950/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label ?? "Image generated by X AI"} className="max-h-[28rem] w-auto max-w-full object-contain" />
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-xs text-ink-400">{label ?? "Generated image"}</span>
        <a
          href={url}
          download={label ? `${label.replace(/[^\w.-]+/g, "-")}.png` : "x-ai-image.png"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1 text-xs text-ink-200 transition hover:border-electric-400/60 hover:text-white"
        >
          <Download size={12} aria-hidden />
          Download
        </a>
      </div>
    </div>
  );
}

const VERDICT_COPY: Record<string, { label: string; tone: string }> = {
  agree: { label: "both models agreed", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" },
  partial: { label: "minor differences", tone: "border-amber-400/40 bg-amber-400/10 text-amber-100" },
  conflict: { label: "models disagreed", tone: "border-rose-400/40 bg-rose-400/10 text-rose-100" },
  unknown: { label: "review unavailable", tone: "border-white/15 bg-white/[0.04] text-ink-200" },
};

/** Second-opinion report produced by the multi-model review pass. */
function CollabPanel({ collab }: { collab: NonNullable<StoredMessage["collab"]> }) {
  const verdict = VERDICT_COPY[collab.verdict] ?? VERDICT_COPY.unknown;
  const disputes = collab.disputes ?? [];
  if (!collab.summary && disputes.length === 0 && !collab.addendum) return null;
  return (
    <details className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[0.78rem] font-semibold text-ink-200">
        <Users size={11} aria-hidden />
        Second opinion
        <span className={`ml-1 rounded-full border px-1.5 py-0.5 text-[0.68rem] font-medium ${verdict.tone}`}>
          {verdict.label}
        </span>
      </summary>
      <div className="mt-1.5 space-y-1.5 text-[0.8rem] leading-6 text-ink-300">
        {collab.peerModel && (
          <p className="text-ink-500">
            Reviewed by {collab.peerModel}
            {collab.peerProvider ? ` via ${collab.peerProvider}` : ""}
          </p>
        )}
        {collab.summary && <p>{collab.summary}</p>}
        {disputes.map((dispute) => (
          <div key={dispute.topic} className="rounded-lg border border-white/10 px-2.5 py-1.5">
            <p className="font-semibold text-ink-200">{dispute.topic}</p>
            {dispute.primary && <p className="text-ink-400">A: {dispute.primary}</p>}
            {dispute.peer && <p className="text-ink-400">B: {dispute.peer}</p>}
            {dispute.resolution && <p className="text-ink-200">Resolved: {dispute.resolution}</p>}
          </div>
        ))}
        {collab.addendum && (
          <p className="rounded-lg border border-electric-400/25 bg-electric-500/[0.08] px-2.5 py-1.5 text-ink-100">
            {collab.addendum}
          </p>
        )}
      </div>
    </details>
  );
}
