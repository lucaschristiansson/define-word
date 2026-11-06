(() => {
  // The script is injected on every lookup; only set up once per page/frame.
  if (globalThis.__defineWordLoaded) return;
  globalThis.__defineWordLoaded = true;

  const LEAVE_DELAY_MS = 300; // grace period so brushing past the edge doesn't close it

  const CSS = `
    :host { all: initial; }
    .card {
      --bg: #ffffff; --fg: #1d1d1f; --muted: #6b6b70; --line: #e4e4e8; --accent: #1f5fa8; --warn: #9a6700; --subtle: #f6f6f8;
      box-sizing: border-box;
      width: 360px; max-width: calc(100vw - 16px); max-height: 60vh; overflow-y: auto;
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18);
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 12px 14px 0;
    }
    @media (prefers-color-scheme: dark) {
      .card { --bg: #232327; --fg: #ececef; --muted: #a0a0a8; --line: #3a3a40; --accent: #7fb2ff; --warn: #e3b341; --subtle: #1c1c20; }
    }
    .head { display: flex; align-items: center; gap: 8px; }
    .head .icon-btn { align-self: center; margin-right: -6px; }
    .word { font: 700 20px/1.2 Georgia, "Times New Roman", serif; }
    .phon { color: var(--muted); }
    .spacer { flex: 1; }
    button {
      all: unset; cursor: pointer; color: var(--muted); font-size: 15px;
      padding: 0 4px; border-radius: 4px;
    }
    button:hover { color: var(--fg); background: var(--line); }
    .note { color: var(--muted); font-size: 13px; font-style: italic; margin-top: 2px; }
    .note b { color: var(--fg); font-style: normal; font-weight: 600; }
    .pos { margin: 10px 0 2px; font-style: italic; color: var(--accent); font-weight: 600; }
    ol { margin: 0; padding-left: 20px; }
    li { margin: 3px 0; }
    .ex { color: var(--muted); font-style: italic; }
    .syn { color: var(--muted); font-size: 13px; margin-top: 3px; }
    .msg { color: var(--muted); margin-top: 6px; }
    .warn { color: var(--warn); font-size: 13px; margin-top: 6px; }
    .sugg { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
    .sugg button { font-size: 13px; color: var(--accent); border: 1px solid var(--line); padding: 1px 8px; border-radius: 99px; }
    /* Footer: full-width bar that stays pinned to the bottom while the card scrolls */
    .foot {
      position: sticky; bottom: 0;
      margin: 12px -14px 0; padding: 8px 10px 8px 14px;
      background: var(--subtle); border-top: 1px solid var(--line);
      border-radius: 0 0 10px 10px;
      display: flex; align-items: center; gap: 6px;
      font-size: 12px;
    }
    .src { color: var(--muted); letter-spacing: .01em; }
    .src b { font-weight: 600; color: var(--fg); }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 0; border-radius: 6px;
    }
    .icon-btn svg { width: 15px; height: 15px; }
    .more {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 99px;
      font-weight: 600; font-size: 12px;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      transition: background .15s;
    }
    .more:hover { text-decoration: none; background: color-mix(in srgb, var(--accent) 22%, transparent); }
    .more svg { width: 12px; height: 12px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  `;

  let host = null;
  let card = null;
  let anchor = null;
  let currentId = 0;
  let leaveTimer = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text); // textContent only: never inject HTML
    return n;
  }

  function safeHttps(url) {
    try {
      return typeof url === "string" && new URL(url).protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  function selectionRect() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return r.width || r.height ? r : null;
  }

  function close() {
    clearTimeout(leaveTimer);
    host?.remove();
    host = card = null;
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onOutside(e) {
    if (host && !e.composedPath().includes(host)) close();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function open() {
    close();
    anchor = selectionRect();
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: absolute; z-index: 2147483647; top: 0; left: 0;";
    const root = host.attachShadow({ mode: "closed" }); // isolates from page CSS and scripts
    const style = el("style");
    style.textContent = CSS;
    card = el("div", "card");
    root.append(style, card);

    // Close when the mouse leaves the popup (after it has been entered).
    card.addEventListener("mouseenter", () => clearTimeout(leaveTimer));
    card.addEventListener("mouseleave", () => {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(close, LEAVE_DELAY_MS);
    });

    document.documentElement.append(host);
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  }

  function position() {
    if (!host) return;
    const m = 8;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const r = anchor || { left: (innerWidth - w) / 2, top: 60, bottom: 60 };
    let top = r.bottom + m; // prefer below the word
    if (top + h > innerHeight - m && r.top - m - h > m) top = r.top - m - h; // flip above
    top = Math.max(m, Math.min(top, innerHeight - h - m));
    const left = Math.max(m, Math.min(r.left, innerWidth - w - m));
    host.style.top = `${top + scrollY}px`;
    host.style.left = `${left + scrollX}px`;
  }

  // ---------- pronunciation ----------

  function speakTTS(word) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // Recordings are decoded and played through Web Audio so we can clean them up:
  // a short fade-in/out removes the click/pop some MP3s have at the start or end,
  // and a limiter tames sudden loud spikes.
  let audioCtx = null;
  let currentSource = null;
  const FADE_IN = 0.01;  // seconds
  const FADE_OUT = 0.15; // seconds
  const TARGET_PEAK = 0.8;

  async function playClean(url) {
    // The background script downloads the file (only from known dictionary hosts),
    // so the page's own security rules can't block it.
    const data = await browser.runtime.sendMessage({ type: "dw-audio", url });
    if (!(data instanceof ArrayBuffer)) throw new Error("no audio");

    audioCtx ||= new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const buffer = await audioCtx.decodeAudioData(data);

    // Normalise loudness based on the main body of the clip (ignoring the last
    // part, where the pop usually is) so quiet and loud recordings sound alike.
    let peak = 0;
    const bodyEnd = Math.floor(buffer.length * 0.85);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < bodyEnd; i++) peak = Math.max(peak, Math.abs(ch[i]));
    }
    const level = peak > 0 ? Math.min(2, TARGET_PEAK / peak) : 1;

    currentSource?.stop();
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;

    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime + 0.02;
    const d = buffer.duration;
    const fadeOut = Math.min(FADE_OUT, d / 4);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + FADE_IN);
    gain.gain.setValueAtTime(level, t + d - fadeOut);
    gain.gain.linearRampToValueAtTime(0, t + d);

    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;

    src.connect(gain).connect(limiter).connect(audioCtx.destination);
    src.start(t);
    currentSource = src;
  }

  // Try the cleaned-up recording first; fall back to text-to-speech if anything fails.
  function pronounce(word, audioUrl) {
    const url = safeHttps(audioUrl);
    if (!url) return speakTTS(word);
    playClean(url).catch(() => speakTTS(word));
  }

  // ---------- rendering ----------

  function header(word, phonetic, audioUrl, showPlay = false) {
    const head = el("div", "head");
    head.append(el("span", "word", word));
    if (phonetic) head.append(el("span", "phon", phonetic));
    if (showPlay) {
      const play = el("button", "icon-btn");
      play.title = "Play pronunciation";
      play.setAttribute("aria-label", "Play pronunciation");
      play.append(icon("speaker"));
      play.addEventListener("click", () => pronounce(word.replace(/·/g, ""), audioUrl));
      head.append(play);
    }
    head.append(el("span", "spacer"));
    const x = el("button", "icon-btn");
    x.title = "Close (Esc)";
    x.setAttribute("aria-label", "Close");
    x.append(icon("close"));
    x.addEventListener("click", close);
    head.append(x);
    return head;
  }

  const ICONS = {
    gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
    external: ["M7 17L17 7", "M8 7h9v9"],
    speaker: ["M11 5L6 9H2v6h4l5 4V5z", "M15.54 8.46a5 5 0 0 1 0 7.07", "M19.07 4.93a10 10 0 0 1 0 14.14"],
    close: ["M18 6L6 18", "M6 6l12 12"],
  };

  function icon(name) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICONS[name]) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  function footer(moreUrl, source) {
    const foot = el("div", "foot");

    const src = el("span", "src");
    if (source) src.append("via ", el("b", null, source));
    foot.append(src, el("span", "spacer"));

    const gear = el("button", "icon-btn");
    gear.title = "Settings";
    gear.setAttribute("aria-label", "Settings");
    gear.append(icon("gear"));
    gear.addEventListener("click", () => {
      browser.runtime.sendMessage({ type: "dw-open-options" }).catch(() => {});
    });

    const a = el("a", "more", "Full entry");
    const href = safeHttps(moreUrl);
    if (href) a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = "Open the full entry on Merriam-Webster";
    a.append(icon("external"));

    foot.append(gear, a);
    return foot;
  }

  // e.g. “wiping” is a form of **wipe**
  function formNote({ searched, base, relation }) {
    const note = el("div", "note");
    const verb = relation === "form" ? " is a form of "
      : relation === "variant" ? " is a variant of "
      : null;
    if (verb) {
      note.append(`“${searched}”${verb}`, el("b", null, base));
    } else {
      note.append(`No exact entry for “${searched}”. Showing `, el("b", null, base), ".");
    }
    return note;
  }

  function renderLoading(term, moreUrl) {
    open();
    card.append(header(term), el("div", "msg", "Looking up…"), footer(moreUrl));
    position();
  }

  function renderResult(msg) {
    if (!host || msg.id !== currentId) return; // closed, or a newer lookup started
    const r = msg.result || {};
    card.replaceChildren();

    if (r.status !== "ok" || !r.entry) {
      card.append(header(msg.term));
      if (r.warning) card.append(el("div", "warn", r.warning));
      card.append(el("div", "msg", r.status === "error" ? (r.message || "Couldn't reach the dictionary.") : "No definition found."));
      if (Array.isArray(r.suggestions) && r.suggestions.length) {
        card.append(el("div", "msg", "Did you mean:"));
        const box = el("div", "sugg");
        for (const s of r.suggestions) {
          const b = el("button", null, s);
          b.addEventListener("click", () => {
            browser.runtime.sendMessage({ type: "dw-lookup", term: String(s) }).catch(() => {});
          });
          box.append(b);
        }
        card.append(box);
      }
      card.append(footer(msg.moreUrl));
      position();
      return;
    }

    const e = r.entry;
    // Only show the 🔊 button when there's a recording (Merriam-Webster only).
    card.append(header(e.word || msg.term, e.phonetic, e.audio, Boolean(e.audio)));
    if (e.formOf) card.append(formNote(e.formOf));
    if (r.warning) card.append(el("div", "warn", r.warning));

    for (const g of e.groups || []) {
      if (g.pos) card.append(el("div", "pos", g.pos));
      const ol = el("ol");
      for (const d of g.defs || []) {
        const li = el("li", null, d.text);
        if (d.example) li.append(document.createElement("br"), el("span", "ex", `“${d.example}”`));
        ol.append(li);
      }
      card.append(ol);
      if (g.synonyms?.length) card.append(el("div", "syn", `Synonyms: ${g.synonyms.join(", ")}`));
    }

    card.append(footer(msg.moreUrl, e.source));
    position();
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "dw-loading") {
      currentId = msg.id;
      renderLoading(msg.term, msg.moreUrl);
    } else if (msg.type === "dw-result") {
      renderResult(msg);
    }
  });
})();
