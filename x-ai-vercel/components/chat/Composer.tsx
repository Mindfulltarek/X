"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Square, X } from "lucide-react";

import type { OperationMode, PublicModel } from "@/lib/types";
import { ACCEPTED_IMAGE_TYPES, MAX_RAW_IMAGE_BYTES } from "@/lib/client/image";

export interface PendingAttachment {
  dataUrl: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  compressed: boolean;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  attachment: PendingAttachment | null;
  onAttach: (file: File) => void;
  onRemoveAttachment: () => void;
  mode: OperationMode;
  onModeChange: (mode: OperationMode) => void;
  model: string;
  models: PublicModel[];
  onModelChange: (model: string) => void;
  attachmentBusy?: boolean;
  /** Shown under the composer, e.g. "Analyzing image…". */
  hint?: string | null;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
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
  mode,
  onModeChange,
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

  const canSend = !busy && (value.trim().length > 0 || Boolean(attachment));

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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.dataUrl}
              alt={`Attached image preview: ${attachment.name}`}
              className="h-16 w-16 rounded-lg border border-white/10 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink-100">{attachment.name}</p>
              <p className="mt-0.5 text-xs text-ink-400">
                {(attachment.bytes / 1024 / 1024).toFixed(2)} MB · {attachment.width}×{attachment.height}
                {attachment.compressed ? " · optimised for upload" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onRemoveAttachment}
              className="rounded-lg p-1.5 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
              aria-label="Remove attached image"
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
              aria-label="Attach an image"
              disabled={attachmentBusy}
            >
              {attachmentBusy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              <span className="hidden sm:inline">Attach</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAttach(file);
                e.target.value = "";
              }}
            />
            <div
              className="flex items-center gap-1 rounded-xl border border-electric-400/30 bg-midnight-950/60 p-0.5"
              role="group"
              aria-label="Conversation mode"
            >
              <button
                type="button"
                onClick={() => onModeChange("chat")}
                aria-pressed={mode === "chat"}
                className={[
                  "rounded-lg px-2.5 py-1.5 text-[0.8rem] font-semibold transition",
                  mode === "chat"
                    ? "neon-chip"
                    : "text-ink-300 hover:bg-white/5 hover:text-white",
                ].join(" ")}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => onModeChange("image-to-prompt")}
                aria-pressed={mode === "image-to-prompt"}
                className={[
                  "rounded-lg px-2.5 py-1.5 text-[0.8rem] font-semibold transition",
                  mode === "image-to-prompt"
                    ? "neon-chip"
                    : "text-ink-300 hover:bg-white/5 hover:text-white",
                ].join(" ")}
              >
                Image → Prompt
              </button>
            </div>
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
              <option value="auto">Auto (gateway routing)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
              {model !== "auto" && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
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
          placeholder={mode === "image-to-prompt" ? "Describe the prompt you need…" : "Ask anything, or drop an image…"}
          className="max-h-[240px] w-full resize-none border-t border-white/[0.07] bg-transparent px-4 pb-2 pt-3.5 text-base leading-7 text-white placeholder:text-ink-400 focus:outline-none"
          rows={2}
        />
      </div>
      <p id="x-ai-composer-help" className="sr-only">
        Enter sends, Shift+Enter adds a line. Paste or drag an image to attach one. Maximum upload size {Math.round(MAX_RAW_IMAGE_BYTES / 1024 / 1024)} megabytes per image.</p>
    </div>
  );
}
