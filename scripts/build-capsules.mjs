#!/usr/bin/env node
/* Build a per-team World Cup "pedigree" capsule from the historical archive
   (data/wc/<year>.json) — each current finalist's last few appearances with
   how far they went — and inject it into index.html between the CAPSULES
   markers as a plain JS const. Re-runnable any time (idempotent). */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WC = join(ROOT, "data", "wc");

const ALIAS = {
  germanyfr: "germany", westgermany: "germany",
  unitedstates: "usa", korearepublic: "southkorea", cotedivoire: "ivorycoast",
  iriran: "iran", bosniaandherzegovina: "bosnia", turkey: "turkiye",
  czechrepublic: "czechia", czechoslovakia: "czechia", zaire: "drcongo",
  caboverde: "capeverde", congodr: "drcongo",
};
const nk = s => { const k = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); return ALIAS[k] || k; };

const R = r => {
  r = String(r || "").toLowerCase();
  if (/final$/.test(r) && !/semi|quarter/.test(r)) return "F";
  if (/third|3rd/.test(r)) return "3RD";
  if (/semi/.test(r)) return "SF";
  if (/quarter/.test(r)) return "QF";
  if (/16/.test(r)) return "R16";
  if (/32/.test(r)) return "R32";
  if (/second round|2nd round/.test(r)) return "R2";
  if (/first round|1st round|group/.test(r)) return "GRP";
  return "GRP";
};
const ORDER = { GRP: 0, R2: 1, R32: 1, R16: 2, QF: 3, SF: 4, "3RD": 4, F: 5 };

function finishFor(team, matches) {
  const k = nk(team);
  const mine = matches.filter(m => nk(m.home) === k || nk(m.away) === k);
  if (!mine.length) return null;
  let deep = null;
  for (const m of mine) { const r = R(m.round); if (!deep || ORDER[r] >= ORDER[R(deep.round)]) deep = m; }
  const r = R(deep.round);
  const isH = nk(deep.home) === k;
  const won = deep.win ? ((deep.win === "home") === isH) : (isH ? deep.hs > deep.as : deep.as > deep.hs);
  if (r === "F") return won ? "🏆" : "final";
  if (r === "3RD") return won ? "3rd" : "4th";
  if (r === "SF") return "SF";
  return r === "GRP" ? "group" : r;
}

async function main() {
  const files = (await readdir(WC)).filter(f => /^\d{4}\.json$/.test(f)).sort().reverse();
  const years = [];
  for (const f of files) years.push(JSON.parse(await readFile(join(WC, f), "utf8")));

  const html0 = await readFile(join(ROOT, "index.html"), "utf8");
  const teams = [...html0.matchAll(/"([^"]+)":\{flag:"[^"]*",group:"[A-L]"/g)].map(m => m[1]);
  if (teams.length !== 48) throw new Error("expected 48 teams, got " + teams.length);

  const caps = {};
  for (const t of teams) {
    const line = [];
    for (const y of years) {
      const fin = finishFor(t, y.matches || []);
      if (fin) line.push(y.year + " " + fin);
      if (line.length >= 5) break;
    }
    if (line.length) caps[t] = line.join(" · ");
  }
  const block = "/*CAPSULES-START*/const CAPSULES=" + JSON.stringify(caps) + ";/*CAPSULES-END*/";
  const html = html0.replace(/\/\*CAPSULES-START\*\/[\s\S]*?\/\*CAPSULES-END\*\//, block);
  if (html === html0) throw new Error("CAPSULES markers not found in index.html");
  await writeFile(join(ROOT, "index.html"), html);
  console.log("✓ capsules injected for " + Object.keys(caps).length + " of 48 teams");
  for (const t of ["France", "Argentina", "USA", "Morocco"]) console.log("  " + t + ": " + (caps[t] || "(debut)"));
}
main().catch(e => { console.error(e); process.exit(1); });
