// Shared by background.js and options.js.
/* exported KEY_RE, mwFetch, normalizeMW, normalizeFree, freeFetch */

const MW_API = "https://www.dictionaryapi.com/api/v3/references/collegiate/json/";
const FREE_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const MW_AUDIO = "https://media.merriam-webster.com/audio/prons/en/us/mp3/";
// Merriam-Webster keys are UUIDs, e.g. 1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FETCH_OPTS = { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" };
const MAX_DEFS_PER_POS = 3;

function safeHttps(url) {
  if (typeof url !== "string") return undefined;
  if (url.startsWith("//")) url = "https:" + url;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

// ---------- Merriam-Webster ----------

/**
 * Returns one of:
 *  { status: "ok", data }            – array of entry objects
 *  { status: "notfound", suggestions }
 *  { status: "invalid-key" }
 *  { status: "error", message }
 */
async function mwFetch(term, key) {
  const url = `${MW_API}${encodeURIComponent(term)}?key=${encodeURIComponent(key)}`;
  let res, text;
  try {
    res = await fetch(url, FETCH_OPTS);
    text = await res.text();
  } catch {
    return { status: "error", message: "Couldn't reach Merriam-Webster." };
  }

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* MW answers bad keys with plain text */
  }

  if (!Array.isArray(data)) {
    if (/invalid api key|not subscribed/i.test(text) || res.status === 401 || res.status === 403) {
      return { status: "invalid-key" };
    }
    return { status: "error", message: `Merriam-Webster returned HTTP ${res.status}.` };
  }
  if (data.length === 0) return { status: "notfound", suggestions: [] };
  if (typeof data[0] === "string") {
    return { status: "notfound", suggestions: data.filter((s) => typeof s === "string").slice(0, 6) };
  }
  return { status: "ok", data };
}

function mwAudioUrl(name) {
  if (typeof name !== "string" || !/^[\w-]+$/.test(name)) return undefined;
  const sub = name.startsWith("bix") ? "bix"
    : name.startsWith("gg") ? "gg"
    : /^[^a-z]/i.test(name) ? "number"
    : name[0].toLowerCase();
  return `${MW_AUDIO}${sub}/${name}.mp3`;
}

function normalizeMW(term, data) {
  const t = term.toLowerCase();
  const head = (e) => String(e.hwi?.hw || "").replace(/\*/g, "").toLowerCase();
  const baseId = (e) => String(e.meta?.id || "").split(":")[0].toLowerCase();

  const clean = (s) => String(s || "").replace(/\*/g, "").toLowerCase();
  const inflections = (e) => (e.ins || []).map((i) => clean(i.if));
  const variants = (e) => (e.vrs || []).map((v) => clean(v.va));

  let entries = data.filter((e) => e && e.meta && Array.isArray(e.shortdef) && e.shortdef.length);
  // MW also returns related phrases ("test tube" for "test"); keep exact headwords if any.
  const exact = entries.filter((e) => head(e) === t || baseId(e) === t);
  let relation = null; // set when the searched word isn't the headword itself
  if (exact.length) {
    entries = exact;
  } else {
    // e.g. "wiping" → entries for "wipe" that list "wiping" as one of their forms
    const forms = entries.filter((e) => inflections(e).includes(t));
    const vars = entries.filter((e) => variants(e).includes(t));
    if (forms.length) { entries = forms; relation = "form"; }
    else if (vars.length) { entries = vars; relation = "variant"; }
    else relation = "related";
  }
  if (!entries.length) return null;

  const prs = entries.flatMap((e) => e.hwi?.prs || []);
  const pron = prs.find((p) => p.mw)?.mw;
  const audio = mwAudioUrl(prs.find((p) => p.sound?.audio)?.sound.audio);

  const groups = new Map();
  for (const e of entries) {
    const pos = e.fl || "";
    const g = groups.get(pos) || { pos, defs: [], synonyms: [] };
    for (const d of e.shortdef) {
      if (g.defs.length < MAX_DEFS_PER_POS) g.defs.push({ text: String(d) });
    }
    groups.set(pos, g);
  }

  const word = String(entries[0].hwi?.hw || term).replace(/\*/g, "·");
  return {
    word,
    phonetic: pron ? `\\${pron}\\` : undefined,
    audio,
    groups: [...groups.values()],
    source: "Merriam-Webster",
    formOf: relation && clean(word) !== t
      ? { searched: term, base: word.replace(/·/g, ""), relation }
      : undefined,
  };
}

// ---------- Free Dictionary (fallback, no key) ----------

async function freeFetch(term) {
  try {
    const res = await fetch(FREE_API + encodeURIComponent(term), FETCH_OPTS);
    if (res.status === 404) return { status: "notfound", suggestions: [] };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    const data = await res.json();
    const entry = Array.isArray(data) ? normalizeFree(term, data) : null;
    return entry ? { status: "ok", entry } : { status: "notfound", suggestions: [] };
  } catch {
    return { status: "error", message: "Couldn't reach the dictionary." };
  }
}

function normalizeFree(term, entries) {
  if (!entries.length) return null;
  const phonetics = entries.flatMap((e) => e.phonetics || []);
  const phonetic = entries.find((e) => e.phonetic)?.phonetic || phonetics.find((p) => p.text)?.text;
  // No audio for the Free Dictionary: its recordings are unreliable.

  const groups = new Map();
  for (const e of entries) {
    for (const m of e.meanings || []) {
      const pos = m.partOfSpeech || "";
      const g = groups.get(pos) || { pos, defs: [], synSet: new Set() };
      for (const d of m.definitions || []) {
        if (g.defs.length < MAX_DEFS_PER_POS) g.defs.push({ text: String(d.definition), example: d.example });
        (d.synonyms || []).forEach((s) => g.synSet.add(s));
      }
      (m.synonyms || []).forEach((s) => g.synSet.add(s));
      groups.set(pos, g);
    }
  }

  const word = entries[0].word || term;
  return {
    word,
    formOf: String(word).toLowerCase() !== term.toLowerCase()
      ? { searched: term, base: word, relation: "related" }
      : undefined,
    phonetic,
    groups: [...groups.values()].map(({ pos, defs, synSet }) => ({
      pos,
      defs,
      synonyms: [...synSet].slice(0, 6),
    })),
    source: "Free Dictionary",
  };
}
