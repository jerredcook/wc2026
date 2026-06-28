#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────────
   snapshot-live.mjs — preserve the LIVE 2026 World Cup data.

   The app pulls 2026 scores/scorers/lineups/commentary live from ESPN and
   stores nothing. This captures that feed into a committed file so the app
   keeps working a year from now even if ESPN drops or changes the data:

     data/2026-snapshot.json = {
       capturedAt,                 // when this snapshot was taken
       through,                    // last tournament day captured (YYYYMMDD)
       counts: {days, events, played, summaries},
       events:   [ … ],            // EXACT shape of the app's parseESPNEvents(),
                                   //   so it drops straight into applyLive /
                                   //   applyBracket / aggregateScorers
       summaries:{ eid: {keyEvents, rosters, commentary} }  // per-match detail
     }

   The app uses this only as a FALLBACK — live data is still preferred while
   the tournament is on. Re-run this periodically during the tournament and
   once more after the final for the permanent record:

       node scripts/snapshot-live.mjs            # capture up to today
       node scripts/snapshot-live.mjs --full     # ignore the "today" cap

   Pure Node, no dependencies (Node 18+ for global fetch).
   ────────────────────────────────────────────────────────────────────────── */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCORE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=";
const SUMM  = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=";
/* By default we query the FULL tournament window (clock-independent), because
   this runs on servers whose wall clock is not the tournament's — depending on
   `new Date()` for the range made a scheduled run query the wrong dates and get
   nothing back. `--today` opts into capping at today for quick local runs. */
const CAP_TODAY = process.argv.includes("--today");

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "wc2026-snapshot/1.0" } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

/* Run `fn` over `items` with limited concurrency. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* YYYYMMDD for every day of the tournament (Jun 11 → Jul 19 2026). Fixed window
   by default so the date range never depends on the machine's clock; `--today`
   caps it at today for incremental local runs. Built in UTC to be timezone-proof. */
function tournamentDates() {
  const out = [];
  const start = Date.UTC(2026, 5, 11), end = Date.UTC(2026, 6, 19);
  const last = CAP_TODAY ? Math.min(Date.now(), end) : end;
  for (let t = start; t <= last; t += 86400000) {
    const d = new Date(t);
    out.push("" + d.getUTCFullYear() + ("0" + (d.getUTCMonth() + 1)).slice(-2) + ("0" + d.getUTCDate()).slice(-2));
  }
  return out;
}

/* Port of the app's parseESPNEvents() — produces the identical event shape so
   the snapshot is a drop-in for the live pipeline. */
function parseEvents(data, ds) {
  const out = [];
  (((data || {}).events) || []).forEach(ev => {
    try {
      const comp = (ev.competitions && ev.competitions[0]) || {};
      const cs = comp.competitors || [];
      const home = cs.find(c => c.homeAway === "home") || cs[0];
      const away = cs.find(c => c.homeAway === "away") || cs[1];
      if (!home || !away) return;
      const stt = ((ev.status || comp.status || {}).type) || {};
      const st = stt.state;
      const status = st === "in" ? "LIVE" : (st === "post" ? "FT" : "UPCOMING");
      let hs = status === "UPCOMING" ? null : parseInt(home.score, 10);
      let as = status === "UPCOMING" ? null : parseInt(away.score, 10);
      const clk = (ev.status || comp.status || {}).displayClock;
      let hr = parseInt(home.redCards, 10); if (isNaN(hr)) hr = 0;
      let ar = parseInt(away.redCards, 10); if (isNaN(ar)) ar = 0;
      if (hr === 0 && ar === 0 && Array.isArray(comp.details)) {
        comp.details.forEach(d => {
          const tx = ((d.type && (d.type.text || d.type.name)) || "") + "";
          if (!(d.redCard === true || /red card|second yellow|sent off|ejection/i.test(tx))) return;
          const tid = d.team && d.team.id;
          if (tid && home.id && String(tid) === String(home.id)) hr++;
          else if (tid && away.id && String(tid) === String(away.id)) ar++;
        });
      }
      const homeName = (home.team && (home.team.displayName || home.team.shortDisplayName || home.team.name)) || "";
      const awayName = (away.team && (away.team.displayName || away.team.shortDisplayName || away.team.name)) || "";
      const goals = [];
      if (Array.isArray(comp.details)) {
        comp.details.forEach(d => {
          const tx = ((d.type && (d.type.text || d.type.name)) || "") + "";
          if (!d.scoringPlay || /own goal/i.test(tx)) return;
          const ath = (d.athletesInvolved && d.athletesInvolved[0]) || null;
          const name = ath && (ath.displayName || ath.shortName);
          if (!name) return;
          const tid = (ath.team && ath.team.id) || (d.team && d.team.id);
          const team = String(tid) === String(home.id) ? homeName : (String(tid) === String(away.id) ? awayName : "");
          goals.push({ scorer: name, team, pen: /penalt/i.test(tx) });
        });
      }
      // Compact goals+cards timeline (by minute) — mirrors the app's parseESPNEvents,
      // so the inline display works in the snapshot fallback too.
      const evx = [];
      if (Array.isArray(comp.details)) {
        comp.details.forEach(d => {
          const tx = ((d.type && (d.type.text || d.type.name)) || "") + "";
          const ath = (d.athletesInvolved && d.athletesInvolved[0]) || null;
          const nm = ath && (ath.shortName || ath.displayName);
          let k = null;
          if (/own goal/i.test(tx)) k = "og";
          else if (d.scoringPlay || /goal/i.test(tx)) k = "g";
          else if (d.redCard === true || /red card|second yellow|sent off|ejection/i.test(tx)) k = "r";
          else if (d.yellowCard === true || /yellow card/i.test(tx)) k = "y";
          if (!k || !nm) return;
          const tid = (ath && ath.team && ath.team.id) || (d.team && d.team.id);
          const tm = String(tid) === String(home.id) ? homeName : (String(tid) === String(away.id) ? awayName : "");
          evx.push({ m: (d.clock && d.clock.displayValue) || "", k, n: nm, p: /penalt/i.test(tx), tm });
        });
        const mn = s => { const x = String(s || "").match(/(\d+)(?:'?\s*\+\s*(\d+))?/); return x ? +x[1] * 100 + (x[2] ? +x[2] : 0) : 9999; };
        evx.sort((a, b) => mn(a.m) - mn(b.m));
      }
      hs = isNaN(hs) ? null : hs; as = isNaN(as) ? null : as;
      out.push({
        home: homeName, away: awayName, hs, as, hr, ar, goals, ev: evx,
        status, minute: (status === "LIVE" && clk) ? clk : null,
        id: ev.id || "", date: ds || "",
        venue: (comp.venue && comp.venue.fullName) || ""
      });
    } catch (e) { /* skip malformed */ }
  });
  return out;
}

/* Trim a match summary to exactly the fields the popover renders. */
function trimSummary(d) {
  if (!d) return null;
  const keyEvents = ((d.keyEvents) || [])
    .filter(x => { const t = (x.type && x.type.text) || ""; return /goal|card/i.test(t); })
    .map(x => ({
      type: { text: (x.type && x.type.text) || "" },
      clock: { displayValue: (x.clock && x.clock.displayValue) || "" },
      text: x.text || ""
    }));
  const rosters = ((d.rosters) || []).map(t => ({
    team: { displayName: (t.team && t.team.displayName) || "" },
    roster: ((t.roster) || []).map(p => ({
      starter: !!p.starter,
      jersey: p.jersey || "",
      athlete: { displayName: (p.athlete && p.athlete.displayName) || "" }
    }))
  })).filter(t => t.roster.length);
  const commentary = ((d.commentary) || []).map(x => ({
    time: { displayValue: (x.time && x.time.displayValue) || "" },
    text: x.text || ""
  }));
  // Team stats (the popover renders a curated set — keep just those, lean).
  const WANT = new Set(["possessionPct","totalShots","shotsOnTarget","wonCorners","foulsCommitted","offsides","yellowCards","redCards","saves"]);
  const bt = (d.boxscore && d.boxscore.teams) || [];
  const boxscore = bt.length >= 2 ? { teams: bt.map(t => ({
    homeAway: t.homeAway,
    team: { displayName: (t.team && t.team.displayName) || "" },
    statistics: (t.statistics || []).filter(s => WANT.has(s.name)).map(s => ({ name: s.name, displayValue: s.displayValue }))
  })) } : null;
  if (!keyEvents.length && !rosters.length && !commentary.length && !boxscore) return null;
  const out = { keyEvents, rosters, commentary };
  if (boxscore) out.boxscore = boxscore;
  return out;
}

async function main() {
  const path = join(ROOT, "data", "2026-snapshot.json");
  const dates = tournamentDates();
  console.log(`Capturing ${dates.length} tournament day(s)${CAP_TODAY ? " (up to today)" : " (full window Jun 11–Jul 19)"}…`);

  // 1) Every played/live match across the window (the list the app pipeline consumes).
  //    UPCOMING fixtures carry no data and live in the app's schedule already, so we keep
  //    only matches that actually have a result.
  const all = (await pool(dates, 6, async ds => parseEvents(await getJSON(SCORE + ds), ds))).flat();
  const events = all.filter(e => e.status === "FT" || e.status === "LIVE");
  // Stable order so identical data always serializes identically (no commit churn).
  events.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const daysWithData = new Set(events.map(e => e.date)).size;
  const through = events.length ? events.map(e => e.date).sort().slice(-1)[0] : "";
  console.log(`  ${all.length} events seen, ${events.length} played/live across ${daysWithData} day(s); through ${through || "—"}`);

  // 2) Per-match detail (goals/cards, lineups, commentary) for each played match.
  const withId = events.filter(e => e.id);
  const raw = {};
  let got = 0;
  await pool(withId, 8, async e => {
    const s = trimSummary(await getJSON(SUMM + encodeURIComponent(e.id)));
    if (s) { raw[e.id] = s; got++; }
  });
  // Sort keys: the pool fills them in network-completion order, which varies per
  // run — sorting makes the serialization deterministic so unchanged data == no commit.
  const summaries = {};
  for (const id of Object.keys(raw).sort()) summaries[id] = raw[id];
  console.log(`  ${got}/${withId.length} match summaries captured`);

  let existing = null;
  try { existing = JSON.parse(await readFile(path, "utf8")); } catch (e) { /* none yet */ }

  // 3a) Protect the archive: never overwrite a good snapshot with fewer matches.
  //     A run that comes back empty (ESPN down, queried the wrong dates, network
  //     blocked) must not erase real preserved data — matches only accumulate.
  const existingPlayed = (existing && existing.counts && existing.counts.played) || 0;
  if (events.length < existingPlayed) {
    console.log(`✗ Only ${events.length} played match(es) this run, but the existing snapshot has ${existingPlayed}. ` +
      `Keeping the existing archive (not overwriting). Likely ESPN was unreachable or returned no data.`);
    return;
  }

  // 3b) Skip rewriting when the actual match data is unchanged, so a scheduled
  //     run doesn't churn a commit just because the capture timestamp moved.
  if (existing && JSON.stringify(existing.events) === JSON.stringify(events)
      && JSON.stringify(existing.summaries) === JSON.stringify(summaries)) {
    console.log(`✓ No change since last snapshot (${events.length} matches) — leaving the file untouched.`);
    return;
  }

  const snapshot = {
    capturedAt: new Date().toISOString(),
    through,
    counts: { days: dates.length, eventsSeen: all.length, played: events.length, summaries: got },
    events,
    summaries
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot));
  console.log(`✓ wrote data/2026-snapshot.json — ${events.length} matches, ${got} summaries (${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
