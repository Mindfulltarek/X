"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Menu,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import { XBrand, XMark } from "@/components/brand/XMark";
import { Composer, type PendingAttachment } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { DropOverlay } from "./DropOverlay";
import { MessageBubble, GeneratedImageCard } from "./MessageBubble";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";

import type {
  AttachmentMeta,
  ChatStreamEvent,
  CollabInfo,
  HealthResponse,
  ModelsResponse,
  StoredChat,
  StoredMessage,
} from "@/lib/types";
import {
  fetchHealth,
  fetchImageBackend,
  fetchModels,
  generateImage,
  streamChat,
  type ImageBackendStatus,
} from "@/lib/client/api";
import {
  checkStorage,
  clearAllData,
  deleteChat as dbDeleteChat,
  deleteMessage,
  estimateLocalUsage,
  getAttachment,
  listAllMessages,
  listChats,
  listMessages,
  putAttachment,
  putChat,
  putMessage,
} from "@/lib/client/db";
import { filesFromDataTransfer } from "@/lib/client/image";
import { ImageRejectedError, prepareAttachment } from "@/lib/client/files";
import { readSettings, writeSettings } from "@/lib/client/settings";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Plain-text preview for the sidebar (drops Markdown noise). */
function previewFrom(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function titleFrom(text: string, hasImage: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return hasImage ? "Image prompt" : "New chat";
  if (clean.length <= 56) return clean;
  const cut = clean.slice(0, 56);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 24 ? lastSpace : 56)}…`;
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read stored image"));
    reader.readAsDataURL(blob);
  });
}

/** Pulls the most useful prompt text out of a model answer. */
export function extractPromptText(markdown: string): string {
  const fence = /```(?:text|txt|prompt)?\s*\n([\s\S]*?)```/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    if (match[1].trim()) blocks.push(match[1].trim());
  }
  if (blocks.length > 0) return blocks[blocks.length - 1];
  return markdown.replace(/^#+\s.*$/gm, "").trim();
}

type Banner = { message: string; code?: string; retryable?: boolean; tone?: "error" | "info" };

export function ChatApp() {
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [model, setModel] = useState("auto");

  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [imageBackend, setImageBackend] = useState<ImageBackendStatus | null>(null);

  const [streaming, setStreaming] = useState<{ messageId: string; text: string; status: string } | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StoredChat[] | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [localUsage, setLocalUsage] = useState<{ usage?: number; quota?: number }>({});
  const [imageGeneratingFor, setImageGeneratingFor] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    action: () => void;
  } | null>(null);
  const [renameState, setRenameState] = useState<{ chat: StoredChat; value: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const chatsRef = useRef<StoredChat[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* ------------------------------ bootstrap ------------------------------ */

  useEffect(() => {
    const settings = readSettings();
    setModel(settings.model);
    setSidebarCollapsed(settings.sidebarCollapsed);
    setSettingsLoaded(true);

    void (async () => {
      const storage = await checkStorage();
      if (!storage.ok) {
        setStorageWarning(storage.message ?? "Local storage is unavailable; this chat will not be saved.");
      }
      try {
        const storedChats = await listChats();
        applyChats(storedChats);
        if (settings.lastChatId && storedChats.some((c) => c.id === settings.lastChatId)) {
          setActiveChatId(settings.lastChatId);
        }
      } catch {
        /* warning already surfaced by checkStorage */
      }
    })();

    void (async () => {
      setHealthLoading(true);
      try {
        const result = await fetchHealth();
        setHealth(result);
      } catch {
        setHealth({ status: "unavailable", message: "Could not reach the X AI server.", checkedAt: Date.now() });
      } finally {
        setHealthLoading(false);
      }
      try {
        setModels(await fetchModels());
      } catch {
        /* handled by the empty state */
      }
      try {
        setImageBackend(await fetchImageBackend());
      } catch {
        setImageBackend(null);
      }
    })();
    // applyChats is stable, so the bootstrap runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the active conversation.
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const stored = await listMessages(activeChatId);
        if (!cancelled) setMessages(stored);
      } catch {
        if (!cancelled) setStorageWarning("Could not read saved messages from this browser.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  // Resolve stored image blobs into object URLs for display.
  useEffect(() => {
    const known = new Set(Object.keys(attachmentUrls));
    const missing = messages
      .flatMap((m) => m.attachments ?? [])
      .filter((a) => !known.has(a.id));
    if (missing.length === 0) return;
    let cancelled = false;

    void (async () => {
      const created: [string, string][] = [];
      for (const att of missing) {
        try {
          const stored = await getAttachment(att.id);
          if (stored?.blob && !cancelled) {
            const url = URL.createObjectURL(stored.blob);
            urlsRef.current.push(url);
            created.push([att.id, url]);
          }
        } catch {
          /* missing blob: the UI falls back to a filename chip */
        }
      }
      if (created.length > 0 && !cancelled) {
        setAttachmentUrls((prev) => {
          const next = { ...prev };
          for (const [id, url] of created) next[id] = url;
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, attachmentUrls]);

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, []);

  // Local search across chat titles and message text.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        let messageMatch = new Set<string>();
        try {
          const all = await listAllMessages();
          messageMatch = new Set(
            all.filter((m) => m.content.toLowerCase().includes(q)).map((m) => m.chatId),
          );
        } catch {
          /* title-only search still works */
        }
        if (cancelled) return;
        setSearchResults(chats.filter((c) => c.title.toLowerCase().includes(q) || messageMatch.has(c.id)));
      })();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, chats]);

  // Full-window drag & drop with enter/leave depth tracking (no flicker).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDropActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropActive(false);
      const files = filesFromDataTransfer(e.dataTransfer);
      const first = files[0];
      if (!first) return;
      if (files.length > 1) {
        setBanner({
          tone: "info",
          message: `Only one image can be attached per message, so "${first.name}" was attached and the other ${
            files.length - 1
          } file(s) were not. Send it first, then attach the next.`,
        });
      }
      void handleAttach(first);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoscroll only when the reader is already near the bottom.
  // Instant (not smooth) while streaming: repeated smooth-scrolls fight each
  // other and are what make a busy chat feel sluggish.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pinnedToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text]);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  /* ------------------------------- helpers ------------------------------- */

  const handleAttach = useCallback(async (file: File) => {
    setAttachmentBusy(true);
    setBanner(null);
    try {
      const prepared = await prepareAttachment(file);
      setAttachment(prepared);
      if (prepared.compressed) {
        setBanner({
          tone: "info",
          message: `"${prepared.name}" was optimised for upload (${(prepared.originalBytes / 1024 / 1024).toFixed(
            1,
          )} MB → ${(prepared.bytes / 1024 / 1024).toFixed(2)} MB) so it fits serverless request limits.`,
        });
      }
    } catch (err) {
      setBanner({
        message: err instanceof ImageRejectedError ? err.message : "That file could not be processed.",
      });
    } finally {
      setAttachmentBusy(false);
    }
  }, []);

  /** Single source of truth for the chat list, so DB writes and state never drift. */
  const applyChats = useCallback((next: StoredChat[]) => {
    chatsRef.current = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    setChats(chatsRef.current);
  }, []);

  const touchChat = useCallback(
    async (chatId: string, patch: Partial<StoredChat>) => {
      const cleaned = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<StoredChat>;
      const current = chatsRef.current.find((c) => c.id === chatId);
      if (!current) return;
      const updated: StoredChat = { ...current, ...cleaned, updatedAt: patch.updatedAt ?? Date.now() };
      applyChats(chatsRef.current.map((c) => (c.id === chatId ? updated : c)));
      try {
        await putChat(updated);
      } catch {
        setStorageWarning("This browser could not save the chat update.");
      }
    },
    [applyChats],
  );

  const runAssistant = useCallback(
    async (opts: {
      chatId: string;
      history: StoredMessage[];
      attachments?: { name: string; mime: string; dataUrl: string }[];
      requestModel: string;
      statusLabel: string;
    }) => {
      const messageId = newId();
      const controller = new AbortController();
      abortRef.current = controller;
      let acc = "";
      let servedModel: string | undefined;
      let servedProvider: string | undefined;
      let collab: CollabInfo | null = null;
      let fallbackUsed = false;
      let visionUsed = false;
      let documentsUsed = 0;
      let generatedImages: { url: string; mime?: string }[] = [];
      let failure: { code: string; message: string } | null = null;

      setStreaming({ messageId, text: "", status: opts.statusLabel });
      pinnedToBottom.current = true;

      /* Streamed text is buffered and flushed at most every 60 ms instead of
         re-rendering the whole workspace for every upstream token. */
      let flushTimer = 0;
      const flushStream = () => {
        flushTimer = 0;
        setStreaming((prev) => (prev ? { ...prev, text: acc } : prev));
      };

      const apiMessages = opts.history
        .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.trim() && !m.error))
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        await streamChat(
          {
            model: opts.requestModel,
            messages: apiMessages,
            attachments: opts.attachments,
            chatId: opts.chatId,
          },
          {
            signal: controller.signal,
            onEvent: (event: ChatStreamEvent) => {
              if (event.type === "meta") {
                servedModel = event.model;
                servedProvider = event.providerLabel ?? event.provider;
                fallbackUsed = event.fallbackAttempts > 0;
                visionUsed = (event.route?.images ?? 0) > 0;
                documentsUsed = event.route?.documents ?? 0;
                if (event.notice) setBanner({ tone: "info", message: event.notice });
                setStreaming((prev) => (prev ? { ...prev, status: opts.statusLabel } : prev));
              } else if (event.type === "delta") {
                acc += event.text;
                if (!flushTimer) {
                  flushTimer = window.setTimeout(flushStream, 60);
                }
              } else if (event.type === "collab") {
                if (event.stage === "done" || event.stage === "partial") {
                  collab = {
                    verdict: event.verdict ?? "unknown",
                    peerModel: event.peerModel,
                    peerProvider: event.peerProvider,
                    summary: event.summary,
                    addendum: event.addendum,
                    disputes: event.disputes,
                  };
                }
              } else if (event.type === "image") {
                generatedImages = event.images.map((image) => ({ url: image.url, mime: image.mime }));
                servedModel = event.model ?? servedModel;
                servedProvider = event.backend ?? servedProvider;
                setStreaming((prev) => (prev ? { ...prev, status: "Finishing image…" } : prev));
              } else if (event.type === "done") {
                servedModel = event.model ?? servedModel;
                servedProvider = event.provider ?? servedProvider;
              } else if (event.type === "error") {
                failure = { code: event.code, message: event.message };
              }
            },
          },
        );
      } catch (err) {
        if (controller.signal.aborted) {
          failure = { code: "aborted", message: "Generation stopped." };
        } else {
          failure = {
            code: "network",
            message: (err as Error)?.message ?? "The request failed before the answer started.",
          };
        }
      } finally {
        abortRef.current = null;
        if (flushTimer) window.clearTimeout(flushTimer);
      }

      /* Generated images are stored in IndexedDB like any other attachment. */
      const generatedMeta: AttachmentMeta[] = [];
      for (const image of generatedImages) {
        try {
          const blob = image.url.startsWith("data:")
            ? await blobFromDataUrl(image.url)
            : await (await fetch(image.url)).blob();
          const id = newId();
          await putAttachment({
            id,
            chatId: opts.chatId,
            name: `x-ai-${Date.now()}.png`,
            mime: blob.type || "image/png",
            size: blob.size,
            blob,
            createdAt: Date.now(),
          });
          generatedMeta.push({ id, name: `x-ai-${Date.now()}.png`, mime: blob.type || "image/png", size: blob.size, generated: true });
        } catch {
          setStorageWarning("A generated image could not be stored in this browser.");
        }
      }

      const aborted = controller.signal.aborted;
      const assistant: StoredMessage = {
        id: messageId,
        chatId: opts.chatId,
        role: "assistant",
        content: acc,
        createdAt: Date.now(),
        model: servedModel,
        provider: servedProvider,
        requestedModel: opts.requestModel,
        collab,
        fallbackUsed,
        visionUsed,
        documentsUsed: documentsUsed || undefined,
        attachments: generatedMeta.length > 0 ? generatedMeta : undefined,
        error: failure && !(aborted && acc) ? failure : null,
      };

      setMessages((prev) => [...prev.filter((m) => m.id !== messageId), assistant]);
      setStreaming(null);
      try {
        await putMessage(assistant);
      } catch {
        setStorageWarning("This answer could not be saved locally.");
      }
      await touchChat(opts.chatId, {
        preview: previewFrom(acc),
        messageCount: opts.history.length + 1,
      });
      if (failure && !aborted) {
        setBanner({ message: failure.message, code: failure.code, retryable: true });
      }
    },
    [touchChat],
  );

  const send = useCallback(async () => {
    if (streaming || attachmentBusy) return;
    const text = draft.trim();
    if (!text && !attachment) return;

    setBanner(null);
    const hasImage = Boolean(attachment);
    const existingChat = chats.find((c) => c.id === activeChatId) ?? null;
    const chatId = existingChat?.id ?? newId();
    const now = Date.now();

    if (!existingChat) {
      const chat: StoredChat = {
        id: chatId,
        title: titleFrom(text, hasImage),
        createdAt: now,
        updatedAt: now,
        model,
        messageCount: 0,
        preview: "",
      };
      applyChats([chat, ...chatsRef.current]);
      setActiveChatId(chatId);
      writeSettings({ lastChatId: chatId });
      try {
        await putChat(chat);
      } catch {
        setStorageWarning("This browser could not save the new chat.");
      }
    }

    const attachments: AttachmentMeta[] = [];
    const requestAttachments: { name: string; mime: string; dataUrl: string }[] = [];
    if (attachment) {
      const attachmentId = newId();
      try {
        const blob = await blobFromDataUrl(attachment.dataUrl);
        await putAttachment({
          id: attachmentId,
          chatId,
          name: attachment.name,
          mime: blob.type || "image/png",
          size: blob.size,
          width: attachment.width,
          height: attachment.height,
          blob,
          createdAt: now,
        });
        attachments.push({
          id: attachmentId,
          name: attachment.name,
          mime: attachment.mime,
          size: blob.size,
          width: attachment.width,
          height: attachment.height,
          document: attachment.kind === "document" ? true : undefined,
        });
        requestAttachments.push({ name: attachment.name, mime: attachment.mime, dataUrl: attachment.dataUrl });
      } catch {
        setStorageWarning("The image could not be stored locally, so it was not attached.");
        return;
      }
    }

    const userMessage: StoredMessage = {
      id: newId(),
      chatId,
      role: "user",
      content: text,
      createdAt: now,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const history = [...messages, userMessage];
    setMessages(history);
    setDraft("");
    setAttachment(null);
    try {
      await putMessage(userMessage);
    } catch {
      setStorageWarning("This message could not be saved locally.");
    }

    const hasImageForRequest = requestAttachments.some((item) => item.mime.startsWith("image/"));

    await touchChat(chatId, {
      title: existingChat?.messageCount === 0 ? titleFrom(text, hasImage) : undefined,
      model,
      preview: previewFrom(text),
      messageCount: history.length,
    });

    await runAssistant({
      chatId,
      history,
      attachments: requestAttachments.length > 0 ? requestAttachments : undefined,
      requestModel: model,
      statusLabel: hasImageForRequest ? "Analysing image…" : "Thinking…",
    });
  }, [
    activeChatId,
    applyChats,
    attachment,
    attachmentBusy,
    chats,
    draft,
    messages,
    model,
    runAssistant,
    streaming,
    touchChat,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const regenerate = useCallback(
    async (message: StoredMessage) => {
      if (streaming || !activeChatId) return;
      const index = messages.findIndex((m) => m.id === message.id);
      if (index < 0) return;
      const priorHistory = messages.slice(0, index);
      const lastUser = [...priorHistory].reverse().find((m) => m.role === "user");
      if (!lastUser) return;

      setMessages(priorHistory);
      try {
        await deleteMessage(message.id);
      } catch {
        /* the answer is still removed from the view */
      }

      const attachmentFromLastUser =
        lastUser.attachments && lastUser.attachments.length > 0
          ? await (async () => {
              const meta = lastUser.attachments![0];
              const stored = await getAttachment(meta.id).catch(() => undefined);
              if (!stored?.blob) return undefined;
              const dataUrl = await dataUrlFromBlob(stored.blob);
              return { name: meta.name, mime: meta.mime, dataUrl };
            })()
          : undefined;
      const requestAttachments: { name: string; mime: string; dataUrl: string }[] = [];
      if (attachmentFromLastUser) requestAttachments.push(attachmentFromLastUser);

      await runAssistant({
        chatId: activeChatId,
        history: priorHistory,
        attachments: requestAttachments.length > 0 ? requestAttachments : undefined,
        requestModel: model,
        statusLabel: requestAttachments.some((item) => item.mime.startsWith("image/"))
          ? "Analysing image…"
          : "Thinking…",
      });
      await touchChat(activeChatId, { messageCount: priorHistory.length + 1 });
    },
    [activeChatId, messages, model, runAssistant, streaming, touchChat],
  );

  const handleGenerateImage = useCallback(
    async (message: StoredMessage) => {
      if (!activeChatId || imageGeneratingFor) return;
      const prompt = extractPromptText(message.content);
      if (!prompt) {
        setBanner({ message: "There is no prompt text in that answer to generate from." });
        return;
      }
      setImageGeneratingFor(message.id);
      setBanner(null);
      try {
        const result = await generateImage({ prompt, size: "1024x1024", n: 1 });
        const image = result.images[0];
        if (!image) throw new Error("No image returned");
        const blob = image.url.startsWith("data:") ? await blobFromDataUrl(image.url) : await (await fetch(image.url)).blob();
        const attachmentId = newId();
        await putAttachment({
          id: attachmentId,
          chatId: activeChatId,
          name: `x-ai-${Date.now()}.png`,
          mime: blob.type || "image/png",
          size: blob.size,
          blob,
          createdAt: Date.now(),
        });
        const generated: StoredMessage = {
          id: newId(),
          chatId: activeChatId,
          role: "assistant",
          content: `Image generated with ${result.model ?? result.backend} in ${(result.tookMs / 1000).toFixed(1)}s.`,
          createdAt: Date.now(),
          model: result.model ?? result.backend,
          attachments: [
            {
              id: attachmentId,
              name: `x-ai-${Date.now()}.png`,
              mime: blob.type || "image/png",
              size: blob.size,
              generated: true,
            },
          ],
        };
        setMessages((prev) => [...prev, generated]);
        await putMessage(generated);
        await touchChat(activeChatId, { messageCount: messages.length + 1 });
      } catch (err) {
        setBanner({ message: (err as Error)?.message ?? "Image generation failed." });
      } finally {
        setImageGeneratingFor(null);
      }
    },
    [activeChatId, imageGeneratingFor, messages.length, touchChat],
  );

  /* -------------------------------- actions ------------------------------- */

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveChatId(null);
    setMessages([]);
    setDraft("");
    setAttachment(null);
    setBanner(null);
    setQuery("");
    setSidebarOpen(false);
    writeSettings({ lastChatId: undefined });
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, []);

  const selectChat = useCallback(
    (id: string) => {
      if (id === activeChatId) {
        setSidebarOpen(false);
        return;
      }
      abortRef.current?.abort();
      setStreaming(null);
      setActiveChatId(id);
      setAttachment(null);
      setBanner(null);
      setSidebarOpen(false);
      writeSettings({ lastChatId: id });
      const chat = chats.find((c) => c.id === id);
      if (chat) setModel(chat.model || "auto");
    },
    [activeChatId, chats],
  );

  const requestDeleteChat = useCallback((chat: StoredChat) => {
    setConfirmState({
      title: "Delete this chat?",
      description: `"${chat.title}" and its images will be removed from this browser. This cannot be undone.`,
      confirmLabel: "Delete chat",
      danger: true,
      action: () => {
        void (async () => {
          try {
            await dbDeleteChat(chat.id);
          } catch {
            setStorageWarning("The chat could not be deleted from this browser.");
          }
          applyChats(chatsRef.current.filter((c) => c.id !== chat.id));
          if (activeChatId === chat.id) {
            setActiveChatId(null);
            setMessages([]);
          }
        })();
      },
    });
  }, [activeChatId, applyChats]);

  const togglePin = useCallback(
    (chat: StoredChat) => {
      void touchChat(chat.id, { pinned: !chat.pinned });
    },
    [touchChat],
  );

  const toggleArchive = useCallback(
    (chat: StoredChat) => {
      const nextArchived = !chat.archived;
      void touchChat(chat.id, { archived: nextArchived, pinned: nextArchived ? false : chat.pinned });
      if (nextArchived) {
        setBanner({
          tone: "info",
          message: `"${chat.title}" was archived. Find it under Archive in the sidebar.`,
        });
        if (activeChatId === chat.id) {
          setActiveChatId(null);
          setMessages([]);
        }
      } else {
        setBanner({ tone: "info", message: `"${chat.title}" was restored from the archive.` });
        setArchiveOpen(false);
      }
    },
    [activeChatId, touchChat],
  );

  const toggleArchiveView = useCallback(() => {
    setArchiveOpen((prev) => !prev);
    setQuery("");
  }, []);

  const requestClearAll = useCallback(() => {
    setSettingsOpen(false);
    setConfirmState({
      title: "Clear all local chats?",
      description:
        "Every conversation and attached image stored by X AI in this browser will be deleted from this device. This cannot be undone.",
      confirmLabel: "Clear everything",
      danger: true,
      action: () => {
        void (async () => {
          try {
            await clearAllData();
          } catch {
            setStorageWarning("Local data could not be cleared. Try clearing site data in your browser settings.");
          }
          applyChats([]);
          setMessages([]);
          setActiveChatId(null);
          setAttachmentUrls({});
          setBanner(null);
          writeSettings({ lastChatId: undefined });
        })();
      },
    });
  }, [applyChats]);

  const testConnection = useCallback(async () => {
    setHealthLoading(true);
    setBanner(null);
    try {
      const result = await fetchHealth();
      setHealth(result);
      if (result.status === "connected") {
        setModels(await fetchModels({ refresh: true }));
        setImageBackend(await fetchImageBackend());
      }
    } catch (err) {
      setHealth({
        status: "unavailable",
        message: (err as Error)?.message ?? "Could not reach the AI providers.",
        checkedAt: Date.now(),
      });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      setModels(await fetchModels({ refresh: true }));
    } catch (err) {
      setBanner({ message: (err as Error)?.message ?? "Could not refresh the model list." });
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setSidebarOpen(false);
    void (async () => {
      const usage = await estimateLocalUsage();
      setLocalUsage({ usage: usage.usage, quota: usage.quota });
    })();
  }, []);

  const changeModel = useCallback((next: string) => {
    setModel(next);
    writeSettings({ model: next });
  }, []);

  /* --------------------------------- view -------------------------------- */

  const archivedChats = useMemo(() => chats.filter((c) => c.archived), [chats]);
  const liveChats = useMemo(() => chats.filter((c) => !c.archived), [chats]);
  const visibleChats = useMemo(() => {
    if (searchResults) return searchResults;
    return archiveOpen ? archivedChats : liveChats;
  }, [archiveOpen, archivedChats, liveChats, searchResults]);
  const selectedModel = models?.models.find((m) => m.id === model);
  const notConfigured = health?.status === "not_configured";
  const chatTitle = chats.find((c) => c.id === activeChatId)?.title ?? "New chat";
  const busy = Boolean(streaming);

  const suggestionChips = useMemo(
    () => [
      { label: "اعمل صورة قطة على الشاطئ", prompt: "اعمل صورة قطة على الشاطئ وقت الغروب" },
      { label: "اشرح لي فكرة ببساطة", prompt: "اشرح لي إزاي بيشتغل الـ transformer ببساطة" },
      { label: "اكتب لي كود", prompt: "اكتب لي كود بايثون يقرا ملف CSV ويطبع الملخص" },
      { label: "اقرأ صورة (ارفعها الأول)", prompt: "ايه اللي في الصورة دي؟", attach: true },
    ],
    [],
  );

  return (
    <div className="relative flex h-[100dvh] overflow-hidden bg-midnight-950 text-ink-200">
      <div className="space-bg" aria-hidden />
      <DropOverlay visible={dropActive} />

      <Sidebar
        chats={visibleChats}
        activeChatId={activeChatId}
        query={query}
        onQueryChange={setQuery}
        onSelectChat={selectChat}
        onNewChat={startNewChat}
        onOpenSettings={openSettings}
        onClearAll={requestClearAll}
        onDeleteChat={requestDeleteChat}
        onRenameChat={(chat) => setRenameState({ chat, value: chat.title })}
        onTogglePin={togglePin}
        onToggleArchive={toggleArchive}
        archivedCount={archivedChats.length}
        archiveOpen={archiveOpen}
        onToggleArchiveView={toggleArchiveView}
        gatewayStatus={healthLoading ? "checking" : (health?.status ?? "unavailable")}
        storageWarning={storageWarning}
        open={!sidebarCollapsed}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => {
          setSidebarCollapsed(true);
          writeSettings({ sidebarCollapsed: true });
        }}
      />

      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => {
            setSidebarCollapsed(false);
            writeSettings({ sidebarCollapsed: false });
          }}
          className="absolute left-3 top-3 z-20 hidden items-center gap-1.5 rounded-lg border border-electric-400/60 bg-midnight-900 px-3 py-2 text-[0.85rem] font-semibold text-cyan-100 transition hover:text-white lg:flex neon-box"
          aria-label="Open sidebar"
        >
          <ChevronRight size={16} strokeWidth={2.6} aria-hidden /> Chats
        </button>
      )}

      <main id="main" className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-midnight-950/85 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-electric-400/50 bg-electric-500/15 p-2 text-cyan-100 transition hover:text-white lg:hidden neon-box"
            aria-label="Open chat list"
          >
            <Menu size={20} />
          </button>
          <Link href="/" className="lg:hidden" aria-label="X AI home">
            <XBrand size={28} showTagline={false} />
          </Link>
          <div className="hidden min-w-0 flex-1 items-center lg:flex">
            <span className="truncate text-[0.95rem] font-medium text-ink-100">{chatTitle}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[0.78rem] font-medium text-ink-200 sm:flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  health?.status === "connected"
                    ? "bg-emerald-400"
                    : health?.status === "not_configured"
                      ? "bg-ink-500"
                      : "bg-rose-400"
                }`}
                aria-hidden
              />
              {health?.status === "connected" ? "Connected" : health?.status === "not_configured" ? "Not configured" : "Unavailable"}
            </span>
            <button
              type="button"
              onClick={startNewChat}
              className="btn-3d px-4 py-2.5 text-[0.9rem]"
              aria-label="Start a new chat"
            >
              <Plus size={16} aria-hidden /> New
            </button>
          </div>
        </header>

        {/* Banners */}
        <div className="space-y-2 px-4 pt-3 empty:hidden">
          {notConfigured && (
            <div className="mx-auto flex max-w-3xl items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2.5 text-xs leading-5 text-amber-100">
              <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">This deployment has no AI provider connected.</p>
                <p className="mt-0.5 text-amber-100/80">
                  The site owner needs to set{" "}
                  <code className="rounded bg-black/30 px-1 font-mono text-[0.7rem]">AI_PROVIDERS</code> (or a provider
                  key such as{" "}
                  <code className="rounded bg-black/30 px-1 font-mono text-[0.7rem]">OPENROUTER_API_KEY</code>) in the
                  host environment and redeploy. You can still browse saved chats. A deployment on Vercel cannot reach a{" "}
                  <code className="rounded bg-black/30 px-1 font-mono text-[0.7rem]">localhost</code> service — see the
                  README.
                </p>
              </div>
            </div>
          )}
          {banner && (
            <div
              className={[
                "mx-auto flex max-w-3xl items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[0.85rem] font-medium leading-6",
                banner.tone === "info"
                  ? "border-cyan-accent/40 bg-cyan-accent/10 text-cyan-100"
                  : "border-rose-400/35 bg-rose-500/[0.09] text-rose-100",
              ].join(" ")}
              role={banner.tone === "info" ? "status" : "alert"}
            >
              {banner.tone === "info" ? (
                <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
              ) : (
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              )}
              <p className="flex-1">{banner.message}</p>
              {banner.retryable && (
                <button
                  type="button"
                  onClick={() => setBanner(null)}
                  className="rounded px-1 text-rose-200/70 hover:text-white"
                  aria-label="Dismiss error"
                >
                  <X size={13} />
                </button>
              )}
              {!banner.retryable && (
                <button
                  type="button"
                  onClick={() => setBanner(null)}
                  className="rounded px-1 text-rose-200/70 hover:text-white"
                  aria-label="Dismiss message"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Conversation */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.length === 0 && !streaming ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center py-10 text-center">
              <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
                <div className="absolute inset-0 rounded-3xl bg-electric-500/20 blur-2xl" aria-hidden />
                <XMark size={72} />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink-100">أهلاً بيك في X AI</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-400">
                اكتب طلبك بالعربي أو الإنجليزي. اسأل، أو ارفع صورة، أو قول «اعمل صورة …» وهيختار الموديل
                الصح لوحده — مش محتاج تظبط حاجة.
              </p>
              <p className="mt-1 max-w-md text-[0.78rem] leading-5 text-ink-500">
                Ask anything, upload an image to have it read, or ask for a picture and the router switches to the
                image model automatically. Chats stay in this browser — no account needed.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {suggestionChips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      if (chip.prompt) setDraft(chip.prompt);
                      inputRef.current?.focus();
                    }}
                    className="chip transition hover:border-electric-400/50 hover:text-ink-100"
                  >
                    <Sparkles size={12} aria-hidden /> {chip.label}
                  </button>
                ))}
              </div>
              {notConfigured && (
                <p className="mt-6 max-w-md text-xs leading-5 text-ink-500">
                  Chat is unavailable until an AI provider is configured on the server. Saved conversations still open.
                </p>
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-6 pt-2">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  attachmentUrl={(id) => attachmentUrls[id]}
                  onRegenerate={
                    message.role === "assistant" &&
                    !busy &&
                    !(message.attachments ?? []).some((a) => a.generated)
                      ? () => void regenerate(message)
                      : undefined
                  }
                  onGenerateImage={
                    message.role === "assistant" && message.content.includes("```") && !message.error
                      ? () => void handleGenerateImage(message)
                      : undefined
                  }
                  canGenerateImage={Boolean(imageBackend?.configured)}
                  generatingImage={imageGeneratingFor === message.id}
                >
                  {(message.attachments ?? [])
                    .filter((a) => a.generated && attachmentUrls[a.id])
                    .map((a) => (
                      <GeneratedImageCard
                        key={a.id}
                        url={attachmentUrls[a.id]}
                        label={`Generated with ${message.model ?? "the configured backend"}`}
                      />
                    ))}

                </MessageBubble>
              ))}

              {streaming && (
                <MessageBubble
                  message={{
                    id: streaming.messageId,
                    chatId: activeChatId ?? "",
                    role: "assistant",
                    content: "",
                    createdAt: Date.now(),
                    requestedModel: model,
                  }}
                  streaming
                  streamingText={streaming.text}
                  statusLabel={streaming.status}
                  attachmentUrl={(id) => attachmentUrls[id]}
                />
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-white/5 bg-midnight-950/90 px-4 pb-5 pt-3">
          <div className="mx-auto max-w-3xl">
            {selectedModel && (
              <p className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[0.78rem] font-medium text-ink-300">
                <ChevronDown size={11} aria-hidden />
                {selectedModel.label}
                {selectedModel.providerLabel ? ` · ${selectedModel.providerLabel}` : ""}
                {selectedModel.vision ? " · vision" : ""}
                {selectedModel.contextLength ? ` · ${Math.round(selectedModel.contextLength / 1000)}k context` : ""}
              </p>
            )}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              onStop={stop}
              busy={busy}
              attachment={attachment}
              onAttach={(file) => void handleAttach(file)}
              onRemoveAttachment={() => setAttachment(null)}
              model={model}
              models={models?.models ?? []}
              onModelChange={changeModel}
              attachmentBusy={attachmentBusy}
              hint={
                attachmentBusy
                  ? "Preparing image…"
                  : attachment
                    ? "Image attached. Add an instruction, or send it with a blank message to get an analysis prompt."
                    : null
              }
              inputRef={inputRef}
            />
          </div>
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        health={health}
        healthLoading={healthLoading}
        onTestConnection={() => void testConnection()}
        models={models}
        modelsLoading={modelsLoading}
        onRefreshModels={() => void refreshModels()}
        imageBackend={imageBackend}
        onClearHistory={requestClearAll}
        storageWarning={storageWarning}
        localUsage={localUsage}
      />

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ""}
        description={confirmState?.description ?? ""}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          confirmState?.action();
          setConfirmState(null);
        }}
      />

      {renameState && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setRenameState(null)} aria-hidden />
          <form
            className="relative w-full max-w-sm rounded-2xl border border-white/12 bg-midnight-900 p-5 shadow-panel"
            onSubmit={(e) => {
              e.preventDefault();
              const next = renameState.value.trim();
              if (!next) return;
              void touchChat(renameState.chat.id, { title: next.slice(0, 120) });
              setRenameState(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
          >
            <h2 id="rename-title" className="text-base font-semibold text-ink-100">
              Rename chat
            </h2>
            <label htmlFor="rename-input" className="mt-3 block text-xs text-ink-400">
              Chat name
            </label>
            <input
              id="rename-input"
              autoFocus
              value={renameState.value}
              onChange={(e) => setRenameState({ ...renameState, value: e.target.value })}
              maxLength={120}
              className="field mt-1"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setRenameState(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {!settingsLoaded && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-midnight-950">
          <Loader2 className="animate-spin text-electric-300" aria-label="Loading X AI" />
        </div>
      )}
    </div>
  );
}
