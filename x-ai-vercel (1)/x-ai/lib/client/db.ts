"use client";

/**
 * Local, browser-only chat persistence (IndexedDB).
 *
 * No account, no server-side user database. Conversations, messages and image
 * Blobs live in this browser on this device. Nothing here ever stores an API
 * key — secrets stay in server environment variables.
 *
 * All helpers throw `StorageUnavailableError` when IndexedDB is blocked or
 * broken, so the UI can warn the user and keep the current session usable.
 */

import type { AttachmentMeta, StoredChat, StoredMessage } from "@/lib/types";

const DB_NAME = "x-ai";
const DB_VERSION = 1;
const CHATS = "chats";
const MESSAGES = "messages";
const ATTACHMENTS = "attachments";

export class StorageUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export interface StoredAttachment extends AttachmentMeta {
  chatId: string;
  blob: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new StorageUnavailableError("This browser does not expose IndexedDB, so chats cannot be saved locally."),
    );
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new StorageUnavailableError("IndexedDB could not be opened (it may be blocked by the browser).", err));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHATS)) {
        const store = db.createObjectStore(CHATS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(MESSAGES)) {
        const store = db.createObjectStore(MESSAGES, { keyPath: "id" });
        store.createIndex("chatId", "chatId");
      }
      if (!db.objectStoreNames.contains(ATTACHMENTS)) {
        const store = db.createObjectStore(ATTACHMENTS, { keyPath: "id" });
        store.createIndex("chatId", "chatId");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(new StorageUnavailableError("IndexedDB could not be opened (private mode or storage blocked).", request.error));
    request.onblocked = () =>
      reject(new StorageUnavailableError("IndexedDB is blocked by another open tab."));
  }).catch((err) => {
    dbPromise = null;
    throw err instanceof StorageUnavailableError ? err : new StorageUnavailableError("Local storage failed.", err);
  });

  return dbPromise;
}

/** Probes IndexedDB without creating anything permanent. */
export async function checkStorage(): Promise<{ ok: boolean; message?: string }> {
  try {
    await openDb();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Local storage is unavailable, so this chat will not be saved.",
    };
  }
}

/* ------------------------------- chats ---------------------------------- */

export async function listChats(): Promise<StoredChat[]> {
  const db = await openDb();
  const tx = db.transaction(CHATS, "readonly");
  const all = await promisifyRequest(tx.objectStore(CHATS).getAll() as IDBRequest<StoredChat[]>);
  // Pinned first, then most recent.
  return all.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function putChat(chat: StoredChat): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CHATS, "readwrite");
  tx.objectStore(CHATS).put(chat);
  await transactionDone(tx);
}

export async function deleteChat(chatId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CHATS, MESSAGES, ATTACHMENTS], "readwrite");
  tx.objectStore(CHATS).delete(chatId);
  const msgStore = tx.objectStore(MESSAGES);
  const attStore = tx.objectStore(ATTACHMENTS);
  await Promise.all([
    deleteByIndex(msgStore.index("chatId"), chatId),
    deleteByIndex(attStore.index("chatId"), chatId),
  ]);
  await transactionDone(tx);
}

function deleteByIndex(index: IDBIndex, value: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(value));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed"));
  });
}

export async function clearAllData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CHATS, MESSAGES, ATTACHMENTS], "readwrite");
  tx.objectStore(CHATS).clear();
  tx.objectStore(MESSAGES).clear();
  tx.objectStore(ATTACHMENTS).clear();
  await transactionDone(tx);
}

/* ------------------------------ messages -------------------------------- */

export async function listMessages(chatId: string): Promise<StoredMessage[]> {
  const db = await openDb();
  const tx = db.transaction(MESSAGES, "readonly");
  const index = tx.objectStore(MESSAGES).index("chatId");
  const rows = await promisifyRequest(index.getAll(IDBKeyRange.only(chatId)) as IDBRequest<StoredMessage[]>);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putMessage(message: StoredMessage): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(MESSAGES, "readwrite");
  tx.objectStore(MESSAGES).put(message);
  await transactionDone(tx);
}

export async function deleteMessage(messageId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([MESSAGES, ATTACHMENTS], "readwrite");
  tx.objectStore(MESSAGES).delete(messageId);
  tx.objectStore(ATTACHMENTS).delete(messageId);
  await transactionDone(tx);
}

/** Every message, used by local search across titles *and* message text. */
export async function listAllMessages(): Promise<StoredMessage[]> {
  const db = await openDb();
  const tx = db.transaction(MESSAGES, "readonly");
  return promisifyRequest(tx.objectStore(MESSAGES).getAll() as IDBRequest<StoredMessage[]>);
}

/* ----------------------------- attachments ------------------------------ */

export async function putAttachment(attachment: StoredAttachment): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ATTACHMENTS, "readwrite");
  tx.objectStore(ATTACHMENTS).put(attachment);
  await transactionDone(tx);
}

export async function getAttachment(id: string): Promise<StoredAttachment | undefined> {
  const db = await openDb();
  const tx = db.transaction(ATTACHMENTS, "readonly");
  return promisifyRequest(tx.objectStore(ATTACHMENTS).get(id) as IDBRequest<StoredAttachment | undefined>);
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ATTACHMENTS, "readwrite");
  tx.objectStore(ATTACHMENTS).delete(id);
  await transactionDone(tx);
}

/** Rough size of locally stored chat data, for the Privacy panel. */
export async function estimateLocalUsage(): Promise<{ supported: boolean; usage?: number; quota?: number }> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return { supported: false };
  try {
    const estimate = await navigator.storage.estimate();
    return { supported: true, usage: estimate.usage, quota: estimate.quota };
  } catch {
    return { supported: false };
  }
}
