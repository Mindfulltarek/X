"use client";

/**
 * Small non-secret preferences in localStorage.
 * API keys and gateway configuration are NEVER stored in the browser.
 */


const KEY = "x-ai:settings:v1";

export interface LocalSettings {
  model: string;
  sidebarCollapsed: boolean;
  lastChatId?: string;
}

export const DEFAULT_SETTINGS: LocalSettings = {
  model: "auto",
  sidebarCollapsed: false,
};

export function readSettings(): LocalSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_SETTINGS.model,
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      lastChatId: typeof parsed.lastChatId === "string" ? parsed.lastChatId : undefined,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(patch: Partial<LocalSettings>): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readSettings(), ...patch };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Storage may be disabled; preferences are then session-only. */
  }
}
