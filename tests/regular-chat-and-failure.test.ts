import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { assertRegularChatPage, CHATGPT_REGULAR_CHAT_URL, isRegularChatUrl } from "../src/chatgpt-session";
import { chatGptThinkingFailedError } from "../src/adapters/chatgpt-web/adapter-error";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

test("regular chat URLs admit saved conversations and reject temporary or unrelated surfaces", async () => {
  const { isRegularChatUrl: launcherUrl, isRegularChatHomeUrl } = require("../launcher/electron/browser-host.cjs");
  expect(CHATGPT_REGULAR_CHAT_URL).toBe("https://chatgpt.com/");
  for (const url of [CHATGPT_REGULAR_CHAT_URL, "https://chatgpt.com/?model=auto", "https://chatgpt.com/c/conversation-id"]) {
    expect(isRegularChatUrl(url)).toBeTrue();
    expect(launcherUrl(url)).toBeTrue();
    expect(isRegularChatHomeUrl(url)).toBe(new URL(url).pathname === "/");
    await assertRegularChatPage({ url: () => url } as never);
  }
  for (const url of [
    "https://chatgpt.com/?temporary-chat=true", "https://chatgpt.com/?temporary-chat=false",
    "https://chatgpt.com/c/old?temporary-chat=true", "https://chatgpt.com/auth/login",
    "https://chatgpt.com/c/", "https://chatgpt.com/c/one/two", "https://example.com/", "about:blank", "invalid",
  ]) {
    expect(isRegularChatUrl(url)).toBeFalse();
    expect(launcherUrl(url)).toBeFalse();
    expect(isRegularChatHomeUrl(url)).toBeFalse();
    await expect(assertRegularChatPage({ url: () => url } as never)).rejects.toThrow("cannot be converted or replayed automatically");
  }
});

test("regular preparation navigates once, leaves personalization untouched, and rejects retained temporary chats", async () => {
  const prepare = (ChatGptBrowserWorker.prototype as any).prepareRegularChatSurface;
  let url = "about:blank";
  const navigations: string[] = [];
  const locator = {
    count: async () => 1, nth() { return this; }, filter() { return this; }, last() { return this; },
    isVisible: async () => false,
  };
  const composer = { ...locator, isVisible: async () => true };
  const page = {
    url: () => url,
    goto: async (next: string) => { navigations.push(next); url = next; },
    locator: (selector: string) => selector.includes("prompt-textarea") ? composer : locator,
    getByRole: () => { throw new Error("personalization and onboarding must be untouched"); },
  };
  await prepare.call({ activeComposer: async () => composer }, page);
  await prepare.call({ activeComposer: async () => composer }, page);
  expect(navigations).toEqual([CHATGPT_REGULAR_CHAT_URL]);
  url = "https://chatgpt.com/?temporary-chat=true";
  await expect(assertRegularChatPage(page as never)).rejects.toThrow("Start a new Codex task");
  expect(navigations).toHaveLength(1);
});

// Execute the exact browser-side detector against a DOM. This fixture preserves the observed
// collapsed button structure, without storing the private conversation, its ID or its reasoning.
const source = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8")
  .split("// CHATGPT_TERMINAL_THINKING_STATUS_BEGIN")[1]?.split("// CHATGPT_TERMINAL_THINKING_STATUS_END")[0];
if (!source) throw new Error("Missing shipped terminal status detector");
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);

function failureVisible(html: string, label = "Thinking failed"): boolean {
  const { createWindow } = require("@mixmark-io/domino");
  const window = createWindow(`<body>${html}</body>`);
  const document = window.document;
  if (!("isConnected" in window.Node.prototype)) {
    Object.defineProperty(window.Node.prototype, "isConnected", {
      get() { return document.documentElement.contains(this); },
    });
  }
  const context = createContext({
    document, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (element: HTMLElement) => element.style,
  });
  const detector = runInContext(`${javascript}; hasTerminalThinkingStatus;`, context);
  return detector(document.querySelector("#current"), label);
}

for (const label of ["Thinking failed", "Stopped thinking"]) {
  for (const expanded of [false, true]) test(`detects ${label} with expanded=${expanded}, no answer and no completion action`, () => {
    expect(failureVisible(`<article id="current" data-testid="conversation-turn-2" data-turn="assistant">
      <div class="fKQ0lq_Layout"><div class="fKQ0lq_TransitionItem"><div class="select-none">
        <button aria-expanded="${expanded}">${label}</button>
      </div></div></div></article>`, label)).toBeTrue();
  });
  test(`detects an accessible ${label} status and whitespace-normalized button text`, () => {
    expect(failureVisible(`<article id="current"><button aria-label="${label}"></button></article>`, label)).toBeTrue();
    expect(failureVisible(`<article id="current"><button><span> ${label.replace(" ", "\n  ")} </span></button></article>`, label)).toBeTrue();
  });
  for (const wrapper of ["markdown", "pre", "code", "blockquote"]) test(`ignores ${label} in model-authored ${wrapper}`, () => {
    const open = wrapper === "markdown" ? '<div class="markdown">' : `<${wrapper}>`;
    const close = wrapper === "markdown" ? "</div>" : `</${wrapper}>`;
    expect(failureVisible(`<article id="current">${open}<button aria-label="${label}">${label}</button>${close}</article>`, label)).toBeFalse();
  });
  for (const style of ["display:none", "visibility:hidden", "opacity:0"]) test(`ignores ${label} in a hidden ancestor (${style})`, () => {
    expect(failureVisible(`<section style="${style}"><article id="current"><button>${label}</button></article></section>`, label)).toBeFalse();
  });
}

test("previous responses, user messages, active reasoning and quoted failure phrases are not terminal", () => {
  expect(failureVisible(`<article data-turn="user"><button>Thinking failed</button></article>
    <article data-turn="assistant"><button>Thinking failed</button></article>
    <article id="current"><button aria-expanded="false">Pro thinking</button>
      <div class="markdown">Thinking failed</div><button>Investigating Thinking failed errors</button></article>`)).toBeFalse();
});

test("Thinking failed is a terminal upstream error without automatic retry or an invented cause", () => {
  expect(chatGptThinkingFailedError()).toMatchObject({
    status: 502, errorType: "server_error", code: "chatgpt_thinking_failed", retryable: false,
  });
  expect(chatGptThinkingFailedError().message).not.toMatch(/quota|temporary|compaction/i);
});

test("both response loops check Thinking failed before acknowledging MCP progress", () => {
  const worker = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8");
  for (const method of ["private async waitForMultipartAcknowledgement(", "private async runBrowserTurn("]) {
    const loop = worker.slice(worker.indexOf(method));
    const failure = loop.indexOf("if (snapshot.thinkingFailedVisible) throw chatGptThinkingFailedError();");
    expect(failure).toBeGreaterThan(0);
    expect(loop.indexOf(".acknowledgeToolBatch(", failure)).toBeGreaterThan(failure);
  }
});

test("collapsed Thinking failed ends observation immediately despite live MCP work", async () => {
  const absent = { last() { return this; }, filter() { return this; }, isVisible: async () => false };
  const page = { isClosed: () => false, locator: () => absent };
  const binding = { locator: { getByText: () => absent, getByTestId: () => absent } };
  let observations = 0;
  let acknowledgements = 0;
  const observe = (ChatGptBrowserWorker.prototype as any).waitForMultipartAcknowledgement;
  await expect(observe.call({ responseDomSnapshot: async () => {
    observations++;
    return { responsePresent: true, thinkingFailedVisible: true, stoppedThinkingVisible: false,
      visibleText: "", completionActionVisible: false };
  } }, page, binding, {}, {}, Date.now() + 1_000, undefined, {
    snapshot: () => ({ revision: 1, lastToolBatchRevision: 1, activeToolCalls: 1, lastProgressAt: Date.now() }),
    acknowledgeToolBatch: async () => { acknowledgements++; },
  })).rejects.toMatchObject({ code: "chatgpt_thinking_failed", retryable: false });
  expect(observations).toBe(1);
  expect(acknowledgements).toBe(0);
});
