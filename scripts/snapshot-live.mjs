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

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCORE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=";
const SUMM  = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=";
const FULL  = process.argv.includes("--full");

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

/* YYYYMMDD for Jun 11 2026 → min(today, Jul 19 2026) — mirrors the app's
   tournamentDates() so the snapshot covers exactly what the app would fetch. */
function tournamentDates() {
  const out = [];
  const start = new Date(2026, 5, 11), end = new Date(2026, 6, 19), now = new Date();
  const last = FULL ? end : (now < end ? now : end);
  for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
    out.push("" + d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2));
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
      hs = isNaN(hs) ? null : hs; as = isNaN(as) ? null : as;
      out.push({
        home: homeName, away: awayName, hs, as, hr, ar, goals,
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
  if (!keyEvents.length && !rosters.length && !commentary.length) return null;
  return { keyEvents, rosters, commentary };
}

async function main() {
  const dates = tournamentDates();
  console.log(`Capturing ${dates.length} tournament day(s)${FULL ? " (full range)" : " (up to today)"}…`);

  // 1) All events across every day (the flat list the app's bracket consumes).
  const days = await pool(dates, 6, async ds => parseEvents(await getJSON(SCORE + ds), ds));
  const events = days.flat();
  const played = events.filter(e => e.status === "FT" || e.status === "LIVE");
  console.log(`  ${events.length} events (${played.length} played/live)`);

  // 2) Per-match detail (goals/cards, lineups, commentary) for everything with a score.
  const withId = played.filter(e => e.id);
  const summaries = {};
  let got = 0;
  await pool(withId, 8, async e => {
    const s = trimSummary(await getJSON(SUMM + encodeURIComponent(e.id)));
    if (s) { summaries[e.id] = s; got++; }
  });
  console.log(`  ${got}/${withId.length} match summaries captured`);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    through: dates[dates.length - 1] || "",
    counts: { days: dates.length, events: events.length, played: played.length, summaries: got },
    events,
    summaries
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  const path = join(ROOT, "data", "2026-snapshot.json");
  await writeFile(path, JSON.stringify(snapshot));
  console.log(`✓ wrote data/2026-snapshot.json (${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
