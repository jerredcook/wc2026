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
      hs = isNaN(hs) ? null : hs; as = isNaN(as) ? null : as;
      // Penalty shootout: the score stays level — the tally and winner are
      // separate fields (same parsing as build-history.mjs).
      const phs = parseInt(home.shootoutScore, 10), pas = parseInt(away.shootoutScore, 10);
      const pens = (Number.isFinite(phs) && Number.isFinite(pas)) ? { h: phs, a: pas } : null;
      const wflag = home.winner === true ? "home" : (away.winner === true ? "away" : null);
      const win = (wflag && (hs === as || pens)) ? wflag : null;
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
      // Scoring plays are chronological; anything beyond the match score (hs+as)
      // is a shootout kick, so cap at the real total (own goals consume from the
      // cap but credit no scorer) — mirrors the app's parseESPNEvents.
      const goalTotal = (hs || 0) + (as || 0);
      const goals = [];
      if (Array.isArray(comp.details)) {
        let accounted = 0;
        for (const d of comp.details) {
          if (!d.scoringPlay) continue;
          if (accounted >= goalTotal) break;      // remaining plays are shootout kicks
          accounted++;
          const tx = ((d.type && (d.type.text || d.type.name)) || "") + "";
          if (/own goal/i.test(tx)) continue;
          const ath = (d.athletesInvolved && d.athletesInvolved[0]) || null;
          const name = ath && (ath.displayName || ath.shortName);
          if (!name) continue;
          const tid = (ath.team && ath.team.id) || (d.team && d.team.id);
          const team = String(tid) === String(home.id) ? homeName : (String(tid) === String(away.id) ? awayName : "");
          goals.push({ scorer: name, team, pen: /penalt/i.test(tx) });
        }
      }
      // Compact goals+cards timeline (by minute) — mirrors the app's parseESPNEvents,
      // so the inline display works in the snapshot fallback too.
      const evx = [];
      if (Array.isArray(comp.details)) {
        let gAcc = 0; // same shootout cap as `goals`: goal-kind entries beyond hs+as are shootout kicks
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
          if (k === "g" || k === "og") { gAcc++; if (gAcc > goalTotal) return; }
          const tid = (ath && ath.team && ath.team.id) || (d.team && d.team.id);
          const tm = String(tid) === String(home.id) ? homeName : (String(tid) === String(away.id) ? awayName : "");
          evx.push({ m: (d.clock && d.clock.displayValue) || "", k, n: nm, p: /penalt/i.test(tx), tm });
        });
        const mn = s => { const x = String(s || "").match(/(\d+)(?:'?\s*\+\s*(\d+))?/); return x ? +x[1] * 100 + (x[2] ? +x[2] : 0) : 9999; };
        evx.sort((a, b) => mn(a.m) - mn(b.m));
      }
      out.push({
        home: homeName, away: awayName, hs, as, hr, ar,
        pens, win,        // shootout tally + winner for drawn knockouts
        goals, ev: evx,
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
  const existingPlayed = (existing && existing.counts && existing.counts.played) || 0;

  // 2b) The day's headlines — preserved so the tournament's storylines outlive
  //     the feed. Union by link with what's already archived (never shrinks).
  let news = (existing && existing.news) || [];
  try {
    const nd = await getJSON("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/news?limit=20");
    const fresh = ((nd && nd.articles) || []).map(a => {
      const href = (((a.links || {}).web) || {}).href || "";
      return { h: a.headline || "", d: a.description || "", t: a.published || "", link: href, video: /\/video\//.test(href) };
    }).filter(a => a.h);
    const byLink = {};
    for (const a of news) byLink[a.link || a.h] = a;
    for (const a of fresh) byLink[a.link || a.h] = a;      // fresh copy wins
    news = Object.values(byLink).sort((x, y) => String(y.t).localeCompare(String(x.t))).slice(0, 300);
    console.log(`  news: ${fresh.length} fresh headline(s), ${news.length} archived`);
  } catch (e) { console.log("  news fetch skipped:", e.message); }

  // 3) Non-destructive merge with the existing archive, so a flaky or partial ESPN
  //    pull can never erase preserved data:
  //    - events: union by match id, each kept at its best-known status
  //      (FT > LIVE > UPCOMING; a tie keeps the fresher copy), so a match once
  //      captured is never dropped even if a later run omits it;
  //    - summaries: accumulate (existing, overlaid by this run) so a run that
  //      fails to fetch a summary can never drop one we already have.
  const rank = s => (s === "FT" ? 3 : (s === "LIVE" ? 2 : 1));
  const byId = {};
  for (const e of ((existing && existing.events) || [])) if (e.id) byId[e.id] = e;
  for (const e of events) {
    if (!e.id) continue;
    const prev = byId[e.id];
    if (!prev || rank(e.status) >= rank(prev.status)) byId[e.id] = e;   // best status; tie → fresher
  }
  const mergedEvents = Object.values(byId).filter(e => e.status === "FT" || e.status === "LIVE");
  mergedEvents.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));

  const rawMerged = Object.assign({}, ((existing && existing.summaries) || {}), summaries);  // existing, then new overlays
  const mergedSummaries = {};
  for (const id of Object.keys(rawMerged).sort()) mergedSummaries[id] = rawMerged[id];

  const mThrough = mergedEvents.length ? mergedEvents.map(e => e.date).sort().slice(-1)[0] : "";
  const summaryCount = Object.keys(mergedSummaries).length;

  // Skip rewriting when nothing changed, so a scheduled run doesn't churn a commit.
  const changed = !existing
    || JSON.stringify(existing.events) !== JSON.stringify(mergedEvents)
    || JSON.stringify(existing.summaries) !== JSON.stringify(mergedSummaries)
    || JSON.stringify(existing.news || []) !== JSON.stringify(news);
  if (!changed) {
    console.log(`✓ No change since last snapshot (${mergedEvents.length} matches, ${summaryCount} summaries) — leaving the file untouched.`);
  } else {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      through: mThrough,
      counts: { days: dates.length, eventsSeen: all.length, played: mergedEvents.length, summaries: summaryCount },
      events: mergedEvents,
      summaries: mergedSummaries,
      news: news
    };
    await mkdir(join(ROOT, "data"), { recursive: true });
    await writeFile(path, JSON.stringify(snapshot));
    console.log(`✓ wrote data/2026-snapshot.json — ${mergedEvents.length} matches, ${summaryCount} summaries (${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB)`);
  }

  // 4) Fail loudly if the archive has stalled: ESPN returned fewer matches than we
  //    already hold AND nothing new was captured. The merge kept the data safe, but
  //    a green run would hide a real outage (ESPN down / endpoint shape changed), so
  //    exit non-zero to trigger a workflow-failure email. (A rest day with no new
  //    matches is events.length === existingPlayed, so it does not trip this.)
  if (!changed && events.length < existingPlayed) {
    console.error(`✗ Archive has stalled: this run saw ${events.length} played/live match(es) from ESPN but the ` +
      `archive holds ${existingPlayed}, and nothing new was captured. Check the ESPN endpoint/shape. (No data was lost.)`);
    process.exitCode = 1;
  } else if (events.length < existingPlayed) {
    console.warn(`⚠ ESPN returned fewer matches (${events.length}) than the archive holds (${existingPlayed}), but new ` +
      `data was captured and merged in — committing the union. The archive kept everything.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
