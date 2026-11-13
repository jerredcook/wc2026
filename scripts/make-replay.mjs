/* Turns a recording made by scripts/record-live.mjs into a test fixture: the
   moments of the match where what the app shows would change, each cut down to
   the fields the app reads.

     node scripts/make-replay.mjs <recording dir> > test/fixtures/replay-<name>.json

   A recording is 8 MB of snapshots; most differ only in the minute on the
   clock. A moment is kept when one of these changed since the last one kept:
   the state (before, live, finished), a break in play (half time), the score,
   the goals and cards listed, whether lineups or a running clock are present,
   and whether the match numbers are still all zero. Within a kept moment, a
   part of the feed that is the same as in the moment before is left out; the
   test helper (replay in test/helpers/page.cjs) carries it forward. */
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const pickFrom = (o, keys) => o == null ? undefined : Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const list = (a, fn) => Array.isArray(a) ? a.map(fn) : undefined;

/* Only what parseSummary (js/core.js) and test mode (loadTest in index.html) read. */
export function trim(G) {
  const c = G.header && G.header.competitions && G.header.competitions[0];
  const out = {};
  if (G.header) out.header = {
    season: pickFrom(G.header.season, ["name"]), league: pickFrom(G.header.league, ["name"]),
    competitions: c ? [{
      date: c.date, leg: pickFrom(c.leg, ["displayValue"]), status: c.status,
      competitors: list(c.competitors, x => ({
        ...pickFrom(x, ["id", "homeAway", "score", "shootoutScore", "winner"]),
        team: x.team && { ...pickFrom(x.team, ["id", "displayName", "abbreviation", "logo"]), logos: list((x.team.logos || []).slice(0, 1), l => ({ href: l.href })) },
      })),
    }] : [],
  };
  if (G.keyEvents) out.keyEvents = G.keyEvents.map(k => ({
    id: k.id, type: pickFrom(k.type, ["type"]), clock: pickFrom(k.clock, ["displayValue"]), scoringPlay: k.scoringPlay, shootout: k.shootout,
    team: pickFrom(k.team, ["id"]), participants: list(k.participants, p => ({ athlete: pickFrom(p.athlete, ["displayName"]) })), shortText: k.shortText,
  }));
  if (G.rosters) out.rosters = G.rosters.map(r => ({
    homeAway: r.homeAway, formation: r.formation, team: pickFrom(r.team, ["id", "displayName"]),
    roster: list(r.roster, x => ({ starter: x.starter, jersey: x.jersey, athlete: pickFrom(x.athlete, ["displayName"]), position: pickFrom(x.position, ["abbreviation"]) })),
  }));
  if (G.boxscore) out.boxscore = { teams: list(G.boxscore.teams, t => ({ team: pickFrom(t.team, ["id"]), statistics: list(t.statistics, q => ({ name: q.name, displayValue: q.displayValue })) })) };
  if (G.seasonseries) out.seasonseries = G.seasonseries.slice(0, 1).map(s => ({
    summary: s.summary,
    events: list(s.events, e => ({ status: e.status, date: e.date, competitionName: e.competitionName, competitors: list(e.competitors, x => ({ team: pickFrom(x.team, ["id"]), score: x.score })) })),
  }));
  if (G.lastFiveGames) out.lastFiveGames = G.lastFiveGames.map(t => ({
    team: pickFrom(t.team, ["id", "displayName"]),
    events: list(t.events, e => ({ ...pickFrom(e, ["gameDate", "gameResult", "homeTeamId", "homeTeamScore", "awayTeamScore", "atVs"]), opponent: pickFrom(e.opponent, ["abbreviation", "displayName"]) })),
  }));
  if (G.broadcasts) out.broadcasts = G.broadcasts.map(b => ({ media: pickFrom(b.media, ["shortName"]) }));
  if (G.gameInfo) out.gameInfo = { venue: G.gameInfo.venue && { fullName: G.gameInfo.venue.fullName, address: pickFrom(G.gameInfo.venue.address, ["city"]) } };
  return JSON.parse(JSON.stringify(out));     // drops the fields that were not there
}

/* What decides whether a moment looks different on the match card. */
export function shape(G) {
  const c = (G.header && G.header.competitions && G.header.competitions[0]) || {}, st = c.status || {}, ty = st.type || {};
  const shown = (G.keyEvents || []).filter(k => k.scoringPlay || /card/.test((k.type && k.type.type) || "")).map(k => k.id);
  const counted = ((G.boxscore && G.boxscore.teams) || []).some(t => (t.statistics || []).some(q => parseFloat(q.displayValue) > 0));
  return JSON.stringify([
    ty.state, ty.state === "in" && !/\d/.test(ty.shortDetail || "") ? ty.shortDetail : "", (c.competitors || []).map(x => [x.score, x.shootoutScore]),
    shown, (G.rosters || []).filter(r => (r.roster || []).length).length, ty.state === "in" ? !!st.displayClock : null, counted,
  ]);
}

/* snapshots: [{ recordedAt, league, event, summary }] in the order recorded. */
export function makeReplay(snapshots, looks = []) {
  const frames = [], carried = {};
  let last = null;
  for (const s of snapshots) {
    const sh = shape(s.summary);
    if (sh === last) continue;
    last = sh;
    const T = trim(s.summary), part = {};
    for (const k of Object.keys(T)) if (JSON.stringify(T[k]) !== JSON.stringify(carried[k])) { part[k] = T[k]; carried[k] = T[k]; }
    frames.push({ at: s.recordedAt, summary: part });
  }
  const first = snapshots[0] || {}, c = carried.header && carried.header.competitions[0];
  const when = state => (looks.find(l => l.state === state) || {}).t || null;
  return {
    about: "Recorded from the live feed by scripts/record-live.mjs and cut down by scripts/make-replay.mjs. Each frame holds only the parts that changed since the frame before.",
    league: first.league, event: first.event, match: c ? c.competitors.map(x => x.team.displayName).join(" v ") : "",
    scheduled: c ? c.date : null, wentLive: when("in"), finished: when("post"), looks: looks.length, frames,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node scripts/make-replay.mjs <recording dir> > test/fixtures/replay-<name>.json"); process.exit(2); }
  const snaps = readdirSync(dir).filter(f => /^\d+-.*\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  let looks = [];
  try { looks = readFileSync(path.join(dir, "index.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)).filter(l => !l.error); } catch (e) {}
  const R = makeReplay(snaps, looks);
  process.stdout.write(JSON.stringify(R) + "\n");
  console.error(`${R.match}: ${snaps.length} snapshots → ${R.frames.length} frames`);
}
