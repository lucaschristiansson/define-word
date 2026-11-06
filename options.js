// Uses KEY_RE and mwFetch from common.js.
const $ = (id) => document.getElementById(id);
const ORIGINS = ["https://www.dictionaryapi.com/*", "https://api.dictionaryapi.dev/*"];

function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

async function refresh() {
  const { mwKey } = await browser.storage.local.get("mwKey");
  const has = typeof mwKey === "string" && KEY_RE.test(mwKey);
  $("current").textContent = has
    ? `Merriam-Webster (key …${mwKey.slice(-4)})`
    : "Free Dictionary (no key)";
  $("key").value = "";
  $("key").placeholder = has
    ? `Saved key ends in …${mwKey.slice(-4)}. Paste a new one to replace it`
    : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  $("remove").disabled = !has;
}

$("toggle").addEventListener("click", () => {
  const hidden = $("key").type === "password";
  $("key").type = hidden ? "text" : "password";
  $("toggle").textContent = hidden ? "Hide" : "Show";
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("key").value.trim();

  if (!KEY_RE.test(key)) {
    setStatus("That doesn't look like a Merriam-Webster key. It should look like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.", "err");
    return;
  }

  // Ask for network access to the dictionary sites (no-op if already granted).
  // Must be called directly in the click handler, before any other await.
  const granted = await browser.permissions.request({ origins: ORIGINS }).catch(() => false);
  if (!granted) {
    setStatus("The add-on needs permission to contact dictionaryapi.com to check the key.", "err");
    return;
  }

  $("save").disabled = true;
  setStatus("Checking key with Merriam-Webster…");
  const r = await mwFetch("test", key);
  $("save").disabled = false;

  if (r.status === "ok" || r.status === "notfound") {
    await browser.storage.local.set({ mwKey: key });
    setStatus("✓ Key is valid and saved. Lookups now use Merriam-Webster.", "ok");
    await refresh();
  } else if (r.status === "invalid-key") {
    setStatus("✗ Merriam-Webster rejected this key. Make sure it's a Collegiate Dictionary key (not Learner's or Thesaurus). New keys can take a few minutes to activate.", "err");
  } else {
    setStatus(`✗ ${r.message} Check your connection and try again. The key was not saved.`, "err");
  }
});

$("remove").addEventListener("click", async () => {
  await browser.storage.local.remove("mwKey");
  setStatus("Key removed. Lookups use the Free Dictionary again.", "ok");
  await refresh();
});

refresh();
