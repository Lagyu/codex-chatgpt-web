import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isChatGptWebProModel } from "../src/chatgpt-web-models";
import { ChatGptBrowserWorker, assertChatGptWebInputWithinLimits, type BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptWebExecutionNamespace, createChatGptWebAdapter } from "../src/adapters/chatgpt-web";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { claimProTurn, proTurnInput, proTurnWasAttempted } from "../src/adapters/chatgpt-web/pro-context";
import { chatGptTurnExecutionKey, chatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { resolveBiggerContextMultipartParts } from "../src/adapters/chatgpt-web/usage";
import { parseRequest } from "../src/responses/parser";
import type { AdapterEvent, CodexParsedRequest, CodexProviderConfig } from "../src/types";
import { defaultConfig, providerConfig } from "../src/config";
import { responseRequest } from "../src/server";
import { expandPreviousResponseInput } from "../src/responses/state";
import { THINKING_FAILURE_MIN_RESPONSE_MS } from "../src/adapters/chatgpt-web/thinking-failure-continuation";

const root = mkdtempSync(join(tmpdir(), "cgw-pro-context-"));
const capabilities = { localToolsEnabled: true, proAvailable: true, solAvailable: true };
afterAll(() => { chatGptTurnSessions.clear(); rmSync(root, { recursive: true, force: true }); });

function user(text: string, turnId: string) {
  return { type: "message", role: "user", content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId } };
}

function request(turnId = "first", input?: unknown[]): CodexParsedRequest {
  return parseRequest({
    model: "gpt-5.6-sol", stream: true, instructions: "INITIAL_SYSTEM_INSTRUCTIONS",
    reasoning: { effort: "max" },
    tools: [{ type: "function", name: "exec_command", description: "Run a command", parameters: { type: "object" } }],
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: root, turn_id: turnId }) },
    input: input ?? [
      { type: "message", role: "developer", content: "INITIAL_DEVELOPER_INSTRUCTIONS" },
      user(`<environment_context><cwd>${root}</cwd><filesystem><workspace_roots><root>${root}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem></environment_context>`, turnId),
      user("NEW_USER_INSTRUCTION", turnId),
    ],
  });
}

function provider(name: string, localToolsEnabled = true): CodexProviderConfig {
  const directory = mkdtempSync(join(root, `${name}-`));
  return { adapter: "chatgpt-web", baseUrl: `browser://${directory}`, chatgptWeb: {
    browserHost: "launcher", browserHostDescriptorPath: join(directory, "launcher.json"),
    threadEnvironmentStatePath: join(directory, "environments.json"),
    brokerSocketPath: join(directory, "broker.sock"),
    localToolsEnabled, proAvailable: true, solAvailable: true, experimentalBiggerContext: true,
  } };
}

function detachMockRelease(config: CodexProviderConfig, parsed: CodexParsedRequest): void {
  const session = chatGptTurnSessions.find(`${chatGptWebExecutionNamespace(config)}:${chatGptTurnExecutionKey(parsed)}`);
  if (session) session.runtime.releaseRetainedConversation = async () => {};
}

test("Pro selection is independent of the subscription and covers automatic and manual Pro", () => {
  for (const model of ["chatgpt-web/pro", "chatgpt-web/zero-risk-pro", "chatgpt-web-zero-risk-pro"]) {
    expect(isChatGptWebProModel(model)).toBeTrue();
  }
  expect(isChatGptWebProModel("gpt-5.6-sol", "max")).toBeTrue();
  expect(isChatGptWebProModel("gpt-5.6-sol", "xhigh")).toBeFalse();
  expect(isChatGptWebProModel("gpt-5.6-luna", "max")).toBeFalse();
});

test("Pro bootstraps only a fresh task and subsequent prompts contain only the new instruction", () => {
  const initial = request();
  const seeded = compileChatGptWebPrompt(proTurnInput(initial, true), capabilities, "turn_test");
  expect(seeded.text).toContain("INITIAL_SYSTEM_INSTRUCTIONS");
  expect(seeded.text).toContain("INITIAL_DEVELOPER_INSTRUCTIONS");
  const history = (initial._rawBody as { input: unknown[] }).input;
  const followup = request("second", [...history,
    { type: "message", role: "assistant", content: "OLD_ASSISTANT_SECRET" },
    { type: "function_call_output", call_id: "old", output: "OLD_TOOL_SECRET" },
    user("ONLY_NEW_MESSAGE", "second"),
  ]);
  const compiled = compileChatGptWebPrompt(followup, capabilities, "turn_new");
  expect(compiled.text).toContain("ONLY_NEW_MESSAGE");
  for (const old of ["INITIAL_SYSTEM_INSTRUCTIONS", "INITIAL_DEVELOPER_INSTRUCTIONS", "OLD_ASSISTANT_SECRET", "OLD_TOOL_SECRET", "NEW_USER_INSTRUCTION"]) {
    expect(compiled.text).not.toContain(old);
  }
  expect(compiled.multipart).toBeUndefined();
  expect(() => proTurnInput(followup, true)).toThrow("cannot initialize");
  const control = { ...followup, options: { reasoning: "high" } };
  expect(compileChatGptWebPrompt(control, capabilities, "turn_control").text).toContain("OLD_ASSISTANT_SECRET");
});

test("Pro rejects explicit compaction and multipart even with Bigger Context enabled", () => {
  const parsed = request();
  expect(resolveBiggerContextMultipartParts(parsed, capabilities)).toBeUndefined();
  for (const parts of [2, 3] as const) {
    expect(() => compileChatGptWebPrompt(parsed, capabilities, "turn_test", { experimentalMultipartParts: parts })).toThrow("staging");
  }
  expect(() => compileChatGptWebPrompt({ ...parsed, _compactionRequest: true }, capabilities, "turn_test")).toThrow("compaction is disabled");
  expect(() => assertChatGptWebInputWithinLimits(200_000, 200_000, parsed.modelId, "max", capabilities)).toThrow("Shorten the new input");
});

test("submission tombstones survive new readers and contain no reconstructable context", () => {
  const config = provider("tombstones");
  const descriptor = config.chatgptWeb!.browserHostDescriptorPath!;
  const key = createHash("sha256").update("thread").digest("hex");
  expect(claimProTurn(descriptor, key, "private-turn-id")).toBeFalse();
  expect(proTurnWasAttempted(descriptor, key, "private-turn-id")).toBeTrue();
  expect(() => claimProTurn(descriptor, key, "private-turn-id")).toThrow("already started");
  expect(claimProTurn(descriptor, key, "next-turn-id")).toBeTrue();
  expect(readFileSync(join(descriptor, "..", "pro-turn-attempts.json"), "utf8")).not.toContain("private-turn-id");
});

for (const tools of [false, true]) test(`Pro retains one incremental message per turn (local tools: ${tools})`, async () => {
  const config = provider("incremental", tools);
  const worker = ChatGptBrowserWorker.forProvider(config);
  const original = worker.run;
  const prompts: string[] = [];
  const retained: Array<boolean | undefined> = [];
  worker.run = async turn => {
    retained.push(turn.requireRetainedConversation);
    expect(turn.retainConversation).toBeTrue();
    const prepared = prompts.length === 0 ? await turn.prepare() : await turn.prepareResume!();
    expect(prepared.multipart).toBeUndefined();
    prompts.push(prepared.text);
    prepared.release();
    turn.onTextDelta("WEB_RETAINED_ANSWER");
    return "WEB_RETAINED_ANSWER";
  };
  const first = request();
  const second = request("second", [...(first._rawBody as { input: unknown[] }).input,
    { type: "message", role: "assistant", content: "WEB_RETAINED_ANSWER" }, user("FOLLOWUP_ONLY", "second")]);
  try {
    for (const parsed of [first, second]) {
      const events: AdapterEvent[] = [];
      await createChatGptWebAdapter(config).runTurn!(parsed, { headers: new Headers() }, event => events.push(event));
      expect(events.at(-1)).toMatchObject({ type: "done", endTurn: true });
      detachMockRelease(config, parsed);
    }
    expect(prompts).toHaveLength(2);
    expect(retained).toEqual([undefined, true]);
    expect(prompts[1]).toContain("FOLLOWUP_ONLY");
    expect(prompts[1]).not.toContain("WEB_RETAINED_ANSWER");
    expect(prompts[1]).not.toContain("INITIAL_SYSTEM_INSTRUCTIONS");
    chatGptTurnSessions.clear();
    const lost: AdapterEvent[] = [];
    await createChatGptWebAdapter(config).runTurn!(second, { headers: new Headers() }, event => lost.push(event));
    expect(lost.at(-1)).toMatchObject({ type: "error", retryable: false });
    expect(prompts).toHaveLength(2);
  } finally {
    worker.run = original;
    await TurnBroker.forSocket(config.chatgptWeb!.brokerSocketPath!).close();
  }
});

test("multiple MCP rounds with history-free Responses deltas stay in one Pro assistant response", async () => {
  const config = provider("tool-deltas");
  const socket = config.chatgptWeb!.brokerSocketPath!;
  const worker = ChatGptBrowserWorker.forProvider(config);
  const original = worker.run;
  let submissions = 0;
  worker.run = async (turn: BrowserTurn) => {
    submissions += 1;
    const prepared = await turn.prepare();
    const token = prepared.text.match(/turn_token (turn_[A-Za-z0-9_-]+)/)![1]!;
    const { bindingId } = await callTurnBroker<{ bindingId: string }>(socket, { method: "claim", token });
    prepared.release();
    for (let index = 0; index < 2; index += 1) {
      const progress = turn.externalProgress!;
      const previous = progress.snapshot().lastToolBatchRevision;
      const invocation = callTurnBroker<BrokerToolResult>(socket, {
        method: "invoke", bindingId, wireName: "exec_command", freeform: false,
        arguments: { cmd: `evidence-${index}`, workdir: root },
      }, 10_000);
      let snapshot = progress.snapshot();
      while (snapshot.lastToolBatchRevision <= previous) snapshot = await progress.waitForChange(snapshot.revision, turn.abortSignal);
      await progress.acknowledgeToolBatch(snapshot.lastToolBatchRevision);
      const result = await invocation;
      expect(result.structuredContent).toMatchObject({ exit_code: 0 });
    }
    turn.onTextDelta("Completed both native calls inside one response.");
    return "Completed both native calls inside one response.";
  };
  const first = request();
  let current = first;
  let initialTokens: number | undefined;
  try {
    for (let round = 0; round < 3; round += 1) {
      const events: AdapterEvent[] = [];
      await createChatGptWebAdapter(config).runTurn!(current, { headers: new Headers() }, event => events.push(event));
      detachMockRelease(config, first);
      const done = events.at(-1);
      expect(done?.type).toBe("done");
      if (done?.type !== "done") throw new Error(JSON.stringify(events));
      initialTokens ??= done.usage!.inputTokens;
      expect(done.usage!.inputTokens).toBe(initialTokens);
      expect(done.endTurn).toBe(round === 2);
      if (round === 2) break;
      const call = events.find((event): event is Extract<AdapterEvent, { type: "tool_call_start" }> => event.type === "tool_call_start")!;
      current = parseRequest({ ...(first._rawBody as object), previous_response_id: `uncached-${round}`,
        input: [{ type: "function_call_output", call_id: call.id,
          output: JSON.stringify({ output: "large native evidence ".repeat(30_000), exit_code: 0 }) }],
      });
    }
    expect(submissions).toBe(1);
  } finally {
    worker.run = original;
    chatGptTurnSessions.clear();
    await TurnBroker.forSocket(socket).close();
  }
}, 20_000);

test("long failed Pro response continues through the same native owner without replaying a prompt or tool", async () => {
  const config = provider("continued");
  const socket = config.chatgptWeb!.brokerSocketPath!;
  const broker = TurnBroker.forSocket(socket);
  const worker = ChatGptBrowserWorker.forProvider(config);
  const original = worker.run;
  let browserRuns = 0;
  const prompts: string[] = [];
  const executed: string[] = [];
  worker.run = async turn => {
    browserRuns += 1;
    const prepared = await turn.prepare();
    prompts.push(prepared.text);
    const owner = prepared.text.match(/turn_token (turn_[A-Za-z0-9_-]+)/)![1]!;
    prepared.release();
    let token = owner;
    for (let response = 0; response < 2; response += 1) {
      const claim = await callTurnBroker<{ bindingId: string; activityId: string }>(socket, { method: "claim", token });
      const progress = turn.externalProgress!;
      const previous = progress.snapshot().lastToolBatchRevision;
      const invocation = callTurnBroker<BrokerToolResult>(socket, {
        method: "invoke", bindingId: claim.bindingId, wireName: "exec_command",
        arguments: { cmd: response === 0 ? "original-action" : "inspect-and-finish", workdir: root },
      }, 10_000);
      let snapshot = progress.snapshot();
      while (snapshot.lastToolBatchRevision <= previous) snapshot = await progress.waitForChange(snapshot.revision, turn.abortSignal);
      await progress.acknowledgeToolBatch(snapshot.lastToolBatchRevision);
      expect((await invocation).structuredContent).toMatchObject({ exit_code: 0 });
      await callTurnBroker(socket, { method: "activity_complete", token, activityId: claim.activityId });
      if (response === 0) {
        const continuation = await turn.prepareThinkingFailureContinuation!({
          responseIdentity: "long-failed-response", elapsedMs: THINKING_FAILURE_MIN_RESPONSE_MS + 1,
          revision: await turn.completionFence!.begin(),
        });
        expect(continuation).toBeDefined();
        prompts.push(continuation!);
        token = continuation!.match(/turn_[A-Za-z0-9_-]{24,}/)![0]!;
        expect(token).not.toBe(owner);
        await expect(callTurnBroker(socket, { method: "claim", token: owner })).rejects.toThrow("has already finished");
      }
    }
    turn.onTextDelta("Completed after continuing the long failed response.");
    return "Completed after continuing the long failed response.";
  };
  const first = request("continuation");
  let current = first;
  try {
    for (let round = 0; round < 3; round += 1) {
      const events: AdapterEvent[] = [];
      await createChatGptWebAdapter(config).runTurn!(current, { headers: new Headers() }, event => events.push(event));
      detachMockRelease(config, first);
      expect(events.at(-1)).toMatchObject({ type: "done", endTurn: round === 2 });
      if (round === 2) break;
      const call = events.find((event): event is Extract<AdapterEvent, { type: "tool_call_start" }> => event.type === "tool_call_start")!;
      const args = events.filter((event): event is Extract<AdapterEvent, { type: "tool_call_delta" }> => event.type === "tool_call_delta");
      executed.push(JSON.stringify({ call, args }));
      current = parseRequest({ ...(first._rawBody as object), previous_response_id: `uncached-continued-${round}`,
        input: [{ type: "function_call_output", call_id: call.id, output: JSON.stringify({ output: "TOOL_RESULT_NO_REPLAY", exit_code: 0 }) }],
      });
    }
    expect(browserRuns).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(executed).toHaveLength(2);
    expect(executed[0]).toContain("original-action");
    expect(executed[1]).toContain("inspect-and-finish");
    for (const old of ["INITIAL_SYSTEM_INSTRUCTIONS", "INITIAL_DEVELOPER_INSTRUCTIONS", "NEW_USER_INSTRUCTION", "TOOL_RESULT_NO_REPLAY"]) {
      expect(prompts[1]).not.toContain(old);
    }
  } finally {
    worker.run = original;
    chatGptTurnSessions.clear();
    await broker.close();
  }
}, 20_000);

test("Pro HTTP requests neither read nor save Responses history and reject lost sessions before SSE", async () => {
  const config = defaultConfig("browser-only");
  config.proAvailable = true;
  config.solAvailable = true;
  config.browserHost = "launcher";
  const isolated = provider("http-state", false);
  config.browserHostDescriptorPath = isolated.chatgptWeb!.browserHostDescriptorPath!;
  config.brokerSocketPath = isolated.chatgptWeb!.brokerSocketPath!;
  const currentProvider = providerConfig(config);
  const worker = ChatGptBrowserWorker.forProvider(currentProvider);
  const original = worker.run;
  const prompts: string[] = [];
  worker.run = async turn => {
    const prepared = prompts.length ? await turn.prepareResume!() : await turn.prepare();
    prompts.push(prepared.text);
    prepared.release();
    turn.onTextDelta("RETAINED_WEB_ONLY");
    return "RETAINED_WEB_ONLY";
  };
  const first = request("http-first");
  const second = request("http-second", [user("HTTP_NEW_MESSAGE", "http-second")]);
  const send = (parsed: CodexParsedRequest, extra: Record<string, unknown> = {}) => responseRequest(
    new Request("http://127.0.0.1/v1/responses", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(parsed._rawBody as object), model: "chatgpt-web/pro", stream: false, ...extra }),
    }), config,
  );
  try {
    const initial = await send(first);
    expect(initial.status).toBe(200);
    const response = await initial.json() as { id: string };
    detachMockRelease(currentProvider, first);
    const probe = { model: "chatgpt-web/pro", previous_response_id: response.id, input: [] };
    expect(expandPreviousResponseInput(probe)).toBe(probe);
    const followup = await send(second, { previous_response_id: "never-cached-response" });
    expect(followup.status).toBe(200);
    detachMockRelease(currentProvider, second);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("HTTP_NEW_MESSAGE");
    expect(prompts[1]).not.toContain("INITIAL_SYSTEM_INSTRUCTIONS");
    chatGptTurnSessions.clear();
    const lost = await send(second, { stream: true });
    expect(lost.status).toBe(400);
    expect(lost.headers.get("content-type")).toContain("application/json");
    expect(await lost.text()).toContain("Recovery and resubmission are disabled");
    expect(prompts).toHaveLength(2);
  } finally {
    worker.run = original;
    chatGptTurnSessions.clear();
  }
});
