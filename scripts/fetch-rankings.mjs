#!/usr/bin/env node
/* Fetch the current FIFA World Ranking from FIFA's own API. Runs on the weekly
   GitHub Action. FIFA publishes on fixed dates (men ~monthly, women ~quarterly),
   so the output only changes when they do.

   Usage:
     node scripts/fetch-rankings.mjs            # men  → data/rankings.json
     node scripts/fetch-rankings.mjs --women    # women → data/rankings-women.json

   The two tables use DIFFERENT dateId schemes on FIFA's API (verified 2026-07):
   men's releases are numeric ("id15175"), women's are date-keyed
   ("ranking_20260616") — a numeric probe finds nothing in the women's space and
   vice versa. Men: keyed ranks for the app's 48 WC teams + all 211 nations.
   Women: the full table as ordered rows (rank, name, points, previous rank,
   confederation) since the app shows it as its own list.

   Pure Node, no deps. Fails loudly (exit 1) so a broken fetch emails instead of
   silently shipping a partial ranking. */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENDER = process.argv.includes("--women") ? "women" : "men";
const PAGE = `https://inside.fifa.com/fifa-world-ranking/${GENDER}`;
const OVERVIEW = n => `https://inside.fifa.com/api/ranking-overview?locale=en&dateId=id${n}`;   // numeric id in, "idNNNNN" on the wire

/* FIFA's display name → the app's TEAMS name, for the handful that differ.
   (Verified against the current men's table; extend for women's as needed.) */
const FIFA_TO_APP = {
  "Korea Republic": "South Korea",
  "Bosnia and Herzegovina": "Bosnia",
  "Côte d'Ivoire": "Ivory Coast",
  "IR Iran": "Iran",
  "Cabo Verde": "Cape Verde",
  "Congo DR": "DR Congo",
  "China PR": "China",   // (for the women's edition; harmless for men's)
  "Korea DPR": "North Korea",
  "DPR Korea": "North Korea",
  "Republic of Ireland": "Ireland",
};
/* Same normalization the app uses to key the lookup (NFD, lowercase, alnum). */
const key = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

async function getText(u) {
  const r = await fetch(u, { headers: { "User-Agent": "wc2026-rankings", "Accept": "text/html,application/json" } });
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.text();
}

/* Fetch a release's table; null if the id doesn't exist / isn't a full table. */
async function getRelease(id) {
  try {
    const d = JSON.parse(await getText(OVERVIEW(id)));
    const rows = d.rankings || [];
    if (rows.length < 150) return null;
    return { id, rows, updated: (rows[0].lastUpdateDate || "").slice(0, 10), next: (rows[0].nextUpdateDate || "").slice(0, 10) };
  } catch { return null; }
}
/* Probe the dateId space upward from a floor until a full window is empty, and
   return the highest live release. FIFA's ranking page embeds a STALE release
   list (it once topped out ~10 months behind), so the page max is only a floor —
   never the answer. Consecutive releases sit ≤ ~75 ids apart; a 160-id window
   gives >2× margin. Cost on a no-new-release day: one empty window. */
const WINDOW = 160, CONC = 8;
async function probeLatest(floor) {
  let base = floor, best = null;
  for (;;) {
    const idsToTry = Array.from({ length: WINDOW }, (_, i) => base + 1 + i);
    const hits = [];
    let i = 0;
    await Promise.all(Array.from({ length: CONC }, async () => {
      while (i < idsToTry.length) {
        const n = idsToTry[i++];
        const rel = await getRelease(n);
        if (rel) hits.push(rel);
      }
    }));
    if (!hits.length) return best;          // a whole window of misses → done
    hits.sort((a, b) => a.id - b.id);
    best = hits[hits.length - 1];
    base = best.id;                          // keep climbing from the newest hit
  }
}

async function main() {
  // 1) Floor from the ranking page's embedded (possibly stale) release list,
  //    and from the last release we stored — whichever is higher.
  const html = await getText(PAGE);
  const pageIds = [...html.matchAll(/id(\d{4,6})/g)].map(m => Number(m[1]));
  if (!pageIds.length) throw new Error("no ranking dateIds found on the FIFA page (layout changed?)");
  const path = join(ROOT, "data", "rankings.json");
  let existing = null;
  try { existing = JSON.parse(await readFile(path, "utf8")); } catch { /* none yet */ }
  const storedId = existing && existing.gender === GENDER ? Number(String(existing.dateId || "").replace(/\D/g, "")) || 0 : 0;
  const floor = Math.max(...pageIds, storedId);

  // 2) The page floor itself must be live; then probe above it for anything newer.
  const atFloor = await getRelease(floor);
  const probed = await probeLatest(floor);
  const pick = [atFloor, probed].filter(Boolean)
    .sort((a, b) => String(a.updated).localeCompare(String(b.updated)))  // newest lastUpdateDate wins
    .pop();
  if (!pick) throw new Error(`no live ranking release found at or above id${floor}`);
  const latest = "id" + pick.id;
  const rows = pick.rows;
  console.log(`  release discovery: page/stored floor id${floor}` +
    (probed && probed.id !== floor ? ` → probed up to id${pick.id}` : " (nothing newer above it)") +
    ` — using ${latest}, updated ${pick.updated}`);

  const updated = pick.updated;
  // The API often leaves nextUpdateDate empty, but the ranking page embeds it —
  // e.g. "2026-07-20", the post-Final release. Surface it so the app can say so.
  let next = pick.next;
  if (!next) { const m = html.match(/"nextUpdateDate":"(\d{4}-\d{2}-\d{2})/); if (m) next = m[1]; }

  const ranks = {};
  for (const row of rows) {
    const ri = row.rankingItem || {};
    if (ri.rank == null) continue;
    const k = key(FIFA_TO_APP[ri.name] || ri.name);
    if (k) ranks[k] = { r: ri.rank, p: ri.totalPoints, pr: ri.previousRank };
  }
  const sorted = {};
  for (const k of Object.keys(ranks).sort()) sorted[k] = ranks[k];

  const out = { source: "FIFA", gender: GENDER, dateId: latest, updated, next, count: Object.keys(sorted).length, ranks: sorted };

  if (existing && JSON.stringify(existing.ranks) === JSON.stringify(sorted) && existing.dateId === latest && (existing.next || "") === (next || "")) {
    console.log(`✓ Rankings unchanged (${out.count} teams, FIFA ${GENDER} updated ${updated}) — leaving the file.`);
    return;
  }
  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(path, JSON.stringify(out));
  console.log(`✓ wrote data/rankings.json — ${out.count} teams, FIFA ${GENDER} ranking updated ${updated} (${latest})`);
}
/* ── Women's edition ─────────────────────────────────────────────────────────
   Release ids are date-keyed (dateId=ranking_YYYYMMDD). The women's page embeds
   the current release's lastUpdateDate (and usually the nextUpdateDate); that is
   only a FLOOR — we then try every later date through today, so a stale page
   (the men's page once ran ~10 months behind) can never pin us to an old
   release. Cost between releases: ~7 probes on the weekly Action. */
const WOVERVIEW = d8 => `https://inside.fifa.com/api/ranking-overview?locale=en&dateId=ranking_${d8}`;
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
async function getWRelease(d8) {
  try {
    const data = JSON.parse(await getText(WOVERVIEW(d8)));
    const rows = data.rankings || [];
    if (rows.length < 120) return null;      // the women's table is ~200 nations
    return { id: "ranking_" + d8, rows, updated: (rows[0].lastUpdateDate || "").slice(0, 10), next: (rows[0].nextUpdateDate || "").slice(0, 10) };
  } catch { return null; }
}
async function mainWomen() {
  const html = await getText(PAGE);
  const pm = html.match(/"lastUpdateDate":"(\d{4})-(\d{2})-(\d{2})/);
  const nm = html.match(/"nextUpdateDate":"(\d{4}-\d{2}-\d{2})/);
  const path = join(ROOT, "data", "rankings-women.json");
  let existing = null;
  try { existing = JSON.parse(await readFile(path, "utf8")); } catch { /* none yet */ }
  const floors = [];
  if (pm) floors.push(pm[1] + pm[2] + pm[3]);
  if (existing && existing.updated) floors.push(String(existing.updated).replace(/\D/g, "").slice(0, 8));
  if (!floors.length) throw new Error("no lastUpdateDate on the FIFA women's page (layout changed?)");
  const floor8 = floors.sort().pop();
  const cands = [floor8];
  const floorMs = Date.parse(`${floor8.slice(0, 4)}-${floor8.slice(4, 6)}-${floor8.slice(6, 8)}T00:00:00Z`);
  for (let t = floorMs + 864e5; t <= Date.now(); t += 864e5) cands.push(ymd(t));
  let pick = null, i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < cands.length) {
      const d8 = cands[i++];
      const rel = await getWRelease(d8);
      if (rel && (!pick || rel.updated > pick.updated)) pick = rel;
    }
  }));
  if (!pick) throw new Error(`no live women's ranking release found from ${floor8} through today`);
  console.log(`  release discovery: floor ${floor8}, probed ${cands.length} dates — using ${pick.id}, updated ${pick.updated}`);

  const rowsOut = pick.rows.map(x => {
    const ri = x.rankingItem || {};
    if (ri.rank == null) return null;
    return { r: ri.rank, n: FIFA_TO_APP[ri.name] || ri.name,
             p: Math.round(ri.totalPoints * 100) / 100, pr: ri.previousRank,
             c: (x.tag && x.tag.id) || "" };
  }).filter(Boolean).sort((a, b) => a.r - b.r);
  const next = pick.next || (nm ? nm[1] : "");
  const out = { source: "FIFA", gender: "women", dateId: pick.id, updated: pick.updated, next, count: rowsOut.length, rows: rowsOut };

  if (existing && existing.dateId === out.dateId && (existing.next || "") === (next || "") &&
      JSON.stringify(existing.rows) === JSON.stringify(rowsOut)) {
    console.log(`✓ Women's ranking unchanged (${out.count} nations, FIFA release of ${pick.updated}) — leaving the file.`);
    return;
  }
  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(path, JSON.stringify(out));
  console.log(`✓ wrote data/rankings-women.json — ${out.count} nations, FIFA women's ranking of ${pick.updated}${next ? ` (next ${next})` : ""}`);
}

(GENDER === "women" ? mainWomen() : main())
  .catch(e => { console.error("✗ rankings fetch failed:", e.message); process.exit(1); });
