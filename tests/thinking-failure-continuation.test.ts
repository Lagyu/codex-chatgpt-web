import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptBrowserWorker, type BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { resolveChatGptWebModelMode } from "../src/adapters/chatgpt-web/model";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import {
  THINKING_FAILURE_MIN_RESPONSE_MS as HOUR,
  THINKING_FAILURE_CONTINUATION_PROMPT,
  ThinkingFailureContinuationGate,
  assertThinkingFailureContinuationRequest,
  thinkingFailureContinuationPrompt,
} from "../src/adapters/chatgpt-web/thinking-failure-continuation";

test("continuation requires strictly more than 60 minutes since this response was accepted", () => {
  let now = 0;
  const gate = new ThinkingFailureContinuationGate(() => now);
  expect(gate.claim("never-submitted")).toBeUndefined();
  gate.submitted();
  for (now of [0, HOUR - 1, HOUR]) expect(gate.claim("first")).toBeUndefined();
  now = HOUR + 1;
  expect(gate.claim("first")).toEqual({ responseIdentity: "first", elapsedMs: HOUR + 1 });
  expect(gate.claim("first")).toBeUndefined();
  gate.submitted();
  now += 10_000;
  expect(gate.claim("quick-failure")).toBeUndefined();
  now += HOUR;
  expect(gate.claim("next-long-response")?.elapsedMs).toBe(HOUR + 10_000);
});

test("invalid continuation timing and capabilities are rejected and the prompt contains no replayed context", () => {
  for (const elapsedMs of [-1, 0, HOUR, NaN, Infinity]) {
    expect(() => assertThinkingFailureContinuationRequest({ responseIdentity: "current", elapsedMs })).toThrow();
  }
  const token = `turn_${"n".repeat(32)}`;
  expect(thinkingFailureContinuationPrompt()).toBe(THINKING_FAILURE_CONTINUATION_PROMPT);
  const prompt = thinkingFailureContinuationPrompt(token);
  expect(prompt).toContain(token);
  expect(prompt).toContain("previous response's tool handles have been retired");
  expect(prompt).not.toContain("codex_context_json");
  expect(() => thinkingFailureContinuationPrompt("arbitrary\ntext")).toThrow();
});

test("response capability rotation preserves the owner, settles tools once and rejects old claims and bindings", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-cont-"));
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "exec_command", description: "Run", parameters: { type: "object" } }] };
  try {
    const owner = await broker.register(environment, undefined, "continued-task");
    const other = await broker.register(environment, undefined, "other-task");
    const first = await callTurnBroker<{ bindingId: string; activityId: string }>(socket, { method: "claim", token: owner });
    const result = callTurnBroker(socket, { method: "invoke", bindingId: first.bindingId,
      wireName: "exec_command", arguments: { cmd: "original action" } });
    const batch = await broker.nextToolBatch(owner);
    expect(batch).toHaveLength(1);
    expect(broker.continueResponse(owner, 0)).toBeUndefined();
    broker.completeTool(owner, batch[0]!.callId, { content: [], structuredContent: { done: true } });
    await expect(result).resolves.toMatchObject({ structuredContent: { done: true } });
    // A delivered result alone does not prove the surrounding MCP request has settled.
    expect(broker.beginCompletionFence(owner)).toBeUndefined();
    await callTurnBroker(socket, { method: "activity_complete", token: owner, activityId: first.activityId });
    const revision = broker.beginCompletionFence(owner)!;
    const rotated = await callTurnBroker<{ token: string }>(socket, { method: "owner_continue_response", token: owner, revision });
    expect(rotated.token).not.toBe(owner);
    expect(broker.continueResponse(owner, revision)).toBeUndefined();
    expect(broker.commitCompletionFence(owner, revision)).toBeFalse();
    await expect(callTurnBroker(socket, { method: "claim", token: owner })).rejects.toThrow("has already finished");
    await expect(callTurnBroker(socket, { method: "invoke", bindingId: first.bindingId,
      wireName: "exec_command", arguments: { cmd: "duplicate original action" } })).rejects.toThrow("has already finished");
    const next = await callTurnBroker<{ bindingId: string; activityId: string; environment: unknown }>(socket, {
      method: "claim", token: rotated.token,
    });
    expect(next.environment).toMatchObject(environment);
    const nextResult = callTurnBroker(socket, { method: "invoke", bindingId: next.bindingId,
      wireName: "exec_command", arguments: { cmd: "inspect remaining work" } });
    const nextBatch = await broker.nextToolBatch(owner);
    expect(nextBatch.map(call => call.arguments?.cmd)).toEqual(["inspect remaining work"]);
    broker.completeTool(owner, nextBatch[0]!.callId, { content: [] });
    await nextResult;
    await callTurnBroker(socket, { method: "activity_complete", token: rotated.token, activityId: next.activityId });
    expect(broker.commitCompletionFence(owner, broker.beginCompletionFence(owner)!)).toBeTrue();
    await expect(callTurnBroker(socket, { method: "claim", token: rotated.token })).rejects.toThrow("has already finished");
    broker.revoke(owner);
    await expect(callTurnBroker(socket, { method: "claim", token: rotated.token })).rejects.toThrow("has already finished");
    await expect(callTurnBroker(socket, { method: "claim", token: other })).resolves.toHaveProperty("bindingId");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("late activity invalidates continuation, repeated rotation retires each token, and Zero Risk cannot rotate", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-continuation-race-"));
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const environment = { cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [] };
  try {
    const owner = await broker.register(environment);
    const revision = broker.beginCompletionFence(owner)!;
    const late = await callTurnBroker<{ activityId: string }>(broker.socketPath, { method: "claim", token: owner });
    await callTurnBroker(broker.socketPath, { method: "activity_complete", token: owner, activityId: late.activityId });
    expect(broker.continueResponse(owner, revision)).toBeUndefined();
    const first = broker.continueResponse(owner, broker.beginCompletionFence(owner)!)!;
    const second = broker.continueResponse(owner, broker.beginCompletionFence(owner)!)!;
    expect(first).not.toBe(second);
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token: first })).rejects.toThrow("has already finished");
    expect((broker as any).continuationTokens.size).toBe(1);
    broker.revoke(owner);
    expect((broker as any).continuationTokens.size).toBe(0);
    const manual = await broker.registerSafe(environment, "nonce_for_manual_turn_0123456789");
    expect(() => broker.continueResponse(manual, 0)).toThrow("cannot automatically continue");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

interface WorkerOptions {
  durations: number[];
  tools?: boolean;
  partial?: boolean;
  maintenance?: boolean;
  compaction?: boolean;
  changedConversation?: boolean;
  abortStage?: string;
  ambiguousSend?: boolean;
  pendingTool?: boolean;
  settlementNeverCompletes?: boolean;
  genericFailure?: boolean;
}

async function exerciseWorker(options: WorkerOptions) {
  const root = mkdtempSync(join(tmpdir(), "cgw-thinking-worker-"));
  const controller = new AbortController();
  const stageController = new AbortController();
  const progress = options.tools ? new ChatGptExternalTurnProgress() : undefined;
  const capabilities = { localToolsEnabled: options.tools === true, solAvailable: true, proAvailable: true };
  const actions: string[] = [];
  const emitted: string[] = [];
  const continuations: string[] = [];
  let accepted = 0;
  let now = 0;
  let acceptedAt = 0;
  let stage = "";
  let url = "https://chatgpt.com/c/original-conversation";
  let released = false;
  let pendingRevision: number | undefined;
  let activeResponse = "";
  const absent: any = {
    last() { return this; }, filter() { return this; }, getByText() { return this; }, getByTestId() { return this; },
    isVisible: async () => false,
  };
  const page = { url: () => url, evaluate: async () => ({}), isClosed: () => false, locator: () => absent };
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Native2", browserDiagnosticsPath: root, browserHostDescriptorPath: "owned-descriptor" },
    runStage: async (_trace: string, name: string, _budget: number, action: (signal: AbortSignal) => Promise<unknown>) => {
      stage = name;
      actions.push(name);
      if (name === "browser_page") return page;
      if (name === options.abortStage) controller.abort();
      return action(stageController.signal);
    },
    prepareRegularChatSurface: async () => {},
    selectModelAndEffort: async (_page: unknown, model: string, effort: string) => resolveChatGptWebModelMode(model, effort, capabilities),
    captureSubmissionBaseline: async () => ({ initialTurnIdentities: Array.from({ length: accepted }, (_, i) => `response-${i + 1}`) }),
    attachPromptWithCompactionRetry: async () => {},
    attachPrompt: async (_page: unknown, text: string) => { continuations.push(text); },
    attachFiles: async () => {},
    sendAttachedPrompt: async (...args: any[]) => {
      if (stage === "continuation_send" && options.ambiguousSend) throw new Error("ambiguous submission");
      await args[5]?.onSendActivated?.();
      accepted += 1;
      acceptedAt = now;
      args[5]?.onSubmitted?.();
      return "generation_running";
    },
    waitForNewAssistantTurn: async () => {
      activeResponse = `response-${accepted}`;
      return { identity: activeResponse, locator: absent, acceptedTurnIdentities: [activeResponse] };
    },
    responseDomSnapshot: async () => {
      const failed = accepted <= options.durations.length;
      now = acceptedAt + (options.durations[accepted - 1] ?? 0);
      if (options.genericFailure && failed) throw new Error("independent connection failure");
      if (options.pendingTool && failed && progress && pendingRevision === undefined) pendingRevision = progress.recordToolBatch(1);
      const text = failed ? options.partial ? `Progress ${accepted}` : "" : "Done";
      return { responsePresent: true, thinkingFailedVisible: failed, stoppedThinkingVisible: false,
        visibleText: text, completionActionVisible: !failed, fullHtml: `<p>${text}</p>`, traceBlocks: [],
        markdownSegments: text ? [{ key: `answer-${accepted}`, html: `<p>${text}</p>`, text, streamable: true }] : [] };
    },
  });
  if (progress) {
    const acknowledge = progress.acknowledgeToolBatch.bind(progress);
    progress.acknowledgeToolBatch = async revision => {
      actions.push("acknowledge-existing-batch");
      await acknowledge(revision);
      if (progress.snapshot().activeToolCalls) progress.recordToolResult();
    };
  }
  const monotonic = spyOn(performance, "now").mockImplementation(() => now);
  try {
    let result: string | undefined;
    let error: unknown;
    const turn: BrowserTurn = {
      traceId: "long-thinking-fixture", modelId: "gpt-5.6-sol", reasoning: options.compaction ? "high" : "max", capabilities,
      conversationKey: "a".repeat(64), retainConversation: true, abortSignal: controller.signal,
      compaction: options.compaction,
      prepare: async () => ({ text: "Original task", images: [], release: () => { released = true; } }),
      onTextDelta: delta => emitted.push(delta),
      externalProgress: progress,
      completionFence: progress ? {
        begin: async () => {
          if (options.settlementNeverCompletes && stage === "thinking_failure_settlement") {
            stageController.abort();
            return undefined;
          }
          return progress.snapshot().activeToolCalls ? undefined : progress.snapshot().revision;
        },
        commit: async () => true,
      } : undefined,
      prepareThinkingFailureContinuation: async request => {
        assertThinkingFailureContinuationRequest(request);
        actions.push("prepare-continuation");
        if (options.changedConversation) url = "https://chatgpt.com/c/different-conversation";
        return THINKING_FAILURE_CONTINUATION_PROMPT;
      },
    };
    try { result = await worker.runBrowserTurn(turn, "owned-surface", options.maintenance ? page : undefined); }
    catch (caught) { error = caught; }
    return { result, error, actions, emitted: emitted.join(""), continuations, accepted, released };
  } finally {
    monotonic.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}

test("a long failure continues in place and preserves streamed partial prose across two new response identities", async () => {
  const outcome = await exerciseWorker({ durations: [HOUR + 1, HOUR + 2], partial: true, tools: true, pendingTool: true });
  expect(outcome.error).toBeUndefined();
  expect(outcome.accepted).toBe(3);
  expect(outcome.continuations).toEqual([THINKING_FAILURE_CONTINUATION_PROMPT, THINKING_FAILURE_CONTINUATION_PROMPT]);
  expect(outcome.result).toBe("Progress 1\n\nProgress 2\n\nDone");
  expect(outcome.emitted).toBe(outcome.result!);
  expect(outcome.actions.indexOf("acknowledge-existing-batch")).toBeLessThan(outcome.actions.indexOf("prepare-continuation"));
  expect(outcome.actions.filter(action => action === "browser_page")).toHaveLength(1);
  expect(outcome.released).toBeTrue();
});

for (const duration of [HOUR - 1, HOUR]) test(`a failure at ${duration}ms sends no continuation`, async () => {
  const result = await exerciseWorker({ durations: [duration] });
  expect(result.error).toMatchObject({ code: "chatgpt_thinking_failed", retryable: false });
  expect(result.continuations).toHaveLength(0);
});

test("a quick failure after a long recovered response ends the task without another continuation", async () => {
  const result = await exerciseWorker({ durations: [HOUR + 1, 10_000] });
  expect(result.error).toMatchObject({ code: "chatgpt_thinking_failed", retryable: false });
  expect(result.accepted).toBe(2);
  expect(result.continuations).toHaveLength(1);
});

for (const options of [{ maintenance: true }, { compaction: true }, { genericFailure: true }]) {
  test(`no continuation outside the eligible final response: ${JSON.stringify(options)}`, async () => {
    const result = await exerciseWorker({ durations: [HOUR + 1], ...options });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.continuations).toHaveLength(0);
  });
}

for (const options of [{ changedConversation: true }, { abortStage: "continuation_effort" },
  { abortStage: "thinking_failure_settlement" }, { tools: true, settlementNeverCompletes: true }]) {
  test(`interrupted or unverified recovery never submits: ${JSON.stringify(options)}`, async () => {
    const result = await exerciseWorker({ durations: [HOUR + 1], ...options });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.accepted).toBe(1);
    expect(result.continuations).toHaveLength(0);
  });
}

test("an ambiguous continuation submission is never sent a second time", async () => {
  const result = await exerciseWorker({ durations: [HOUR + 1], ambiguousSend: true });
  expect(result.error).toMatchObject({ message: "ambiguous submission" });
  expect(result.actions.filter(action => action === "continuation_send")).toHaveLength(1);
});
