"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, ImagePlus, Loader2, Square, X } from "lucide-react";

import type { PublicModel } from "@/lib/types";
import {
  acceptAttribute,
  MAX_DOCUMENT_BYTES,
  MAX_RAW_IMAGE_BYTES,
  type PendingAttachment,
} from "@/lib/client/files";

export type { PendingAttachment };

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  attachment: PendingAttachment | null;
  onAttach: (file: File) => void;
  onRemoveAttachment: () => void;
  model: string;
  models: PublicModel[];
  onModelChange: (model: string) => void;
  attachmentBusy?: boolean;
  /** Shown under the composer, e.g. "Analyzing image…". */
  hint?: string | null;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * The picker groups models by *what they are good at*, not by which company
 * hosts them, and each model appears exactly once (no duplicates).
 */
const ROLE_GROUPS: { key: string; label: string }[] = [
  { key: "vision", label: "قراءة الصور · Vision" },
  { key: "reasoning", label: "تحليل وتفكير · Analysis" },
  { key: "coding", label: "برمجة · Code" },
  { key: "fast", label: "سريع · Fast" },
  { key: "general", label: "عام · General" },
];

function roleOf(model: PublicModel): string {
  const caps = model.capabilities ?? [];
  if (model.vision || caps.includes("vision")) return "vision";
  if (caps.includes("coding")) return "coding";
  if (caps.includes("reasoning")) return "reasoning";
  if (caps.includes("fast")) return "fast";
  return "general";
}

function groupByRole(models: PublicModel[]): [string, PublicModel[]][] {
  const buckets = new Map<string, PublicModel[]>();
  const seen = new Set<string>();
  for (const model of models) {
    const key = roleOf(model);
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const list = buckets.get(key);
    if (list) list.push(model);
    else buckets.set(key, [model]);
  }
  return ROLE_GROUPS.filter((group) => (buckets.get(group.key)?.length ?? 0) > 0).map((group) => [
    group.label,
    buckets.get(group.key) ?? [],
  ]);
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  attachment,
  onAttach,
  onRemoveAttachment,
  model,
  models,
  onModelChange,
  attachmentBusy,
  hint,
  inputRef,
}: ComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalRef;
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Auto-grow the textarea up to a limit, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value, textareaRef]);

  // Never send while an attachment is still being prepared: the file would be
  // silently left out of the message.
  const canSend = !busy && !attachmentBusy && (value.trim().length > 0 || Boolean(attachment));

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          onAttach(file);
          return;
        }
      }
    }
  };

  return (
    <div className="w-full">
      {hint && (
        <p className="mb-2 px-1 text-xs text-ink-400" role="status" aria-live="polite">
          {hint}
        </p>
      )}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
            setDragActive(false);
            const file = Array.from(e.dataTransfer.files)[0];
            if (file) onAttach(file);
          }
        }}
        className={[
          "rounded-2xl border bg-midnight-900/95 shadow-panel",
          dragActive ? "border-electric-400/70 ring-2 ring-electric-500/25" : "border-white/12",
        ].join(" ")}
      >
        {attachment && (
          <div className="flex items-start gap-3 border-b border-white/10 p-3">
            {attachment.kind === "image" ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={attachment.dataUrl}
                alt={`Attached image preview: ${attachment.name}`}
                className="h-16 w-16 rounded-lg border border-white/10 object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-electric-400/30 bg-electric-500/10 text-cyan-100">
                <FileText size={22} aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink-100">{attachment.name}</p>
              <p className="mt-0.5 text-xs text-ink-400">
                {(attachment.bytes / 1024 / 1024).toFixed(2)} MB
                {attachment.kind === "image" && attachment.width && attachment.height
                  ? ` · ${attachment.width}×${attachment.height}`
                  : " · document"}
                {attachment.compressed ? " · optimised for upload" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onRemoveAttachment}
              className="rounded-lg p-1.5 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
              aria-label="Remove attachment"
            >
              <X size={15} />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2.5 pt-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-electric-400/40 bg-electric-500/10 px-2.5 py-1.5 text-[0.8rem] font-semibold text-cyan-100 transition hover:border-cyan-200/70 hover:bg-electric-500/20 hover:text-white neon-box"
              aria-label="Attach an image or document"
              disabled={attachmentBusy}
            >
              {attachmentBusy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              <span className="hidden sm:inline">Attach</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={acceptAttribute()}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAttach(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="x-ai-model-inline">
              Model
            </label>
            <select
              id="x-ai-model-inline"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="max-w-[12rem] truncate rounded-lg border border-white/15 bg-midnight-950/85 px-2.5 py-2 text-[0.8rem] font-medium text-ink-100 focus:border-electric-400/70 focus:outline-none"
            >
              <option value="auto">Auto — smart routing</option>
              {groupByRole(models).map(([roleLabel, list]) => (
                <optgroup key={roleLabel} label={roleLabel}>
                  {list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.vision ? " · vision" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
              {model !== "auto" && !models.some((m) => m.id === model) && (
                <option value={model}>{model} (not in current list)</option>
              )}
            </select>

            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/20 px-3.5 text-[0.8rem] font-semibold text-ink-100 transition hover:bg-white/10"
              >
                <Square size={12} aria-hidden /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-electric-400 to-electric-600 text-white shadow-[0_3px_0_#1236a3,0_8px_20px_-8px_rgba(37,99,235,0.95)] transition hover:from-electric-300 hover:to-electric-500 active:translate-y-[3px] active:shadow-[0_0_0_#1236a3,0_4px_10px_-6px_rgba(37,99,235,0.8)] disabled:cursor-not-allowed disabled:from-midnight-700 disabled:to-midnight-700 disabled:text-ink-500 disabled:shadow-none"
                aria-label="Send message"
              >
                <ArrowUp size={17} aria-hidden />
              </button>
            )}
          </div>
        </div>
        <label htmlFor="x-ai-composer" className="sr-only">
          Message X AI
        </label>
        <textarea
          id="x-ai-composer"
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            "Ask anything — or say “اعمل صورة …” and I will switch to the image generator myself"
          }
          className="max-h-[240px] w-full resize-none border-t border-white/[0.07] bg-transparent px-4 pb-2 pt-3.5 text-base leading-7 text-white placeholder:text-ink-400 focus:outline-none"
          rows={2}
        />
      </div>
      <p id="x-ai-composer-help" className="sr-only">
        Enter sends, Shift+Enter adds a line. Paste or drag an image, PDF, Word document or text file to attach it. Maximum
        upload size {Math.round(MAX_RAW_IMAGE_BYTES / 1024 / 1024)} megabytes per image and{" "}
        {Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} megabytes per document.</p>
    </div>
  );
}
