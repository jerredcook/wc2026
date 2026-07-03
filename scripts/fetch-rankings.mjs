#!/usr/bin/env node
/* Fetch the current FIFA World Ranking from FIFA's own API and write a compact
   data/rankings.json that the app reads to show each team's *current* rank next
   to its *start-of-tournament* rank (the hardcoded TEAMS[].rank). Runs on the
   daily GitHub Action alongside the snapshot. FIFA publishes on fixed dates
   (~monthly), so this only changes when they do.

   Usage:
     node scripts/fetch-rankings.mjs            # men's ranking (default)
     node scripts/fetch-rankings.mjs --women    # women's ranking (for the WWC edition)

   Pure Node, no deps. Fails loudly (exit 1) so a broken fetch emails instead of
   silently shipping a partial ranking. */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENDER = process.argv.includes("--women") ? "women" : "men";
const PAGE = `https://inside.fifa.com/fifa-world-ranking/${GENDER}`;
const OVERVIEW = id => `https://inside.fifa.com/api/ranking-overview?locale=en&dateId=${id}`;

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
};
/* Same normalization the app uses to key the lookup (NFD, lowercase, alnum). */
const key = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

async function getText(u) {
  const r = await fetch(u, { headers: { "User-Agent": "wc2026-rankings", "Accept": "text/html,application/json" } });
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.text();
}

async function main() {
  // 1) The latest release is the highest dateId listed on the ranking page.
  const html = await getText(PAGE);
  const ids = [...html.matchAll(/id(\d{4,6})/g)].map(m => Number(m[1]));
  if (!ids.length) throw new Error("no ranking dateIds found on the FIFA page (layout changed?)");
  const latest = "id" + Math.max(...ids);

  // 2) The full 200+ team table for that release.
  const data = JSON.parse(await getText(OVERVIEW(latest)));
  const rows = data.rankings || [];
  if (rows.length < 150) throw new Error(`only ${rows.length} teams for ${latest} — refusing to write a partial ranking`);

  const updated = (rows[0].lastUpdateDate || "").slice(0, 10);
  const next = (rows[0].nextUpdateDate || "").slice(0, 10);

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
  const path = join(ROOT, "data", "rankings.json");

  let existing = null;
  try { existing = JSON.parse(await readFile(path, "utf8")); } catch { /* none yet */ }
  if (existing && JSON.stringify(existing.ranks) === JSON.stringify(sorted) && existing.dateId === latest) {
    console.log(`✓ Rankings unchanged (${out.count} teams, FIFA ${GENDER} updated ${updated}) — leaving the file.`);
    return;
  }
  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(path, JSON.stringify(out));
  console.log(`✓ wrote data/rankings.json — ${out.count} teams, FIFA ${GENDER} ranking updated ${updated} (${latest})`);
}
main().catch(e => { console.error("✗ rankings fetch failed:", e.message); process.exit(1); });
