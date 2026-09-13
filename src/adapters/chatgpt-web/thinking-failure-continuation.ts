import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import { assertRegularChatPage, CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_USER_TURN_SELECTOR } from "../../chatgpt-session";

// ADR-0008: a finite per-native-turn budget replaces the response-duration gate in ADR-0007.
export const THINKING_FAILURE_MAX_CONTINUATIONS = 5;
export const THINKING_FAILURE_SETTLEMENT_MS = 120_000;

export function thinkingFailureRetryDelayMs(attempt: number): number {
  return Math.min(60_000, 5_000 * 2 ** (attempt - 1));
}

export const THINKING_FAILURE_CONTINUATION_PROMPT =
  'Your previous response ended with "Thinking failed." Please continue the original task '
  + 'from this conversation and the current workspace. Check completed work and any running '
  + 'jobs before taking further actions, so nothing is duplicated. Then continue toward the '
  + 'original objective with the same freedom to explore deeply.';

export interface ThinkingFailureContinuationRequest {
  responseIdentity: string;
  elapsedMs: number;
  /** One-based continuation within this native turn; tool-result rounds do not reset it. */
  attempt: number;
  /** Broker revision that proved all previous tool requests had settled. */
  revision?: number;
}

export function assertThinkingFailureContinuationRequest(request: ThinkingFailureContinuationRequest): void {
  if (typeof request.responseIdentity !== "string" || !request.responseIdentity.trim() || !Number.isFinite(request.elapsedMs)
    || request.elapsedMs < 0 || !Number.isSafeInteger(request.attempt)
    || request.attempt < 1 || request.attempt > THINKING_FAILURE_MAX_CONTINUATIONS
    || (request.revision !== undefined && (!Number.isSafeInteger(request.revision) || request.revision < 0))) {
    throw new Error("Thinking failed continuation requires a valid attempt (1–5), elapsed duration and tool state");
  }
}

export class ThinkingFailureContinuationGate {
  private acceptedAt?: number;
  private readonly claimedResponses = new Set<string>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  submitted(): void {
    this.acceptedAt = this.now();
  }

  get exhausted(): boolean {
    return this.claimedResponses.size >= THINKING_FAILURE_MAX_CONTINUATIONS;
  }

  claim(responseIdentity: string): ThinkingFailureContinuationRequest | undefined {
    if (this.acceptedAt === undefined || this.exhausted || this.claimedResponses.has(responseIdentity)) return undefined;
    const elapsedMs = this.now() - this.acceptedAt;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return undefined;
    const request = { responseIdentity, elapsedMs, attempt: this.claimedResponses.size + 1 };
    assertThinkingFailureContinuationRequest(request);
    this.claimedResponses.add(responseIdentity);
    return request;
  }
}

// A host surface marker is reinstalled on reload. This nonce belongs to the accepted document
// only, so a same-page CDP rebind is safe but a navigation/reload cannot inherit recovery rights.
export async function captureThinkingFailureDocument(page: Page): Promise<string> {
  const nonce = randomUUID();
  await page.evaluate(value => {
    (globalThis as typeof globalThis & { __CODEX_WEB_GPT_CONTINUATION_DOCUMENT__?: string })
      .__CODEX_WEB_GPT_CONTINUATION_DOCUMENT__ = value;
  }, nonce);
  return nonce;
}

export async function assertThinkingFailureConversation(
  page: Page, documentNonce: string, responseIdentity: string, acceptedTurnIdentities: readonly string[],
): Promise<void> {
  await assertRegularChatPage(page);
  const issue = await page.evaluate(options => {
    const scope = globalThis as typeof globalThis & { __CODEX_WEB_GPT_CONTINUATION_DOCUMENT__?: string };
    if (scope.__CODEX_WEB_GPT_CONTINUATION_DOCUMENT__ !== options.documentNonce) return "document replaced";
    const identities = (selector: string, attribute: string) => [...document.querySelectorAll(selector)]
      .map(element => element.getAttribute(attribute));
    const users = identities(options.userSelector, "data-turn-id");
    const responses = identities(options.responseSelector, "data-turn-id");
    const turns = [...document.querySelectorAll("[data-turn-id-container]")]
      .filter(element => element.parentElement?.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container")
        !== element.getAttribute("data-turn-id-container"))
      .map(element => element.getAttribute("data-turn-id-container"));
    for (const group of [users, responses, turns]) {
      if (group.some(id => !id)
        || new Set(group).size !== group.length) return "conversation messages changed";
    }
    // Older history can hydrate/virtualize during a long response. Require the accepted latest
    // user and exact current answer, without rejecting unrelated older DOM materialization.
    if (!users.length || !options.acceptedTurnIdentities.includes(users.at(-1)!)) return "conversation messages changed";
    if (responses.at(-1) !== options.responseIdentity || turns.at(-1) !== options.responseIdentity
      || responses.filter(id => id === options.responseIdentity).length !== 1
      || [...users, ...responses].some(id => !turns.includes(id))) return "failed response is no longer current";
    return undefined;
  }, { documentNonce, responseIdentity, acceptedTurnIdentities: [...acceptedTurnIdentities],
    userSelector: CHATGPT_USER_TURN_SELECTOR, responseSelector: CHATGPT_ASSISTANT_TURN_SELECTOR });
  if (issue) throw new Error(`The failed response's retained conversation changed (${issue}); automatic continuation stopped`);
}

export function thinkingFailureContinuationPrompt(turnToken?: string): string {
  if (turnToken === undefined) return THINKING_FAILURE_CONTINUATION_PROMPT;
  if (!/^turn_[A-Za-z0-9_-]{24,}$/.test(turnToken)) throw new Error("Invalid continuation tool capability");
  return `${THINKING_FAILURE_CONTINUATION_PROMPT}\n\n<codex_native_continuation>\n`
    + "This is a continuation of the same Codex task. Keep its existing instructions and tool contract.\n"
    + "The previous response's tool handles have been retired. Use this fresh turn_token for all Codex Native calls:\n"
    + `${turnToken}\n`
    + "</codex_native_continuation>";
}
