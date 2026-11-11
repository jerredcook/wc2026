#!/usr/bin/env node
/* Build the USA hub data: fixtures, results and the PLAYER POOL — every recently
   called-up player with what they did in their club's last few matches
   (started / came on / unused sub / not in squad, goals, assists, cards).

   Usage:
     node scripts/build-usa.mjs            # both teams
     node scripts/build-usa.mjs --men      # → data/usa/men.json
     node scripts/build-usa.mjs --women    # → data/usa/women.json

   Source: ESPN's public site API. The pool is the union of the squads ESPN
   lists for the team's current competitions; each player's club comes from the
   squad entry, and club form from the club's last completed matches (one
   schedule call + one match summary per match, shared by club-mates).

   Pure Node, no deps. Fails loudly (exit 1) and leaves the previous file in
   place when the squad or schedule can't be read, so a feed outage never ships
   an empty hub. */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CLUB_MATCHES = 3;       // club matches of form kept per player
const CONCURRENCY = 6;

const TEAMS = {
  women: { id: "2765", label: "Women", squads: ["fifa.friendly.w"] },   // not fifa.wwc: that squad is the 2023 one
  men:   { id: "660",  label: "Men",   squads: ["fifa.friendly", "fifa.world"] },
};
const SITE = "https://jerredcook.github.io/wc2026/";

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "wc2026-usa-hub (github actions)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(url + " — " + e.message);
      await new Promise(res => setTimeout(res, 700 * i));
    }
  }
}

/* Run `fn` over `items` with a small worker pool; failures become null. */
async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); }
      catch (e) { console.warn("  ! " + e.message); out[i] = null; }
    }
  }));
  return out;
}

const scoreOf = c => {
  const s = c && c.score;
  if (s == null) return null;
  const v = typeof s === "object" ? s.displayValue : s;
  return v == null || v === "" ? null : Number(v);
};
const logoOf = t => (t && (t.logo || (t.logos && t.logos[0] && t.logos[0].href))) || null;

/* One schedule event → the slim match shape the page renders. */
function slimMatch(e, teamId) {
  const c = e.competitions[0];
  const us = c.competitors.find(x => x.team.id === teamId);
  const them = c.competitors.find(x => x.team.id !== teamId);
  if (!us || !them) return null;
  const st = c.status.type;
  const pu = us.shootoutScore, pt = them.shootoutScore;
  return {
    id: e.id,
    date: e.date,
    lg: e.league && e.league.slug,
    comp: (e.league && e.league.name) || (e.season && e.season.displayName) || "",
    round: e.league && e.league.isTournament === false && /friendly/i.test(e.league.name || "") ? "" : ((e.seasonType && e.seasonType.name) || ""),
    leg: (c.leg && c.leg.displayValue) || "",
    venue: (c.venue && c.venue.fullName) || "",
    city: (c.venue && c.venue.address && c.venue.address.city) || "",
    ha: us.homeAway === "home" ? "H" : "A",
    opp: { id: them.team.id, name: them.team.displayName, abbr: them.team.abbreviation, logo: logoOf(them.team) },
    us: scoreOf(us), them: scoreOf(them),
    pen: pu != null && pt != null ? [Number(pu), Number(pt)] : null,
    state: st.state, detail: st.shortDetail || st.detail || "",
    tv: [...new Set((c.broadcasts || []).map(b => b.media && b.media.shortName).filter(Boolean))],
  };
}

const POS = { G: "G", D: "D", M: "M", F: "F" };
const clubIdOf = a => {
  const m = /teams\/(\d+)/.exec((a.defaultTeam && a.defaultTeam.$ref) || "");
  return m ? m[1] : null;
};

/* A club's last completed matches, each with a per-athlete line. */
async function clubForm(clubId) {
  const played = d => (d.events || []).filter(e => e.competitions[0].status.type.state === "post");
  let s = await get(`${API}/all/teams/${clubId}/schedule`);
  /* Once a league's season ends (MLS/NWSL in the autumn) the default view rolls
     forward to next year's fixtures and lists nothing played — ask for the
     season by year instead. */
  if (!played(s).length) {
    const y = (s.season && s.season.year) || new Date().getUTCFullYear();
    for (const year of [y, y - 1]) {
      const alt = await get(`${API}/all/teams/${clubId}/schedule?season=${year}`);
      if (played(alt).length) { s = alt; break; }
    }
  }
  const done = played(s)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, CLUB_MATCHES);
  const matches = await pool(done, async e => {
    const c = e.competitions[0];
    const me = c.competitors.find(x => x.team.id === clubId);
    const opp = c.competitors.find(x => x.team.id !== clubId);
    const sum = await get(`${API}/${e.league.slug}/summary?event=${e.id}`);
    const ros = (sum.rosters || []).find(r => r.team && r.team.id === clubId);
    const players = {};
    for (const x of (ros && ros.roster) || []) {
      const stat = n => { const f = (x.stats || []).find(q => q.name === n); return f ? Number(f.value) || 0 : 0; };
      const sub = (x.plays || []).filter(p => p.substitution).map(p => p.clock && p.clock.displayValue).filter(Boolean);
      const line = { st: x.starter ? "S" : x.subbedIn ? "I" : "B" };
      if (x.subbedIn && sub[0]) line.on = sub[0];
      if (x.subbedOut && sub.length) line.off = sub[sub.length - 1];
      const g = stat("totalGoals"), a = stat("goalAssists"), yc = stat("yellowCards"), rc = stat("redCards");
      if (g) line.g = g; if (a) line.a = a; if (yc) line.yc = yc; if (rc) line.rc = rc;
      players[x.athlete.id] = line;
    }
    return {
      d: e.date, lg: (e.league && (e.league.abbreviation || e.league.name)) || "",
      opp: opp.team.shortDisplayName || opp.team.displayName, ha: me.homeAway === "home" ? "H" : "A",
      sf: scoreOf(me), sa: scoreOf(opp),
      hasLineups: !!(ros && ros.roster && ros.roster.length), players,
    };
  });
  return {
    club: { id: clubId, name: s.team.displayName, abbr: s.team.abbreviation, logo: logoOf(s.team) },
    matches: matches.filter(Boolean),
  };
}

/* A squad (union of the squads listed for `slugs`) with each player's club form. */
const formCache = new Map();
async function squadPool(teamId, slugs, curSlug) {
  const squads = await pool(slugs, s => get(`${API}/${s}/teams/${teamId}/roster`));
  const byId = new Map();
  squads.forEach((sq, i) => {
    for (const a of (sq && sq.athletes) || []) {
      const p = byId.get(a.id) || {
        id: a.id, name: a.displayName, pos: POS[(a.position && a.position.abbreviation) || ""] || "M",
        age: a.age || null, club: clubIdOf(a), inj: !!(a.injuries && a.injuries.length), cur: false,
      };
      if (slugs[i] === curSlug) p.cur = true;
      if (a.jersey && !p.num) p.num = a.jersey;
      byId.set(a.id, p);
    }
  });
  const players = [...byId.values()];
  const clubIds = [...new Set(players.map(p => p.club).filter(c => c && c !== teamId))];
  console.log(`  team ${teamId}: ${players.length} players from ${slugs.join(", ")} — ${clubIds.length} clubs`);
  await pool(clubIds.filter(c => !formCache.has(c)), async c => formCache.set(c, await clubForm(c)));
  for (const p of players) {
    const f = formCache.get(p.club);
    if (!f) { p.club = null; p.rec = []; continue; }
    p.club = f.club;
    p.rec = f.matches.map(m => {
      const line = m.players[p.id];
      const base = { d: m.d, lg: m.lg, opp: m.opp, ha: m.ha, sf: m.sf, sa: m.sa };
      if (!m.hasLineups) return { ...base, st: "?" };          // feed has no lineups for this match
      return line ? { ...base, ...line } : { ...base, st: "X" }; // X = not in the matchday squad
    });
  }
  const order = { G: 0, D: 1, M: 2, F: 3 };
  return players.sort((a, b) => order[a.pos] - order[b.pos] || a.name.localeCompare(b.name));
}

async function build(key) {
  const T = TEAMS[key];
  console.log(`\n== ${T.label} (team ${T.id})`);
  const [fx, rs] = await Promise.all([
    get(`${API}/all/teams/${T.id}/schedule?fixture=true`),
    get(`${API}/all/teams/${T.id}/schedule`),
  ]);
  const fixtures = (fx.events || []).map(e => slimMatch(e, T.id)).filter(Boolean)
    .filter(m => m.state !== "post").sort((a, b) => a.date.localeCompare(b.date));
  const results = (rs.events || []).map(e => slimMatch(e, T.id)).filter(Boolean)
    .filter(m => m.state === "post").sort((a, b) => b.date.localeCompare(a.date));
  if (!fixtures.length && !results.length) throw new Error("no matches in the schedule feed");
  console.log(`  ${fixtures.length} fixtures, ${results.length} results`);

  /* Squads: the next fixture's competition first (the current call-up list),
     then the standing squads. Union by athlete id; `cur` marks the current one. */
  const next = fixtures[0];
  const players = await squadPool(T.id, [...new Set([next && next.lg, ...T.squads].filter(Boolean))], next && next.lg);
  if (players.length < 11) throw new Error("squad feed returned only " + players.length + " players");

  /* The next opponent gets the same treatment, so the page can show who to
     watch on the other side. Optional: a failure here never blocks the build. */
  let opp = null;
  if (next) {
    try {
      const op = await squadPool(next.opp.id, [next.lg], next.lg);
      if (op.length >= 11) opp = { id: next.opp.id, name: next.opp.name, match: next.id, pool: op };
    } catch (e) { console.warn("  ! opponent squad: " + e.message); }
  }

  const out = {
    updated: new Date().toISOString(), team: { key, id: T.id, label: T.label },
    fixtures, results, pool: players, opp,
  };
  await mkdir(join(ROOT, "data", "usa"), { recursive: true });
  await writeFile(join(ROOT, "data", "usa", key + ".json"), JSON.stringify(out) + "\n");
  CAL[key] = calEvents(T.label, fixtures, results);
  await writeFile(join(ROOT, "data", "usa", key + ".ics"), ics(`Cap Day — USA ${T.label}`, CAL[key]));
  console.log(`  wrote data/usa/${key}.json (${players.filter(p => p.club).length}/${players.length} players with club form)`);
}

/* ── Calendar feeds ──────────────────────────────────────────────────────────
   data/usa/{women,men,all}.ics — subscribe once and every match (and its
   result afterwards) shows up in the phone's calendar. DTSTAMP is the kickoff
   time rather than "now", so an unchanged schedule produces an identical file
   and no commit. */
const CAL = {};
const icsEsc = v => String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = line => {                      // RFC 5545: continuation lines start with a space
  const parts = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) parts.push(line.slice(i, i + 72));
  return parts.join("\r\n ");
};
function calEvents(label, fixtures, results) {
  return [...results.slice(0, 12), ...fixtures].map(m => {
    const teams = m.ha === "H" ? `USA ${label} vs ${m.opp.name}` : `${m.opp.name} vs USA ${label}`;
    const done = m.state === "post" && m.us != null;
    const score = done ? (m.ha === "H" ? ` ${m.us}–${m.them}` : ` ${m.them}–${m.us}`) : "";
    const desc = [[m.comp, m.round, m.leg].filter(Boolean).join(" · "), !done && m.tv.length ? "Watch: " + m.tv.join(" / ") : "", SITE].filter(Boolean).join("\n");
    return { uid: `usa-${m.id}@capday`, start: m.date, summary: (done ? "FT: " : "") + teams + score, location: [m.venue, m.city].filter(Boolean).join(", "), desc };
  });
}
function ics(name, events) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cap Day//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsEsc(name), "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const e of events.slice().sort((a, b) => a.start.localeCompare(b.start))) {
    L.push("BEGIN:VEVENT", "UID:" + e.uid, "DTSTAMP:" + icsTime(e.start), "DTSTART:" + icsTime(e.start),
      "DTEND:" + icsTime(new Date(e.start).getTime() + 2 * 36e5), "SUMMARY:" + icsEsc(e.summary),
      "LOCATION:" + icsEsc(e.location), "DESCRIPTION:" + icsEsc(e.desc), "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

const want = ["women", "men"].filter(k => process.argv.includes("--" + k));
let failed = false;
for (const key of want.length ? want : ["women", "men"]) {
  try { await build(key); }
  catch (e) { failed = true; console.error(`FAILED ${key}: ${e.message}`); }
}
if (CAL.women && CAL.men) {
  await writeFile(join(ROOT, "data", "usa", "all.ics"), ics("Cap Day — USA Women & Men", [...CAL.women, ...CAL.men]));
  console.log("\nwrote data/usa/all.ics");
}
process.exit(failed ? 1 : 0);
