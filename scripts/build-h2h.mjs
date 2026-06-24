#!/usr/bin/env node
/* Build a compact World Cup head-to-head index from the historical archive
   (data/wc/<year>.json) so the live app can show past meetings between any two
   teams in the match popover. Output: data/wc/h2h.json =
     { "<normalized pair key>": [ {y, r, h, a, hs, as}, … ] }
   keyed by the two normalized team names sorted, each meeting carrying the real
   (historical) team names + score + round. West Germany folds into Germany, the
   way FIFA keeps the all-time record. Pure Node, no deps. */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WC = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "wc");

/* Normalization MUST match the app's nk() so lookups line up. */
const ALIAS = { germanyfr: "germany", westgermany: "germany" };
function nk(s) {
  const k = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIAS[k] || k;
}
const pairKey = (a, b) => [nk(a), nk(b)].sort().join("~");

async function main() {
  const files = (await readdir(WC)).filter(f => /^\d{4}\.json$/.test(f)).sort();
  const h2h = {};
  let meetings = 0;
  for (const f of files) {
    const t = JSON.parse(await readFile(join(WC, f), "utf8"));
    for (const m of (t.matches || [])) {
      if (m.hs == null || m.as == null || !m.home || !m.away) continue;
      const key = pairKey(m.home, m.away);
      (h2h[key] = h2h[key] || []).push({ y: t.year, r: m.round || "", h: m.home, a: m.away, hs: m.hs, as: m.as });
      meetings++;
    }
  }
  for (const k in h2h) h2h[k].sort((a, b) => a.y - b.y);
  await writeFile(join(WC, "h2h.json"), JSON.stringify(h2h));
  console.log(`✓ data/wc/h2h.json — ${Object.keys(h2h).length} pairings, ${meetings} meetings`);
}
main().catch(e => { console.error(e); process.exit(1); });
