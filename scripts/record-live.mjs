/* Records ESPN's feed for a match as it is played, so live mode can be tested
   against what the feed really sends during a game, not a finished match
   relabelled as live.

     node scripts/record-live.mjs <league>:<event> [<league>:<event> …] [--out DIR] [--wait] [--max-hours N]

   Given several matches, it records the one in progress, or else the one that
   kicks off within the next 90 minutes; if there is none it says so and exits.
   With --wait it takes the first match listed and waits for it however far off
   kickoff is (for starting it by hand hours ahead).

   What it writes into DIR:
   - index.jsonl   one line per look at the feed: time, state, clock, score,
                   how long the answer took, any error. This is the full story
                   of the match as the app would have seen it.
   - NNN-….json    a snapshot of the feed each time something changed (kickoff,
                   a goal, a card, a substitution, half time, full time) and at
                   least every five minutes. Only the parts the app reads are
                   kept, which makes each file about half the size. */
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/* The parts of the feed the app reads (see parseSummary in js/core.js). */
export const KEEP = ["header", "keyEvents", "rosters", "boxscore", "seasonseries", "lastFiveGames", "broadcasts", "gameInfo"];
export const slim = G => Object.fromEntries(KEEP.filter(k => G && G[k] != null).map(k => [k, G[k]]));

/* What the feed says right now, in a few fields. */
export function glance(G) {
  const c = (G && G.header && G.header.competitions && G.header.competitions[0]) || {};
  const st = c.status || {}, ty = st.type || {};
  const teams = (c.competitors || []).map(x => ({ name: (x.team && x.team.displayName) || "?", score: x.score == null ? null : String(x.score) }));
  const onPitch = (G && G.rosters || []).reduce((n, r) => n + ((r.roster || []).filter(p => p.starter).length), 0);
  const subs = (G && G.rosters || []).reduce((n, r) => n + ((r.roster || []).filter(p => p.subbedIn).length), 0);
  return {
    date: c.date || null, state: ty.state || "?", detail: ty.shortDetail || "", clock: st.displayClock || "", period: st.period == null ? null : st.period,
    teams, events: Array.isArray(G && G.keyEvents) ? G.keyEvents.length : 0, starters: onPitch, subs,
  };
}

/* Changes whenever something worth a snapshot has happened. The running clock
   is deliberately left out: it moves on every look. */
export const signature = g => [g.state, g.period, g.detail.replace(/[\d'’+:]/g, "").trim(), g.teams.map(t => t.score).join("-"), g.events, g.starters, g.subs].join("|");

/* Which of several matches to record now: one in progress, else the next to
   kick off within `soon`. Returns its index, or -1. */
export function pick(glances, now = Date.now(), soon = 90 * 6e4) {
  const live = glances.findIndex(g => g && g.state === "in");
  if (live >= 0) return live;
  let best = -1;
  glances.forEach((g, i) => {
    if (!g || g.state !== "pre" || !g.date) return;
    const ms = Date.parse(g.date) - now;
    if (ms > soon || ms < -3 * 36e5) return;          // too far off, or a "pre" that should have started hours ago
    if (best < 0 || Date.parse(g.date) < Date.parse(glances[best].date)) best = i;
  });
  return best;
}

/* How long to wait before the next look. */
export function nextWait(state, msToKickoff) {
  if (state === "in") return 30e3;
  if (state === "pre") return msToKickoff > 15 * 6e4 ? Math.min(10 * 6e4, msToKickoff - 14 * 6e4) : 30e3;
  return 60e3;
}

async function fetchSummary(lg, id) {
  const t0 = Date.now();
  const r = await fetch(`${API}/${lg}/summary?event=${id}`, { headers: { "User-Agent": "wc2026-recorder (github actions)" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return { G: await r.json(), ms: Date.now() - t0 };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main(argv) {
  const flag = n => argv.includes("--" + n);
  const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
  const matches = argv.filter(a => /^[a-z0-9.]+:\d+$/.test(a)).map(a => { const [lg, id] = a.split(":"); return { lg, id }; });
  if (!matches.length) { console.error("usage: node scripts/record-live.mjs <league>:<event> [...] [--out DIR] [--wait] [--max-hours N]"); process.exit(2); }
  const maxMs = Number(opt("max-hours", 3.5)) * 36e5;

  let m;
  if (flag("wait")) m = matches[0];
  else {
    const glances = await Promise.all(matches.map(x => fetchSummary(x.lg, x.id).then(r => glance(r.G), () => null)));
    glances.forEach((g, i) => console.log(`  ${matches[i].lg}:${matches[i].id}  ${g ? `${g.teams.map(t => t.name).join(" v ")}  ${g.state}  ${g.date}` : "could not be read"}`));
    const i = pick(glances);
    if (i < 0) { console.log("No listed match is in progress or about to start. Nothing to record."); return; }
    m = matches[i];
  }

  const out = opt("out", path.join("recording", m.id));
  await mkdir(out, { recursive: true });
  const index = path.join(out, "index.jsonl");
  console.log(`Recording ${m.lg}:${m.id} into ${out}`);

  let n = 0, saved = 0, failed = 0, lastSig = null, lastSave = 0, postSeen = 0, kickoff = null, lastLine = "";
  for (;;) {
    const at = new Date();
    let wait = 30e3;
    try {
      const { G, ms } = await fetchSummary(m.lg, m.id);
      const g = glance(G), sig = signature(g);
      if (g.date) kickoff = Date.parse(g.date);
      n++;
      let file = null;
      if (sig !== lastSig || Date.now() - lastSave >= 5 * 6e4) {
        file = `${String(++saved).padStart(3, "0")}-${g.state}-${(g.clock || g.detail || "x").replace(/[^0-9A-Za-z+]/g, "") || "x"}.json`;
        await writeFile(path.join(out, file), JSON.stringify({ recordedAt: at.toISOString(), league: m.lg, event: m.id, summary: slim(G) }) + "\n");
        lastSig = sig; lastSave = Date.now();
      }
      await appendFile(index, JSON.stringify({ t: at.toISOString(), ms, ...g, sig, file }) + "\n");
      const line = `${g.state} ${g.clock || g.detail} ${g.teams.map(t => `${t.name} ${t.score ?? ""}`.trim()).join(" – ")} · ${g.events} events`;
      if (file || line !== lastLine) console.log(`${at.toISOString().slice(11, 19)}  ${line}${file ? "  → " + file : ""}`);
      lastLine = line;
      if (g.state === "post" && ++postSeen >= 3) break;      // two more looks after full time, for the final stats
      wait = nextWait(g.state, kickoff - Date.now());
    } catch (e) {
      failed++;
      await appendFile(index, JSON.stringify({ t: at.toISOString(), error: String(e.message || e) }) + "\n");
      console.log(`${at.toISOString().slice(11, 19)}  ! ${e.message || e}`);
    }
    if (kickoff && Date.now() - kickoff > maxMs) { console.log("Stopping: past the time limit."); break; }
    await sleep(wait);
  }
  console.log(`\nDone: ${n} looks at the feed, ${failed} failed, ${saved} snapshots saved in ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
