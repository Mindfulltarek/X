"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    cancelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        className="relative w-full max-w-md rounded-2xl border border-white/12 bg-midnight-900 p-5 shadow-panel animate-fade-up"
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              danger ? "bg-rose-500/15 text-rose-300" : "bg-electric-500/15 text-electric-300"
            }`}
          >
            <AlertTriangle size={17} aria-hidden />
          </span>
          <div>
            <h2 id="confirm-title" className="text-base font-semibold text-ink-100">
              {title}
            </h2>
            <p id="confirm-description" className="mt-1.5 text-sm leading-6 text-ink-300">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" ref={cancelRef} onClick={onCancel} className="btn-ghost">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "btn bg-rose-600 text-white hover:bg-rose-500"
                : "btn-primary"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
