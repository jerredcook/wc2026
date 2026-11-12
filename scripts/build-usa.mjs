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

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CLUB_MATCHES = 3;       // club matches of form kept per player
const CONCURRENCY = 6;

const TEAMS = {
  women: { id: "2765", label: "Women", squads: ["fifa.friendly.w"], wiki: "United States women's national soccer team" },   // not fifa.wwc: that squad is the 2023 one
  men:   { id: "660",  label: "Men",   squads: ["fifa.friendly", "fifa.world"], wiki: "United States men's national soccer team" },
};
const WIKI = "https://en.wikipedia.org/w/api.php?format=json&";
const SITE = "https://jerredcook.github.io/wc2026/";

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "wc2026-usa-hub (github actions)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(url + " — " + e.message);
      await new Promise(res => setTimeout(res, (/429/.test(e.message) ? 4000 : 700) * i));
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

/* ── Caps and the real call-up list, from Wikipedia ──────────────────────────
   The national-team article keeps two tables: "Current squad" (the players
   actually named for the latest camp) and "Recent call-ups", each with caps
   and goals and an "as of" date. ESPN's squad lists are broader and carry no
   caps, so Wikipedia decides who is in the pool and ESPN supplies club form. */
const unwiki = t => String(t || "")
  .replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "").replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\{\{(?:fb|fbw|#invoke:flag\|fbw?)\|([A-Z]{3})\}\}/g, "$1")
  .replace(/\{\{[^{}]*\}\}/g, "").replace(/<[^>]+>/g, "").replace(/'{2,}/g, "").replace(/\s+/g, " ").trim();
const nameKey = n => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim();
function wikiPlayer(line, called) {
  const f = k => { const m = new RegExp("\\|\\s*" + k + "\\s*=\\s*([^|}]*)").exec(line); return m ? m[1].trim() : ""; };
  const sn = /name\s*=\s*\{\{sortname\|([^|}]*)\|([^|}]*)/i.exec(line), ln = /name\s*=\s*\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/.exec(line);
  const name = sn ? (sn[1].trim() + " " + sn[2].trim()).trim() : ln ? ln[1].trim() : "";
  if (!name) return null;
  const b = /birth date and age\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i.exec(line);
  let age = null;
  if (b) { const now = new Date(), d = new Date(Date.UTC(+b[1], +b[2] - 1, +b[3])); age = now.getUTCFullYear() - d.getUTCFullYear() - (now < new Date(Date.UTC(now.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) ? 1 : 0); }
  const club = /club\s*=\s*\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/.exec(line);
  const lm = /latest\s*=\s*([\s\S]*)\}\}\s*$/.exec(line), raw = lm ? lm[1] : "";
  const flag = (/\b(RET|INJ|SUS|PRE|WD|COV)\b/.exec(raw.replace(/\{\{(?:fbw?|#invoke:flag\|fbw?)\|[A-Z]{3}\}\}/g, "")) || [])[1] || "";
  return {
    name, pos: { GK: "G", DF: "D", MF: "M", FW: "F" }[f("pos")] || "M", age,
    caps: f("caps") === "" ? null : Number(f("caps")) || 0, goals: f("goals") === "" ? null : Number(f("goals")) || 0,
    wclub: club ? club[1].trim() : "", called, flag,
    latest: called ? "" : unwiki(raw.replace(/<sup>[\s\S]*?<\/sup>/g, "")).replace(/^v\.?\s*/, "v ").replace(/\s*;\s*/, ", "),
  };
}
async function wikiSquad(title) {
  const d = await get(WIKI + "action=parse&prop=wikitext&redirects=1&page=" + encodeURIComponent(title));
  const t = d.parse.wikitext["*"];
  const a = t.search(/={2,4}\s*Current squad\s*={2,4}/i);
  if (a < 0) throw new Error("no Current squad section");
  const r = t.slice(a).search(/={2,4}\s*Recent call-ups\s*={2,4}/i);
  const cur = t.slice(a, r < 0 ? a + 20000 : a + r), rest = r < 0 ? "" : t.slice(a + r);
  const end = rest.slice(20).search(/\n={2,3}[^=]/);
  const rec = end < 0 ? rest : rest.slice(0, end + 20);
  const rows = (txt, re, called) => (txt.match(re) || []).map(l => wikiPlayer(l, called)).filter(Boolean);
  const current = rows(cur, /\{\{nat fs g player[^\n]*/gi, true), recent = rows(rec, /\{\{nat fs r player[^\n]*/gi, false);
  const intro = (cur.split("\n").find(l => /^The following/i.test(l.trim())) || "");
  const asOf = /(?:updated|correct) as of ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(cur);
  return { note: unwiki(intro), asOf: asOf ? asOf[1] : "", players: [...current, ...recent] };
}

/* ── Stadium details, from Wikipedia ── */
const venueCache = new Map();
async function venueInfo(name, city) {
  if (!name) return null;
  if (venueCache.has(name)) return venueCache.get(name);
  let out = null;
  try {
    let title = null;
    for (const q of [name, name + " " + String(city || "").split(",")[0], name + " stadium"]) {
      const o = await get(WIKI + "action=opensearch&limit=3&search=" + encodeURIComponent(q));
      title = (o[1] || []).find(x => nameKey(x).includes(nameKey(name).split(" ")[0])) || null;
      if (title) break;
    }
    if (title) {
      const sum = await get("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")));
      if (/stadium|arena|ground|park|field/i.test((sum.description || "") + " " + (sum.extract || "").slice(0, 200))) {
        const w = (await get(WIKI + "action=parse&prop=wikitext&redirects=1&section=0&page=" + encodeURIComponent(title))).parse.wikitext["*"];
        const box = k => { const m = new RegExp("\\n\\s*\\|\\s*" + k + "\\s*=\\s*([^\\n]*)").exec(w); return m ? unwiki(m[1]).replace(/^\*\s*/, "") : ""; };
        const cap = /(\d{1,3}(?:,\d{3})+|\d{4,6})/.exec(box("capacity")), opened = /\b(18|19|20)\d{2}\b/.exec(box("opened"));
        const ten = box("tenants").split(/\)\s*(?=[A-Z])|\s*\*\s*/).map(x => x.replace(/\(.*$/, "").trim()).filter(Boolean).slice(0, 3);
        out = {
          title: sum.title, url: sum.content_urls && sum.content_urls.desktop ? sum.content_urls.desktop.page : "",
          blurb: (sum.extract || "").split(/(?<=\.)\s/).slice(0, 2).join(" "), img: (sum.thumbnail && sum.thumbnail.source) || "",
          capacity: cap ? Number(cap[1].replace(/,/g, "")) : null, opened: opened ? Number(opened[0]) : null, tenants: ten,
        };
      }
    }
  } catch (e) { console.warn("  ! venue " + name + ": " + e.message); }
  venueCache.set(name, out);
  return out;
}

/* ── Where the competition stands ────────────────────────────────────────────
   For a knockout round: every tie in the round (both legs where there are
   two). For a group stage: the table of the group the USA is in. */
const dayStr = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
async function standing(m, teamId) {
  const days = []; for (let i = -6; i <= 6; i++) days.push(dayStr(new Date(m.date).getTime() + i * 864e5));
  const boards = await pool(days, d => get(`${API}/${m.lg}/scoreboard?dates=${d}`));
  const evs = new Map();
  for (const b of boards) for (const e of (b && b.events) || []) evs.set(e.id, e);
  const mine = evs.get(m.id);
  const slug = mine && mine.season && mine.season.slug;
  if (!slug) return null;
  if (/group/.test(slug)) {
    const st = await get(`https://site.api.espn.com/apis/v2/sports/soccer/${m.lg}/standings`);
    const g = (st.children || []).find(c => ((c.standings || {}).entries || []).some(e => e.team.id === teamId));
    if (!g) return null;
    const v = (e, n) => { const x = e.stats.find(q => q.name === n); return x ? x.displayValue : ""; };
    return { kind: "table", title: g.name, rows: g.standings.entries.map(e => ({
      name: e.team.displayName, logo: logoOf(e.team), us: e.team.id === teamId,
      p: v(e, "gamesPlayed"), w: v(e, "wins"), d: v(e, "ties"), l: v(e, "losses"), gd: v(e, "pointDifferential"), pts: v(e, "points") })) };
  }
  const ties = new Map();
  for (const e of evs.values()) {
    if (!e.season || e.season.slug !== slug) continue;
    const c = e.competitions[0], h = c.competitors.find(x => x.homeAway === "home"), a = c.competitors.find(x => x.homeAway === "away");
    if (!h || !a) continue;
    const key = [h.team.id, a.team.id].sort().join("-");
    const t = ties.get(key) || { us: false, teams: {}, legs: [] };
    for (const x of [h, a]) t.teams[x.team.id] = { name: x.team.displayName, abbr: x.team.abbreviation, logo: logoOf(x.team) };
    if (h.team.id === teamId || a.team.id === teamId) t.us = true;
    const done = c.status.type.state !== "pre";
    t.legs.push({ id: e.id, date: e.date, home: h.team.id, away: a.team.id, hs: done ? scoreOf(h) : null, as: done ? scoreOf(a) : null, state: c.status.type.state });
    ties.set(key, t);
  }
  const list = [...ties.values()].map(t => ({ ...t, legs: t.legs.sort((x, y) => x.date.localeCompare(y.date)) }))
    .sort((x, y) => (y.us - x.us) || x.legs[0].date.localeCompare(y.legs[0].date));
  return list.length ? { kind: "ties", title: (mine.season.type && mine.season.type.name) || m.round || "This round", slug, ties: list } : null;
}

/* ── How each side got here: its earlier matches in this competition, and for
   an opponent that came through a group, where it finished. ── */
async function road(m, teamId, usResults) {
  const since = new Date(m.date).getTime() - 330 * 864e5;
  const mine = r => r.lg === m.lg && new Date(r.date).getTime() > since && r.date < m.date;
  const slim = r => ({ date: r.date, opp: r.opp.name, ha: r.ha, f: r.us, a: r.them, pen: r.pen, round: r.round });
  const out = { us: usResults.filter(mine).map(slim).reverse(), opp: [], oppTable: null };
  try {
    const sc = await get(`${API}/${m.lg}/teams/${m.opp.id}/schedule`);
    out.opp = (sc.events || []).map(e => slimMatch(e, m.opp.id)).filter(Boolean)
      .filter(r => r.state === "post" && mine(r)).sort((a, b) => a.date.localeCompare(b.date)).map(slim);
  } catch (e) { console.warn("  ! opponent road: " + e.message); }
  try {
    const st = await get(`https://site.api.espn.com/apis/v2/sports/soccer/${m.lg}/standings`);
    const g = (st.children || []).find(c => ((c.standings || {}).entries || []).some(e => e.team.id === m.opp.id));
    if (g) {
      const v = (e, n) => { const x = e.stats.find(q => q.name === n); return x ? x.displayValue : ""; };
      const rows = g.standings.entries.map(e => ({ name: e.team.displayName, me: e.team.id === m.opp.id, p: v(e, "gamesPlayed"), w: v(e, "wins"), d: v(e, "ties"), l: v(e, "losses"), gd: v(e, "pointDifferential"), pts: v(e, "points"), rank: Number(v(e, "rank")) || 0 }));
      if (rows.every(r => r.rank)) rows.sort((a, b) => a.rank - b.rank); else rows.sort((a, b) => Number(b.pts) - Number(a.pts) || parseInt(b.gd) - parseInt(a.gd));
      out.oppTable = { title: g.name, rows };
    }
  } catch (e) { /* no table for this competition */ }
  return out;
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
  let players = await squadPool(T.id, [...new Set([next && next.lg, ...T.squads].filter(Boolean))], next && next.lg);
  if (players.length < 11) throw new Error("squad feed returned only " + players.length + " players");

  /* Wikipedia decides who is in the pool (called up / recent call-ups) and
     supplies caps; ESPN players are matched by name for their club form. If
     the article can't be read, the ESPN list stands as before. */
  let squadNote = "", capsAsOf = "";
  try {
    const w = await wikiSquad(T.wiki);
    if (w.players.filter(p => p.called).length < 11) throw new Error("only " + w.players.length + " players parsed");
    const byName = new Map(players.map(p => [nameKey(p.name), p]));
    const byLast = new Map(); for (const p of players) { const k = nameKey(p.name).split(" ").pop(); byLast.set(k, byLast.has(k) ? null : p); }
    let matched = 0;
    players = w.players.map(wp => {
      const e = byName.get(nameKey(wp.name)) || byLast.get(nameKey(wp.name).split(" ").pop()) || null;
      if (e) matched++;
      return { id: e ? e.id : "w-" + nameKey(wp.name).replace(/ /g, "-"), name: wp.name, pos: wp.pos, age: wp.age || (e && e.age) || null,
        caps: wp.caps, goals: wp.goals, called: wp.called, cur: wp.called, flag: wp.flag, latest: wp.latest,
        club: e && e.club ? e.club : (wp.wclub ? { id: null, name: wp.wclub, abbr: "", logo: null } : null), rec: e ? e.rec : [], inj: wp.flag === "INJ" };
    });
    const order = { G: 0, D: 1, M: 2, F: 3 };
    players.sort((a, b) => (b.called - a.called) || order[a.pos] - order[b.pos] || (b.caps || 0) - (a.caps || 0));
    squadNote = w.note; capsAsOf = w.asOf;
    console.log(`  wikipedia: ${players.filter(p => p.called).length} called up + ${players.filter(p => !p.called).length} recent; ${matched} matched to club form; caps as of ${capsAsOf || "?"}`);
  } catch (e) { console.warn("  ! wikipedia squad: " + e.message + " — using the feed's squad list"); }

  /* Stadium details for every fixture, and where the competition stands. */
  let prev = null;
  try { prev = JSON.parse(await readFile(join(ROOT, "data", "usa", key + ".json"), "utf8")); } catch { /* first run */ }
  for (const m of fixtures) {
    m.vinfo = await venueInfo(m.venue, m.city);
    if (!m.vinfo && prev) { const o = prev.fixtures.find(x => x.venue === m.venue && x.vinfo); if (o) m.vinfo = o.vinfo; }   // a failed lookup never erases a good one
  }
  if (next) {
    try {
      const st = await standing(next, T.id);
      for (const m of fixtures) if (st && m.lg === next.lg && m.round === next.round) m.stand = st;
    } catch (e) { console.warn("  ! standings: " + e.message); }
    if (!/friendly/i.test(next.comp)) {
      const rd = await road(next, T.id, results);
      for (const m of fixtures) if (m.lg === next.lg && m.opp.id === next.opp.id) m.road = rd;
    }
  }

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
    fixtures, results, pool: players, squadNote, capsAsOf, opp,
  };
  await mkdir(join(ROOT, "data", "usa"), { recursive: true });
  /* Keep the old timestamp when nothing else changed, so an idle run commits nothing. */
  const file = join(ROOT, "data", "usa", key + ".json");
  try {
    const old = JSON.parse(await readFile(file, "utf8"));
    if (JSON.stringify({ ...old, updated: 0 }) === JSON.stringify({ ...out, updated: 0 })) out.updated = old.updated;
  } catch { /* first run */ }
  await writeFile(file, JSON.stringify(out) + "\n");
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
