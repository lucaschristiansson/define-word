// Uses helpers from common.js (loaded first, see manifest.json).
const MORE_URL = "https://www.merriam-webster.com/dictionary/";
const MAX_TERM_LENGTH = 64;

let requestCounter = 0;

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: "define-word",
    title: "Define “%s”", // %s = the selected text
    contexts: ["selection"],
  });
});

function cleanTerm(text) {
  return String(text || "")
    .slice(0, MAX_TERM_LENGTH)
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") // strip surrounding punctuation
    .toLowerCase();
}

// The key never leaves the background script: content scripts only receive definitions.
async function getKey() {
  const { mwKey } = await browser.storage.local.get("mwKey");
  return typeof mwKey === "string" && KEY_RE.test(mwKey) ? mwKey : null;
}

async function lookup(term) {
  const key = await getKey();
  if (!key) return freeFetch(term);

  const r = await mwFetch(term, key);
  if (r.status === "ok") {
    const entry = normalizeMW(term, r.data);
    return entry ? { status: "ok", entry } : { status: "notfound", suggestions: [] };
  }
  if (r.status === "notfound") return r;

  // Key rejected or MW unreachable: fall back so you still get a definition.
  const fb = await freeFetch(term);
  fb.warning = r.status === "invalid-key"
    ? "Merriam-Webster rejected your key. Check Settings."
    : "Merriam-Webster was unreachable. Showing Free Dictionary instead.";
  return fb;
}

async function define(tab, frameId, rawText) {
  const term = cleanTerm(rawText);
  if (!term) return;
  const moreUrl = MORE_URL + encodeURIComponent(term);

  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      files: ["content.js"],
    });
  } catch {
    // Some pages (about:, addons.mozilla.org, PDFs) don't allow scripts: open a tab instead.
    browser.tabs.create({ url: moreUrl, index: tab.index + 1, openerTabId: tab.id });
    return;
  }

  const id = ++requestCounter;
  const send = (msg) => browser.tabs.sendMessage(tab.id, msg, { frameId }).catch(() => {});

  send({ type: "dw-loading", id, term, moreUrl });
  const result = await lookup(term);
  send({ type: "dw-result", id, term, moreUrl, result });
}

// Right-click menu.
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "define-word") return;
  define(tab, info.frameId ?? 0, info.selectionText);
});

// Keyboard shortcut (default Alt+Shift+D).
browser.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "define-selection") return;
  tab = tab || (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  let results;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => window.getSelection()?.toString() || "",
    });
  } catch {
    return;
  }
  const hit = results.find((r) => typeof r.result === "string" && r.result.trim());
  if (hit) define(tab, hit.frameId ?? 0, hit.result);
});

// Pronunciation audio may only be downloaded from these hosts.
const AUDIO_HOSTS = new Set(["media.merriam-webster.com"]);
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

async function fetchAudio(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !AUDIO_HOSTS.has(url.hostname)) return null;
  try {
    const res = await fetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength <= MAX_AUDIO_BYTES ? buf : null;
  } catch {
    return null;
  }
}

// Messages from our own popup (suggestion clicks, settings button, audio).
// Web pages can't send these: only our content script has access to browser.runtime.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id || !sender.tab || !msg || typeof msg !== "object") return;
  if (msg.type === "dw-audio" && typeof msg.url === "string") {
    return fetchAudio(msg.url); // returning a promise sends the response
  }
  if (msg.type === "dw-lookup" && typeof msg.term === "string") {
    define(sender.tab, sender.frameId ?? 0, msg.term);
  } else if (msg.type === "dw-open-options") {
    browser.runtime.openOptionsPage();
  }
});
