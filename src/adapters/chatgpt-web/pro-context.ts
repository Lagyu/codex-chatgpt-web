import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "../../config";
import { parseRequest } from "../../responses/parser";
import type { CodexParsedRequest } from "../../types";
import { ChatGptWebAdapterError } from "./adapter-error";
import { chatGptTurnUserRevisionHistory, extractChatGptTurnIdentity, extractChatGptTurnUserRevision } from "./environment";

// This file implements the Pro policy in docs/adr/0001-pro-context.md. The only persistent state
// is submission identity: never messages, checkpoints, tool results, or reconstructable history.
export function proContextError(message: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 400, errorType: "invalid_request_error", code: "pro_context_unavailable", retryable: false,
  });
}

export const PRO_COMPACTION_DISABLED = "Codex compaction is disabled for Pro. Continue in the retained ChatGPT conversation, or start a new Codex task if that conversation is unavailable.";

/** Native local compaction is a normal Responses request with no compaction_trigger item. */
export function isProCompactionRequest(parsed: CodexParsedRequest): boolean {
  if (parsed._compactionRequest) return true;
  const metadata = (parsed._rawBody as { client_metadata?: Record<string, unknown> } | undefined)
    ?.client_metadata?.["x-codex-turn-metadata"];
  if (typeof metadata !== "string") return false;
  try { return JSON.parse(metadata)?.request_kind === "compaction"; }
  catch { return false; }
}

function rawInput(parsed: CodexParsedRequest): Record<string, unknown>[] {
  const input = (parsed._rawBody as { input?: unknown } | undefined)?.input;
  if (!Array.isArray(input)) throw proContextError("Pro requires native turn metadata and a new user message.");
  return input.filter((item): item is Record<string, unknown> => (
    item !== null && typeof item === "object" && !Array.isArray(item)
  ));
}

function currentInstructionIndex(parsed: CodexParsedRequest): number {
  extractChatGptTurnUserRevision(parsed);
  const revision = chatGptTurnUserRevisionHistory(parsed).at(-1)!;
  const index = rawInput(parsed).findLastIndex(item => (
    (item.type === "agent_message" || (item.type === "message" && item.role === "user"))
    && (revision.itemId !== undefined ? item.id === revision.itemId
      : JSON.stringify(item.content) === JSON.stringify(revision.content))
  ));
  if (index < 0) throw proContextError("Pro requires an identifiable current user message.");
  return index;
}

/** A fresh chat may receive the current task's initial instructions, never an earlier transcript. */
export function proRequestHasHistory(parsed: CodexParsedRequest): boolean {
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  return parsed.previousResponseId !== undefined || rawInput(parsed).some(item => {
    const owner = (item.internal_chat_message_metadata_passthrough as { turn_id?: unknown } | undefined)?.turn_id;
    return (typeof owner === "string" && owner !== turnId)
      || item.role === "assistant"
      || /^(?:reasoning|.*_call|.*_call_output|compaction|compaction_summary|context_compaction)$/.test(String(item.type));
  });
}

/** Local tool outputs must only be delivered to an existing browser response through its broker. */
export function assertProTurnCanStart(parsed: CodexParsedRequest): void {
  const suffix = rawInput(parsed).slice(currentInstructionIndex(parsed) + 1);
  if (suffix.some(item => item.role === "assistant" || item.type !== "message")) {
    throw proContextError("The Pro assistant response is no longer running. Its tool work cannot be reconstructed or replayed. Start a new Codex task.");
  }
}

export function proTurnInput(parsed: CodexParsedRequest, bootstrap = false): CodexParsedRequest {
  if (bootstrap && proRequestHasHistory(parsed)) {
    throw proContextError("Pro cannot initialize a new conversation from Codex history. Start a new Codex task.");
  }
  const input = rawInput(parsed);
  const index = currentInstructionIndex(parsed);
  const current = input[index]!;
  const selected = bootstrap ? input.slice(0, index + 1) : [current];
  const context = parseRequest({ model: parsed.modelId, input: selected }).context;
  return {
    ...parsed,
    _proContext: bootstrap ? "initial" : "continuation",
    context: {
      ...parsed.context,
      systemPrompt: bootstrap ? [...(parsed.context.systemPrompt ?? [])] : [],
      messages: context.messages,
    },
  };
}

function readProAttempts(descriptorPath: string): { path: string; conversations: Record<string, string[]> } {
  const path = join(dirname(descriptorPath), "pro-turn-attempts.json");
  let conversations: Record<string, string[]> = {};
  if (existsSync(path)) {
    try {
      const stored = JSON.parse(readFileSync(path, "utf8"));
      if (stored.version !== 1 || !stored.conversations || typeof stored.conversations !== "object"
        || Array.isArray(stored.conversations)
        || Object.entries(stored.conversations).some(([key, turns]) => (
          !/^[a-f0-9]{64}$/.test(key) || !Array.isArray(turns)
          || turns.some(turn => typeof turn !== "string" || !/^[a-f0-9]{64}$/.test(turn))
        ))) throw new Error("Invalid Pro submission identity store");
      conversations = stored.conversations;
    } catch (cause) {
      throw proContextError(`Pro submission identity is unavailable; refusing recovery (${cause instanceof Error ? cause.message : String(cause)}).`);
    }
  }
  return { path, conversations };
}

export function proTurnWasAttempted(descriptorPath: string, threadKey: string, turnId: string): boolean {
  return (readProAttempts(descriptorPath).conversations[threadKey] ?? [])
    .includes(createHash("sha256").update(turnId).digest("hex"));
}

/** An atomic, content-free tombstone prevents resubmission after a daemon restart or session expiry. */
export function claimProTurn(descriptorPath: string, threadKey: string, turnId: string): boolean {
  const { path, conversations } = readProAttempts(descriptorPath);
  const turns = conversations[threadKey] ?? [];
  const turn = createHash("sha256").update(turnId).digest("hex");
  if (turns.includes(turn)) {
    throw proContextError("This Pro turn was already started and its live response is unavailable. Automatic recovery and resubmission are disabled. Start a new Codex task.");
  }
  conversations[threadKey] = [...turns, turn];
  atomicWriteFile(path, `${JSON.stringify({ version: 1, conversations })}\n`);
  return turns.length > 0;
}
