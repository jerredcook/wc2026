/* Canary: are the things the live app depends on still as it expects?

     node scripts/canary.mjs

   The app reads ESPN's public feed straight from the visitor's phone, and reads
   its own data files from the live site. Neither can be watched from inside the
   app. This script checks both from the outside and exits non-zero if anything
   is off, so a scheduled run that fails sends an email before a visitor sees a
   broken card.

   What it checks:
   1. A finished match with a known result still parses to that result, using the
      app's own parser (js/core.js). This catches the feed changing shape.
   2. The feed still allows a web page to call it (the CORS header).
   3. Each team's next match can be read.
   4. The news feed answers with a list.
   5. The live site's data files were checked by the data job within the last day.
   6. The live site reports a version and a build fingerprint.

   The data job (build-usa.mjs) already fails on its own when the schedule, squad
   or Wikipedia feeds cannot be read; this covers what that job does not touch. */
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { parseSummary } = createRequire(import.meta.url)(path.join(ROOT, "js", "core.js"));

export const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";
export const SITE = "https://jerredcook.github.io/wc2026/";
const TEAMS = { women: { id: "2765", news: "fifa.friendly.w" }, men: { id: "660", news: "fifa.friendly" } };

/* A match whose result will never change: USA 1–0 Canada, 6 Oct 2026. */
export const KNOWN = { lg: "fifa.friendly", id: "401905188", usId: "660", us: 1, them: 0 };

/* How old the data job's last successful check may be before this fails. The
   app itself warns visitors at 30 hours; this is meant to fire first. */
export const FRESH_FOR = 24 * 36e5;

/* ── The checks: each takes what was fetched and returns a list of problems ── */

export function checkKnownMatch(G, known = KNOWN) {
  let L;
  try { L = parseSummary(G, known.usId); } catch (e) { return ["the app's parser threw on the feed: " + e.message]; }
  if (!L) return ["the feed no longer has the match header the app reads"];
  const out = [];
  if (L.state !== "post") out.push(`a finished match reads as "${L.state}", not full time`);
  if (L.us !== known.us || L.them !== known.them) out.push(`the score reads ${L.us}–${L.them}, expected ${known.us}–${known.them}`);
  if (!Array.isArray(L.events) || !L.events.length) out.push("no goals or cards were found in a match that had them");
  if (!Array.isArray(L.xi) || !L.xi.length) out.push("no lineups were found in a match that had them");
  return out;
}

export function checkNextMatch(G, usId) {
  let L;
  try { L = parseSummary(G, usId); } catch (e) { return ["the app's parser threw on the feed: " + e.message]; }
  if (!L) return ["the feed no longer has the match header the app reads"];
  return ["pre", "in", "post"].includes(L.state) ? [] : [`the match state reads "${L.state}"`];
}

export function checkCors(header) {
  return header === "*" || header === new URL(SITE).origin ? [] : [`the feed's cross-origin header is ${JSON.stringify(header)}: a web page may no longer be allowed to read it`];
}

export function checkNews(j) {
  if (!j || !Array.isArray(j.articles)) return ["the news feed did not answer with a list of articles"];
  const usable = j.articles.filter(a => a && a.headline && a.links && a.links.web && /^https:\/\//.test(a.links.web.href || ""));
  return j.articles.length && !usable.length ? ["the news feed has articles, but none with a headline and an https link"] : [];
}

export function checkData(d, now = Date.now()) {
  if (!d || !Array.isArray(d.fixtures) || !Array.isArray(d.results) || !Array.isArray(d.pool)) return ["the live data file is missing or malformed"];
  if (!d.checked || isNaN(Date.parse(d.checked))) return ["the live data file does not say when it was last checked"];
  const hours = Math.round((now - Date.parse(d.checked)) / 36e5);
  return now - Date.parse(d.checked) > FRESH_FOR ? [`the live data was last checked ${hours} hours ago: the data job is not running, or its results are not being published`] : [];
}

export function checkBuildFile(b, coreText) {
  const out = [];
  if (!b || typeof b.code !== "string" || !b.code) out.push("build.json is missing its fingerprint, so open copies of the app cannot notice a new build");
  if (!/const VERSION = "\d+\.\d+\.\d+(-pre)?"/.test(coreText || "")) out.push("the live js/core.js has no readable version line");
  return out;
}

/* ── Fetching ── */

async function fetchOnce(url) {
  const r = await fetch(url, { headers: { "User-Agent": "wc2026-canary (github actions)", Origin: new URL(SITE).origin }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r;
}
/* One slow or failed answer is not news; three in a row is. */
async function get(url, as = "json") {
  for (let i = 1; ; i++) {
    try { const r = await fetchOnce(url); return { body: await r[as](), cors: r.headers.get("access-control-allow-origin") }; }
    catch (e) { if (i >= 3) throw new Error(e.message); await new Promise(res => setTimeout(res, 3000 * i)); }
  }
}

async function run() {
  const results = [];
  const check = async (name, fn) => {
    try { const problems = await fn(); results.push({ name, problems }); }
    catch (e) { results.push({ name, problems: ["could not be reached: " + e.message] }); }
  };

  await check("ESPN: a finished match still reads as USA 1–0 Canada", async () => {
    const r = await get(`${API}/${KNOWN.lg}/summary?event=${KNOWN.id}`);
    return [...checkKnownMatch(r.body), ...checkCors(r.cors)];
  });

  const bust = "?canary=" + Date.now();
  for (const [key, T] of Object.entries(TEAMS)) {
    let d = null;
    await check(`Live site: ${key} data is fresh`, async () => { d = (await get(`${SITE}data/usa/${key}.json${bust}`)).body; return checkData(d); });
    const next = d && Array.isArray(d.fixtures) && d.fixtures[0];
    if (next) await check(`ESPN: ${key} next match (${next.opp && next.opp.name}) can be read`, async () => checkNextMatch((await get(`${API}/${next.lg}/summary?event=${next.id}`)).body, T.id));
    await check(`ESPN: ${key} news`, async () => checkNews((await get(`${API}/${T.news}/news?team=${T.id}&limit=10`)).body));
  }

  await check("Live site: version and build fingerprint", async () => {
    const [b, core] = await Promise.all([get(`${SITE}build.json${bust}`).catch(() => ({ body: null })), get(`${SITE}js/core.js${bust}`, "text")]);
    return checkBuildFile(b.body, core.body);
  });
  return results;
}

export function report(results) {
  const lines = results.map(r => r.problems.length ? `✗ ${r.name}\n${r.problems.map(p => "    " + p).join("\n")}` : `✓ ${r.name}`);
  const bad = results.filter(r => r.problems.length).length;
  lines.push("", bad ? `${bad} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
  return { text: lines.join("\n"), ok: !bad };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { text, ok } = report(await run());
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + text + "\n```\n");
  process.exit(ok ? 0 : 1);
}
