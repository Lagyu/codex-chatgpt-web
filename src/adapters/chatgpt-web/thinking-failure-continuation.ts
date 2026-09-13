// ADR-0007: each failed response must independently exceed this duration. A long initial
// response never authorizes retries of short-lived continuation responses.
export const THINKING_FAILURE_MIN_RESPONSE_MS = 60 * 60 * 1_000;
export const THINKING_FAILURE_SETTLEMENT_MS = 120_000;

export const THINKING_FAILURE_CONTINUATION_PROMPT =
  'Your previous response ended with "Thinking failed." Please continue the original task '
  + 'from this conversation and the current workspace. Check completed work and any running '
  + 'jobs before taking further actions, so nothing is duplicated. Then continue toward the '
  + 'original objective with the same freedom to explore deeply.';

export interface ThinkingFailureContinuationRequest {
  responseIdentity: string;
  elapsedMs: number;
  /** Broker revision that proved all previous tool requests had settled. */
  revision?: number;
}

export function assertThinkingFailureContinuationRequest(request: ThinkingFailureContinuationRequest): void {
  if (typeof request.responseIdentity !== "string" || !request.responseIdentity.trim() || !Number.isFinite(request.elapsedMs)
    || request.elapsedMs <= THINKING_FAILURE_MIN_RESPONSE_MS
    || (request.revision !== undefined && (!Number.isSafeInteger(request.revision) || request.revision < 0))) {
    throw new Error("Thinking failed continuation requires a response longer than 60 minutes and valid tool state");
  }
}

export class ThinkingFailureContinuationGate {
  private acceptedAt?: number;
  private readonly claimedResponses = new Set<string>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  submitted(): void {
    this.acceptedAt = this.now();
  }

  claim(responseIdentity: string): ThinkingFailureContinuationRequest | undefined {
    if (this.acceptedAt === undefined || this.claimedResponses.has(responseIdentity)) return undefined;
    const elapsedMs = this.now() - this.acceptedAt;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= THINKING_FAILURE_MIN_RESPONSE_MS) return undefined;
    const request = { responseIdentity, elapsedMs };
    assertThinkingFailureContinuationRequest(request);
    this.claimedResponses.add(responseIdentity);
    return request;
  }
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
