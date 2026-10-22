import "server-only";

import { ApiError, apiError } from "../errors";
import { postChatCompletion, type UpstreamMessage } from "./client";
import { extractFullContent, parseJsonLoose } from "./parse";
import { reportModelFailure, reportModelSuccess, type RegistrySnapshot } from "./registry";
import { routeCollaborator } from "./router";
import type { AISettings, Classification, ModelRef, ProviderState } from "./types";

/**
 * Optional multi-model collaboration ("second opinion").
 *
 * Enabled only when the operator sets `AI_COLLABORATION=review`. It is used
 * only where a second model can actually add value (analysis, coding,
 * documents), never for greetings, vision transcriptions or image generation.
 *
 * Flow, in parallel and bounded to three calls:
 *   1. PRIMARY   — streams to the user as usual.
 *   2. PEER      — a different model, ideally on a different provider, answers
 *                  the same question independently. Runs in parallel with the
 *                  primary, so it adds no waiting time.
 *   3. SYNTHESIS — compares the two answers and returns a structured report:
 *                  agreement level, concrete disagreements with the reasoning
 *                  behind the resolution, and an optional short addendum.
 *
 * Partial failure is expected and handled: if the peer fails, or the synthesis
 * step fails, or the reviewer runs out of time, the primary answer is kept and
 * the client is told exactly what happened — never a made-up verdict.
 */

export type CollabVerdict = "agree" | "partial" | "conflict" | "unknown";

export interface CollabDispute {
  topic: string;
  primary: string;
  peer: string;
  resolution: string;
}

export interface CollabReport {
  stage: "done" | "partial" | "skipped";
  peerModel?: string;
  peerProvider?: string;
  synthesisModel?: string;
  verdict?: CollabVerdict;
  summary?: string;
  addendum?: string;
  disputes?: CollabDispute[];
  reason?: string;
  latencyMs?: number;
}

export interface CollabPlan {
  enabled: boolean;
  reason: string;
  peer?: ModelRef;
  synthesis?: ModelRef;
}

const MIN_PROMPT_CHARS = 80;
const PEER_MAX_TOKENS = 1_400;
const SYNTHESIS_MAX_TOKENS = 900;

/** Decides whether a second opinion is worth the extra calls. */
export function planCollaboration(opts: {
  snapshot: RegistrySnapshot;
  primary: ModelRef;
  classification: Classification;
  settings: AISettings;
  promptChars: number;
}): CollabPlan {
  const { snapshot, primary, classification, settings, promptChars } = opts;
  if (settings.collaboration !== "review") return { enabled: false, reason: "collaboration is off" };
  if (settings.maxModelsPerRequest < 2) {
    return { enabled: false, reason: "AI_MAX_MODELS_PER_REQUEST allows only one model" };
  }
  if (!["reasoning", "coding", "document"].includes(classification.kind)) {
    return { enabled: false, reason: `not useful for ${classification.kind} tasks` };
  }
  if (promptChars < MIN_PROMPT_CHARS) {
    return { enabled: false, reason: "the request is too short to need a second model" };
  }
  const peer = routeCollaborator(snapshot, primary, classification, settings);
  if (!peer) return { enabled: false, reason: "no second eligible model is configured" };
  const synthesis = routeCollaborator(snapshot, primary, classification, settings, [peer.key]) ?? peer;
  return { enabled: true, reason: "analysis task with an eligible second model", peer, synthesis };
}

const PEER_SYSTEM = `You are a careful second analyst. Answer the user's request independently and concisely.
State your reasoning and flag anything uncertain. Do not mention that another model is answering in parallel.`;

const SYNTHESIS_SYSTEM = `You compare two independent answers to the same question and report where they actually differ.

Return ONLY JSON in this exact shape:
{"verdict":"agree"|"partial"|"conflict","summary":"one sentence","disputes":[{"topic":"short label","primary":"what answer A says","peer":"what answer B says","resolution":"which is right and why, citing the reasoning given"}],"addendum":"optional short correction or missing point worth appending (max 60 words, empty string if none)"}

Rules:
- Use "agree" only when the answers are compatible on the substance.
- Use "partial" when there are minor differences or one answer adds a point the other omits.
- Use "conflict" only when they contradict each other on a material claim.
- Base the resolution strictly on the reasoning each answer gives. If neither justifies a position, say the point is unresolved.
- Never invent facts or introduce information that is not in either answer.
- Keep disputes to the three most important points.`;

interface PeerResult {
  text: string;
  model: ModelRef;
  provider: ProviderState;
  latencyMs: number;
}

export function startPeer(opts: {
  peer: ModelRef;
  provider: ProviderState;
  messages: UpstreamMessage[];
  settings: AISettings;
  signal: AbortSignal;
}): Promise<PeerResult> {
  const { peer, provider, messages, settings, signal } = opts;
  return (async () => {
    const started = Date.now();
    const res = await postChatCompletion(
      provider.config,
      {
        model: peer.modelId,
        messages: [{ role: "system", content: PEER_SYSTEM }, ...messages],
        stream: false,
        maxTokens: Math.min(settings.maxOutputTokens, PEER_MAX_TOKENS),
        maxCompletionTokens: peer.maxCompletionTokens,
        temperature: 0.2,
      },
      { signal, timeoutMs: Math.min(settings.requestTimeoutMs, 90_000) },
    );
    if (!res.ok) {
      const err = apiError("upstream_unavailable", { details: `peer ${res.status}` });
      reportModelFailure(peer.key, res.status === 429 ? "quota" : "error", 120_000);
      throw err;
    }
    const json: unknown = await res.json();
    const text = extractFullContent(json);
    if (!text.trim()) {
      reportModelFailure(peer.key, "error", 120_000);
      throw apiError("invalid_response", { details: "peer returned no text" });
    }
    reportModelSuccess(peer.key);
    return { text, model: peer, provider, latencyMs: Date.now() - started };
  })();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
}

function coerceDisputes(value: unknown): CollabDispute[] {
  if (!Array.isArray(value)) return [];
  const out: CollabDispute[] = [];
  for (const item of value.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const topic = typeof record.topic === "string" ? record.topic.slice(0, 120) : "";
    const primary = typeof record.primary === "string" ? record.primary.slice(0, 400) : "";
    const peer = typeof record.peer === "string" ? record.peer.slice(0, 400) : "";
    const resolution = typeof record.resolution === "string" ? record.resolution.slice(0, 400) : "";
    if (!topic && !resolution) continue;
    out.push({ topic: topic || "Difference", primary, peer, resolution });
  }
  return out;
}

function coerceVerdict(value: unknown): CollabVerdict {
  return value === "agree" || value === "partial" || value === "conflict" ? value : "unknown";
}

/** Waits for the peer, then runs the synthesis step. Never throws. */
export async function finishCollaboration(opts: {
  plan: CollabPlan;
  peerPromise: Promise<PeerResult>;
  provider: ProviderState;
  synthesisProvider: ProviderState;
  snapshot: RegistrySnapshot;
  userRequest: string;
  draft: string;
  settings: AISettings;
  signal: AbortSignal;
}): Promise<CollabReport> {
  const { plan, peerPromise, synthesisProvider, userRequest, draft, settings, signal } = opts;
  if (!plan.enabled || !plan.peer || !plan.synthesis) {
    return { stage: "skipped", reason: plan.reason };
  }

  const started = Date.now();
  let peer: PeerResult;
  try {
    peer = await peerPromise;
  } catch (err) {
    const message = err instanceof ApiError ? err.code : "error";
    return {
      stage: "skipped",
      peerModel: plan.peer.modelId,
      reason: `the second model could not answer (${message}); this answer is from one model only`,
    };
  }

  try {
    const res = await postChatCompletion(
      synthesisProvider.config,
      {
        model: plan.synthesis.modelId,
        messages: [
          { role: "system", content: SYNTHESIS_SYSTEM },
          {
            role: "user",
            content: [
              "USER REQUEST:",
              truncate(userRequest, 4_000),
              "",
              "ANSWER A (primary):",
              truncate(draft, 6_000),
              "",
              "ANSWER B (independent):",
              truncate(peer.text, 6_000),
              "",
              "Return the JSON report now.",
            ].join("\n"),
          },
        ],
        stream: false,
        maxTokens: Math.min(settings.maxOutputTokens, SYNTHESIS_MAX_TOKENS),
        temperature: 0.1,
      },
      { signal, timeoutMs: Math.min(settings.requestTimeoutMs, 45_000) },
    );

    if (!res.ok) {
      return {
        stage: "partial",
        peerModel: peer.model.modelId,
        peerProvider: peer.provider.config.label,
        reason: `the comparison step failed (HTTP ${res.status}); both answers were produced but not compared`,
        latencyMs: Date.now() - started,
      };
    }

    const json: unknown = await res.json();
    const text = extractFullContent(json);
    const parsed = parseJsonLoose<Record<string, unknown>>(text);
    if (!parsed) {
      return {
        stage: "partial",
        peerModel: peer.model.modelId,
        peerProvider: peer.provider.config.label,
        synthesisModel: plan.synthesis.modelId,
        verdict: "unknown",
        reason: "the comparison reply was not readable JSON",
        latencyMs: Date.now() - started,
      };
    }

    const addendum = typeof parsed.addendum === "string" ? parsed.addendum.trim().slice(0, 600) : "";
    return {
      stage: "done",
      peerModel: peer.model.modelId,
      peerProvider: peer.provider.config.label,
      synthesisModel: plan.synthesis.modelId,
      verdict: coerceVerdict(parsed.verdict),
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : undefined,
      addendum: addendum || undefined,
      disputes: coerceDisputes(parsed.disputes),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError" || signal.aborted;
    return {
      stage: "partial",
      peerModel: peer.model.modelId,
      peerProvider: peer.provider.config.label,
      reason: aborted ? "the comparison step was stopped" : "the comparison step could not be completed",
      latencyMs: Date.now() - started,
    };
  }
}
