/* Runs the page's own code outside a browser, so tests can check what each
   section puts on screen.

   boot() loads js/core.js and the app script from index.html into a sandbox
   with a stand-in document, a fixed clock and a fetch() that answers from
   recorded data. Nothing here touches the network. The sandbox knows nothing
   about layout or CSS: it checks the HTML each section produces, which is where
   "the score is in the wrong place" and "this list came out empty" show up. */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const fixture = name => JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", name), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("const API ="));
const coreScript = fs.readFileSync(path.join(ROOT, "js", "core.js"), "utf8");
const qrScript = fs.readFileSync(path.join(ROOT, "js", "qr.js"), "utf8");
const factsScript = fs.readFileSync(path.join(ROOT, "js", "facts.js"), "utf8");
if (!appScript) throw new Error("could not find the app script in index.html");

/* Elements that start hidden in the real page. */
const startsHidden = [...html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*\shidden[\s>]/g)].map(m => m[1]);

const DEFAULT_NOW = "2026-11-12T15:00:00Z";   // two days before Haiti v USA in the recorded data

const EDITORIAL = {
  "401929710": { stakes: "STAKES: the winner goes to the finals." },
  "401929766": { stakes: "STAKES: second leg." },
  comps: { "concacaf.nations.league": { how: "HOW it works text.", history: "HISTORY text.", next: "NEXT text.", usRoad: "USROAD text." } },
};
const AHEAD = { items: [
  { team: "women", date: "2026-12-05", what: "W Championship final", where: "Houston" },
  { team: "men", date: "2027-06-17", to: "2027-07-11", what: "Gold Cup", if: "If they qualify" },
  { team: "men", date: "2020-01-01", what: "Long past" },
] };
const RANKS_MEN = { ranks: { usa: { r: 16, p: 1705.47 }, haiti: { r: 84, p: 1280.91 }, canada: { r: 27, p: 1590 }, jamaica: { r: 69, p: 1362 } } };
const RANKS_WOMEN = { rows: [{ r: 2, n: "USA", p: 2042.38 }, { r: 78, n: "El Salvador", p: 1287.53 }] };

function makeElement(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", hidden: startsHidden.includes(id), dataset: {}, style: {}, href: "", open: false, listeners: {}, scrolled: 0,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return makeElement(id + " > child"); },
    querySelectorAll() { return []; },
    scrollIntoView() { this.scrolled++; }, setAttribute() {}, appendChild() {}, remove() {}, click() {}, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    classList: { toggle() {}, add() {}, remove() {} },
  };
}

/* opts: { now, hash, search, userAgent, data: {men, women}, summary, news, editorial, ahead, storage, share }
   - share: true gives the page a share sheet (navigator.share); what it shares is collected in `shared`
   - data.men / data.women: the hub data files (default: the recorded fixtures)
   - summary: the live match feed's answer — an object, a function (url) => object, or null for "offline"
   - build: what build.json says (default: missing, as when the page is opened from a folder)
   - hang: a RegExp of addresses whose requests never answer */
async function boot(opts = {}) {
  const data = { men: fixture("data-men.json"), women: fixture("data-women.json"), ...(opts.data || {}) };
  const store = { ...(opts.storage || {}) };
  const els = {}, tracked = [], fetched = [], timers = [], shared = [];
  const page = { summary: opts.summary === undefined ? null : opts.summary, news: opts.news || { articles: [] }, build: opts.build || null, hang: opts.hang || null };

  const answer = url => {
    if (/data\/usa\/(men|women)\.json/.test(url)) return data[/men\.json/.test(url) && !/women/.test(url) ? "men" : "women"];
    if (url.includes("editorial.json")) return opts.editorial || EDITORIAL;
    if (url.includes("ahead.json")) return opts.ahead || AHEAD;
    if (url.includes("rankings-women.json")) return RANKS_WOMEN;
    if (url.includes("rankings.json")) return RANKS_MEN;
    if (url.includes("/summary?event=")) return typeof page.summary === "function" ? page.summary(url) : page.summary;
    if (url.includes("/news?")) return page.news;
    if (url.includes("build.json")) return page.build;
    return undefined;
  };

  const sandbox = {
    console, URL, URLSearchParams, Blob, structuredClone, AbortController,
    document: {
      hidden: false, title: "Cap Day", body: makeElement("body"),
      getElementById(id) { return els[id] || (els[id] = makeElement(id)); },
      createElement(tag) { return makeElement("<" + tag + ">"); },
      addEventListener() {},
    },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    location: { hash: opts.hash || "", search: opts.search || "", origin: "http://test.local", pathname: "/wc2026/", protocol: "http:", href: "http://test.local/wc2026/" },
    navigator: { userAgent: opts.userAgent || "Mozilla/5.0 (Linux; Android 14; Pixel 8)", ...(opts.share ? { share: async data => { shared.push(data); } } : {}) },
    /* Only the part after "#" matters to the app: keep location.hash in step, as a browser would. */
    history: { replaceState(_a, _b, url) { const i = String(url).indexOf("#"); sandbox.location.hash = i < 0 ? "" : String(url).slice(i); } },
    goatcounter: { count: v => tracked.push(v.path) },
    addEventListener() {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: async (url, init) => {
      url = String(url); fetched.push(url);
      /* A connection that neither answers nor fails: it only ends if the page gives up on it. */
      if (page.hang && page.hang.test(url)) {
        return new Promise((_, reject) => { if (init && init.signal) init.signal.addEventListener("abort", () => reject(new Error("aborted (test): " + url))); });
      }
      const body = answer(url);
      if (body == null) throw new Error("offline (test): " + url);
      return { ok: true, status: 200, json: async () => clone(body) };
    },
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const now = Date.parse(opts.now || DEFAULT_NOW);
  vm.runInContext(`{ const Real = Date; globalThis.__now = ${now};
    globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(globalThis.__now); } static now() { return globalThis.__now; } }; }`, ctx);
  vm.runInContext(coreScript, ctx, { filename: "js/core.js" });
  vm.runInContext(qrScript, ctx, { filename: "js/qr.js" });
  if (!opts.noFacts) vm.runInContext(factsScript, ctx, { filename: "js/facts.js" });
  vm.runInContext(appScript, ctx, { filename: "index.html <script>" });

  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  await settle();

  return {
    ctx, els, tracked, fetched, timers, store, data, settle, shared, location: sandbox.location,
    run: code => vm.runInContext(code, ctx),
    el: id => sandbox.document.getElementById(id),
    html: id => (els[id] ? els[id].innerHTML : ""),
    text: id => (els[id] ? els[id].innerHTML : "").replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/&amp;/g, "&").replace(/&rarr;/g, "→").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(),
    setSummary: s => { page.summary = s; },
    setBuild: b => { page.build = b; },
    /* Move the page's clock (it does not run on its own). */
    setNow: iso => { sandbox.__now = Date.parse(iso); },
    setHang: re => { page.hang = re; },
    setData: (team, d) => { data[team] = d; },
    /* Run the timers the page has set that match, as if their time had come. */
    async fire(match) { const due = timers.filter(match); for (const t of due) { timers.splice(timers.indexOf(t), 1); t.fn(); } await settle(); return due.length; },
    setNews: n => { page.news = n; },
    /* Ask the page to check the live feed again, as its timer would. */
    async refresh() { vm.runInContext("refreshLive()", ctx); await settle(); },
  };
}

/* A match recorded as it was played (scripts/make-replay.mjs): the feed's
   answers at chosen moments, each rebuilt in full. Parts that did not change
   from one moment to the next are stored once and carried forward here. */
function replay(name) {
  const R = fixture(name), carried = {};
  return { ...R, frames: R.frames.map(f => { Object.assign(carried, f.summary); return { at: f.at, note: f.note, summary: clone(carried) }; }) };
}

/* A recorded finished match (USA 1–0 Canada), with its status rewritten. */
function summaryAs(state, clock) {
  const G = fixture("summary-finished-usa-canada.json");
  if (state !== "post") G.header.competitions[0].status = { displayClock: clock || "67'", type: { state, shortDetail: clock || "67'" } };
  return G;
}

module.exports = { boot, fixture, clone, summaryAs, replay, ROOT };
