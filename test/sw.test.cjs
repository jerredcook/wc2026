/* The service worker keeps the installed app usable offline. Its rules:
   always try the network first; keep copies of good answers only; when the
   network is gone serve the copy, or the app's front page as a last resort;
   never touch other sites' requests (the live score feed). */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const ORIGIN = "https://example.test";

function worker({ network, stored = {}, otherCaches = [] }) {
  const handlers = {}, store = new Map(Object.entries(stored)), names = new Set(otherCaches), log = { skipWaiting: 0, claimed: 0, added: null };
  const cacheName = /const CACHE = "([^"]+)"/.exec(source)[1];
  const keyOf = r => (typeof r === "string" ? new URL(r, ORIGIN + "/wc2026/").href : r.url);
  const cache = { addAll: async list => { log.added = list; }, put: async (req, res) => { store.set(keyOf(req), res); } };
  const sandbox = {
    URL, Promise,
    self: { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting: () => { log.skipWaiting++; }, clients: { claim: async () => { log.claimed++; } }, location: { origin: ORIGIN } },
    caches: {
      open: async name => { names.add(name); return cache; },
      keys: async () => [...names],
      delete: async name => names.delete(name),
      match: async req => store.get(keyOf(req)),
    },
    fetch: async req => network(req),
  };
  vm.runInNewContext(source, sandbox);
  const fire = async (type, extra = {}) => { let waited; const ev = { waitUntil: p => { waited = p; }, ...extra }; handlers[type](ev); await waited; return ev; };
  const request = async (url, method = "GET") => {
    let answer; const ev = { request: { url: new URL(url, ORIGIN + "/wc2026/").href, method }, respondWith: p => { answer = p; } };
    handlers.fetch(ev);
    const res = answer === undefined ? undefined : await answer;
    await new Promise(r => setImmediate(r));   // let the background cache write finish
    return res;
  };
  return { fire, request, store, names, log, cacheName };
}
const ok = body => ({ ok: true, status: 200, body, clone() { return { ...this, cloned: true }; } });
const bad = status => ({ ok: false, status, clone() { return this; } });
const offline = () => { throw new Error("no network"); };

test("install: takes over at once and stores the app's own files", async () => {
  const w = worker({ network: () => ok("x") });
  await w.fire("install");
  assert.equal(w.log.skipWaiting, 1);
  for (const f of ["./", "./index.html", "./js/core.js", "./worldcup.html"]) assert.ok(w.log.added.includes(f), f + " is not in the offline set");
});

test("activate: older versions' caches are cleared out", async () => {
  const w = worker({ network: () => ok("x"), otherCaches: ["wc2026-v1", "wc2026-v3"] });
  await w.fire("activate");
  assert.deepEqual([...w.names], []);
  assert.equal(w.log.claimed, 1);
});

test("online: the network answer is used and a copy is kept", async () => {
  const w = worker({ network: () => ok("fresh"), stored: { [ORIGIN + "/wc2026/data/usa/men.json"]: ok("old") } });
  const res = await w.request("data/usa/men.json");
  assert.equal(res.body, "fresh", "fresh content always wins when online");
  assert.equal(w.store.get(ORIGIN + "/wc2026/data/usa/men.json").body, "fresh");
});

test("an error answer is passed through but never replaces the stored copy", async () => {
  const w = worker({ network: () => bad(500), stored: { [ORIGIN + "/wc2026/index.html"]: ok("good copy") } });
  const res = await w.request("index.html");
  assert.equal(res.status, 500);
  assert.equal(w.store.get(ORIGIN + "/wc2026/index.html").body, "good copy");
});

test("offline: the stored copy is served", async () => {
  const w = worker({ network: offline, stored: { [ORIGIN + "/wc2026/data/usa/men.json"]: ok("saved") } });
  assert.equal((await w.request("data/usa/men.json")).body, "saved");
});

test("offline with nothing stored for that address: the app's front page is the fallback", async () => {
  const w = worker({ network: offline, stored: { [ORIGIN + "/wc2026/index.html"]: ok("front page") } });
  assert.equal((await w.request("some/new/page")).body, "front page");
});

test("other sites' requests and non-GET requests are left alone", async () => {
  const w = worker({ network: () => ok("x") });
  assert.equal(await w.request("https://site.api.espn.com/apis/site/v2/sports/soccer/x/summary?event=1"), undefined, "the live feed must go straight to the network");
  assert.equal(await w.request("data/usa/men.json", "POST"), undefined);
});
