/** ADR 0001: real installed Codex + broker, simulated Web response, controlled compaction ablation. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createChatGptWebAdapter, chatGptWebExecutionNamespace } from "../src/adapters/chatgpt-web";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { chatGptTurnExecutionKey, chatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { defaultConfig, providerConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";
import { responseRequest } from "../src/server";
import type { CodexTool } from "../src/types";

const codex = resolve(process.argv[2] ?? Bun.which("codex") ?? "/Applications/ChatGPT.app/Contents/Resources/codex");
const root = mkdtempSync(join(tmpdir(), "cgw-pro-native-"));
const originalEnv = { CODEX_HOME: process.env.CODEX_HOME, CODEX_CHATGPT_WEB_HOME: process.env.CODEX_CHATGPT_WEB_HOME };
const initialHome = join(root, "catalog-home");
mkdirSync(initialHome);
const source = spawnSync(codex, ["debug", "models", "--bundled"], {
  encoding: "utf8", env: { ...process.env, CODEX_HOME: initialHome }, timeout: 15_000,
});
if (source.status !== 0) throw new Error(`Could not read isolated native catalog: ${source.stderr}`);
const version = spawnSync(codex, ["--version"], { encoding: "utf8", env: { ...process.env, CODEX_HOME: initialHome } }).stdout.trim();

async function run(disableCompaction: boolean) {
  const directory = join(root, disableCompaction ? "pro" : "control");
  const codexHome = join(directory, "codex");
  mkdirSync(codexHome, { recursive: true });
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_CHATGPT_WEB_HOME = join(directory, "app");
  const config = defaultConfig("full");
  config.proAvailable = true;
  config.solAvailable = true;
  config.browserHost = "launcher";
  config.browserHostDescriptorPath = join(directory, "launcher.json");
  config.brokerSocketPath = join(directory, "broker.sock");
  const catalog = augmentNativeModelCatalog(JSON.parse(source.stdout), config);
  const pro = (catalog.models as Array<Record<string, unknown>>).find(model => model.slug === "chatgpt-web/pro")!;
  if (!disableCompaction) Object.assign(pro, {
    context_window: 1_000_000, max_context_window: 1_000_000, auto_compact_token_limit: 900_000,
  });
  const catalogPath = join(directory, "models.json");
  writeFileSync(catalogPath, JSON.stringify(catalog));
  const provider = providerConfig(config);
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const originalRun = worker.run;
  let browserResponses = 0;
  let responseRequests = 0;
  let compactions = 0;
  let nativeToolCalls = 0;
  let nativeTools: CodexTool[] = [];
  const evidencePath = join(directory, "native-evidence.txt");
  worker.run = async turn => {
    browserResponses += 1;
    const prepared = await turn.prepare();
    if (prepared.multipart) throw new Error("Pro attempted staging");
    const token = prepared.text.match(/turn_token (turn_[A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error("No live Pro token");
    prepared.release();
    const { bindingId } = await callTurnBroker<{ bindingId: string }>(config.brokerSocketPath, { method: "claim", token });
    const shell = nativeTools.find(tool => tool.name === "exec_command" || tool.name === "shell_command");
    if (!shell) throw new Error(`No native shell tool: ${nativeTools.map(tool => tool.name).join(",")}`);
    for (let index = 0; index < 2; index += 1) {
      const command = `printf 'native-round-${index}\\n' >> '${evidencePath}'`;
      const arguments_ = shell.name === "exec_command"
        ? { cmd: command, workdir: directory, yield_time_ms: 1000, max_output_tokens: 1000 }
        : { command, workdir: directory, timeout_ms: 1000 };
      const progress = turn.externalProgress!;
      const previous = progress.snapshot().lastToolBatchRevision;
      const invocation = callTurnBroker<BrokerToolResult>(config.brokerSocketPath, {
        method: "invoke", bindingId, wireName: shell.name, freeform: false, arguments: arguments_,
      }, 20_000);
      const settlement = invocation.then(value => ({ value }), error => ({ error }));
      let snapshot = progress.snapshot();
      while (snapshot.lastToolBatchRevision <= previous) snapshot = await progress.waitForChange(snapshot.revision, turn.abortSignal);
      await progress.acknowledgeToolBatch(snapshot.lastToolBatchRevision);
      const result = await settlement;
      if ("error" in result) throw result.error;
      if (result.value.isError) throw new Error(JSON.stringify(result.value));
      nativeToolCalls += 1;
    }
    turn.onTextDelta("NATIVE_PRO_SINGLE_RESPONSE_OK");
    return "NATIVE_PRO_SINGLE_RESPONSE_OK";
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/models") return Response.json(catalog);
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const raw = await request.clone().json() as { input?: Array<{ type?: string }>; client_metadata?: Record<string, string> };
    const metadata = JSON.parse(raw.client_metadata?.["x-codex-turn-metadata"] ?? request.headers.get("x-codex-turn-metadata") ?? "{}");
    if (url.pathname.endsWith("/compact") || raw.input?.some(item => item.type === "compaction_trigger") || metadata.request_kind === "compaction") {
      compactions += 1;
      const rejected = await responseRequest(request, config);
      if (rejected.status !== 400 || !(await rejected.clone().text()).includes("compaction is disabled for Pro")) {
        throw new Error("The production route did not reject native Pro compaction");
      }
      return rejected;
    }
    responseRequests += 1;
    return responseRequest(request, config, currentProvider => {
      const adapter = createChatGptWebAdapter(currentProvider);
      return { ...adapter, async runTurn(parsed, incoming, emit) {
        nativeTools = parsed.context.tools ?? [];
        await adapter.runTurn!(parsed, incoming, event => {
          // Identical stress in both cases: a numeric catalog must compact, an absent budget must not.
          emit(event.type === "done" ? { ...event, usage: {
            inputTokens: 9_000_000, outputTokens: 1, totalTokens: 9_000_001, estimated: true,
          } } : event);
        });
        const session = chatGptTurnSessions.find(`${chatGptWebExecutionNamespace(currentProvider)}:${chatGptTurnExecutionKey(parsed)}`);
        if (session) session.runtime.releaseRetainedConversation = async () => {};
      } };
    }, { rememberState: false });
  } });
  writeFileSync(join(codexHome, "config.toml"), [
    'model = "chatgpt-web/pro"', 'model_provider = "pro-context-smoke"',
    `model_catalog_json = ${JSON.stringify(catalogPath)}`,
    '[model_providers.pro-context-smoke]', 'name = "Isolated Pro context test"',
    `base_url = "http://127.0.0.1:${server.port}/v1"`,
    'env_key = "OPENAI_API_KEY"', 'wire_api = "responses"', 'supports_websockets = false',
  ].join("\n"));
  try {
    const loaded = spawnSync(codex, ["debug", "models"], {
      env: { ...process.env, OPENAI_API_KEY: "local-test-only" }, encoding: "utf8", timeout: 15_000,
    });
    if (loaded.status !== 0) throw new Error(`Native catalog load failed: ${loaded.stderr}`);
    const row = JSON.parse(loaded.stdout).models.find((model: { slug: string }) => model.slug === "chatgpt-web/pro");
    if (disableCompaction && [row.context_window, row.max_context_window, row.auto_compact_token_limit].some(value => value != null)) {
      throw new Error("Installed Codex did not preserve disabled compaction metadata");
    }
    const child = Bun.spawn([codex, "exec", "--skip-git-repo-check", "--json",
      "--dangerously-bypass-approvals-and-sandbox", "--model", "chatgpt-web/pro",
      "Execute the two harmless evidence commands and finish in one assistant response."], {
      cwd: directory, env: { ...process.env, OPENAI_API_KEY: "local-test-only" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 45_000);
    const [exit, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(timeout);
    const report = { disableCompaction, exit, responseRequests, compactions, browserResponses, nativeToolCalls };
    console.log(JSON.stringify(report));
    if (disableCompaction && (exit !== 0 || compactions !== 0 || browserResponses !== 1 || nativeToolCalls !== 2
      || readFileSync(evidencePath, "utf8") !== "native-round-0\nnative-round-1\n")) {
      throw new Error(`Pro integration failed: ${JSON.stringify(report)}\n${stdout}\n${stderr}`);
    }
    if (!disableCompaction && compactions === 0) throw new Error(`The numeric-window control did not compact:\n${stdout}\n${stderr}`);
    return report;
  } finally {
    chatGptTurnSessions.clear();
    worker.run = originalRun;
    await TurnBroker.forSocket(config.brokerSocketPath).close();
    await server.stop(true);
  }
}

try {
  console.log(version);
  await run(true);
  await run(false);
  console.log("NATIVE_CODEX_PRO_CONTEXT_SMOKE_OK");
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
}
