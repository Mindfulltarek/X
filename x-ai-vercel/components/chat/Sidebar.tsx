"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import { XBrand } from "@/components/brand/XMark";
import type { GatewayStatus, StoredChat } from "@/lib/types";

/** Groups chats into Pinned / Today / Yesterday / Previous 7 days / Older. */
export function groupChatsByDate(chats: StoredChat[]): { label: string; items: StoredChat[] }[] {
  const pinned = chats.filter((c) => c.pinned);
  const rest = chats.filter((c) => !c.pinned);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const buckets: { label: string; items: StoredChat[] }[] = [
    ...(pinned.length > 0 ? [{ label: "Pinned", items: pinned }] : []),
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const chat of rest) {
    if (chat.updatedAt >= startOfToday) buckets[buckets.length - 4].items.push(chat);
    else if (chat.updatedAt >= startOfToday - day) buckets[buckets.length - 3].items.push(chat);
    else if (chat.updatedAt >= startOfToday - 7 * day) buckets[buckets.length - 2].items.push(chat);
    else buckets[buckets.length - 1].items.push(chat);
  }
  return buckets.filter((b) => b.items.length > 0);
}

export interface SidebarProps {
  chats: StoredChat[];
  activeChatId: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onClearAll: () => void;
  onDeleteChat: (chat: StoredChat) => void;
  onRenameChat: (chat: StoredChat) => void;
  onTogglePin: (chat: StoredChat) => void;
  onToggleArchive: (chat: StoredChat) => void;
  /** Number of archived chats, shown on the archive button. */
  archivedCount: number;
  archiveOpen: boolean;
  onToggleArchiveView: () => void;
  gatewayStatus: GatewayStatus | "checking";
  storageWarning?: string | null;
  open: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  chats,
  activeChatId,
  query,
  onQueryChange,
  onSelectChat,
  onNewChat,
  onOpenSettings,
  onClearAll,
  onDeleteChat,
  onRenameChat,
  onTogglePin,
  onToggleArchive,
  archivedCount,
  archiveOpen,
  onToggleArchiveView,
  gatewayStatus,
  storageWarning,
  open,
  mobileOpen,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  const groups = useMemo(() => groupChatsByDate(chats), [chats]);

  const statusLabel =
    gatewayStatus === "connected"
      ? "Gateway connected"
      : gatewayStatus === "checking"
        ? "Checking gateway…"
        : gatewayStatus === "not_configured"
          ? "Gateway not configured"
          : "Gateway unavailable";
  const statusDot =
    gatewayStatus === "connected"
      ? "bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.7)]"
      : gatewayStatus === "checking"
        ? "bg-amber-300 shadow-[0_0_10px_2px_rgba(252,211,77,0.6)]"
        : gatewayStatus === "not_configured"
          ? "bg-ink-500"
          : "bg-rose-400 shadow-[0_0_10px_2px_rgba(251,113,133,0.7)]";

  return (
    <>
      {/* Mobile scrim */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside
        className={[
          "z-40 flex h-full w-[18.5rem] shrink-0 flex-col border-r border-white/10 bg-midnight-950/97",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "fixed inset-y-0 left-0 lg:static lg:translate-x-0",
          open ? "lg:flex" : "lg:hidden",
        ].join(" ")}
        aria-label="Chat navigation"
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Link href="/" className="rounded-lg" aria-label="X AI home">
            <XBrand size={38} />
          </Link>
          <div className="flex items-center gap-1">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="hidden rounded-lg border border-white/10 p-1.5 text-ink-200 transition hover:border-electric-400/60 hover:text-white lg:block"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <ChevronLeft size={18} strokeWidth={2.4} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-200 transition hover:bg-white/5 hover:text-white lg:hidden"
              aria-label="Close sidebar"
            >
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={onNewChat}
            className="btn-3d w-full justify-start px-4 py-3 text-[0.95rem]"
            aria-label="Start a new chat"
          >
            <Plus size={17} aria-hidden />
            New chat
          </button>
        </div>

        <div className="px-3 pt-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <label htmlFor="x-ai-search" className="sr-only">
              Search chats
            </label>
            <input
              id="x-ai-search"
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search chats"
              className="field py-2.5 pl-9 text-[0.85rem]"
            />
          </div>
        </div>

        {archiveOpen && (
          <div className="mx-3 mt-2 flex items-center justify-between rounded-lg border border-amber-300/40 bg-amber-300/10 px-2.5 py-1.5">
            <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-amber-200">Archive</span>
            <button
              type="button"
              onClick={onToggleArchiveView}
              className="text-[0.72rem] font-semibold text-amber-100 underline underline-offset-2 hover:text-white"
            >
              Back to chats
            </button>
          </div>
        )}

        <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label={archiveOpen ? "Archived chats" : "Recent chats"}>
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-[0.8rem] font-medium leading-6 text-ink-400">
              {query
                ? "No chats match that search."
                : archiveOpen
                  ? "No archived chats yet."
                  : "No saved chats yet. Your conversations are stored in this browser."}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink-400">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((chat) => {
                  const active = chat.id === activeChatId;
                  return (
                    <li key={chat.id} className="group/item relative">
                      <button
                        type="button"
                        onClick={() => onSelectChat(chat.id)}
                        aria-current={active ? "true" : undefined}
                        className={[
                          "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[0.85rem] transition",
                          active
                            ? "border border-electric-400/60 bg-electric-500/15 text-white shadow-[0_0_18px_-6px_rgba(37,99,235,0.9)]"
                            : "border border-transparent text-ink-200 hover:bg-white/[0.06] hover:text-white",
                        ].join(" ")}
                      >
                        {chat.pinned ? (
                          <Pin size={13} className="mt-0.5 shrink-0 text-cyan-200" aria-label="Pinned" />
                        ) : chat.archived ? (
                          <Archive size={13} className="mt-0.5 shrink-0 text-amber-200" aria-hidden />
                        ) : (
                          <MessageSquare size={13} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{chat.title}</span>
                          <span className="mt-0.5 block truncate text-[0.72rem] text-ink-400">
                            {chat.messageCount} message{chat.messageCount === 1 ? "" : "s"}
                            {chat.preview ? ` · ${chat.preview}` : ""}
                          </span>
                        </span>
                      </button>

                      {/* Row actions: pin · rename · archive · delete */}
                      <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded-md border border-white/10 bg-midnight-900/95 p-0.5 group-hover/item:flex focus-within:flex">
                        <button
                          type="button"
                          onClick={() => onTogglePin(chat)}
                          className={`rounded p-1 transition hover:bg-white/10 ${chat.pinned ? "text-cyan-200" : "text-ink-300 hover:text-white"}`}
                          aria-label={chat.pinned ? `Unpin chat: ${chat.title}` : `Pin chat: ${chat.title}`}
                          title={chat.pinned ? "Unpin" : "Pin"}
                        >
                          {chat.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRenameChat(chat)}
                          className="rounded p-1 text-ink-300 transition hover:bg-white/10 hover:text-white"
                          aria-label={`Rename chat: ${chat.title}`}
                          title="Rename"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleArchive(chat)}
                          className="rounded p-1 text-ink-300 transition hover:bg-white/10 hover:text-amber-200"
                          aria-label={chat.archived ? `Unarchive chat: ${chat.title}` : `Archive chat: ${chat.title}`}
                          title={chat.archived ? "Unarchive" : "Archive"}
                        >
                          {chat.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteChat(chat)}
                          className="rounded p-1 text-ink-300 transition hover:bg-white/10 hover:text-rose-300"
                          aria-label={`Delete chat: ${chat.title}`}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-2 pb-3 pt-2">
          {storageWarning && (
            <p className="mb-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 text-[0.72rem] font-medium leading-5 text-amber-100">
              {storageWarning}
            </p>
          )}
          <div className="flex items-center gap-2 px-2 py-1.5 text-[0.75rem] font-medium text-ink-300">
            <span className={`h-2 w-2 rounded-full ${statusDot}`} aria-hidden />
            {statusLabel}
          </div>

          {/* Archive sits directly above Settings, as requested */}
          <button
            type="button"
            onClick={onToggleArchiveView}
            aria-pressed={archiveOpen}
            className={[
              "flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-[0.85rem] font-medium transition",
              archiveOpen
                ? "border border-amber-300/50 bg-amber-300/10 text-amber-100"
                : "text-ink-200 hover:bg-white/[0.06] hover:text-white",
            ].join(" ")}
          >
            <Archive size={15} aria-hidden />
            Archive
            <span className="ml-auto rounded-full border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink-300">
              {archivedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-[0.85rem] font-medium text-ink-200 transition hover:bg-white/[0.06] hover:text-white"
          >
            <Settings size={15} aria-hidden />
            Settings
          </button>

          <button
            type="button"
            onClick={onClearAll}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-[0.85rem] font-medium text-ink-300 transition hover:bg-rose-500/10 hover:text-rose-200"
          >
            <Trash2 size={15} aria-hidden />
            Clear local chats
          </button>

          <div className="mt-2 flex items-center justify-center gap-4 border-t border-white/[0.07] px-2 pt-2.5 text-[0.75rem] font-medium text-ink-400">
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
            <Link href="/ai-usage" className="hover:text-white">
              Usage
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
