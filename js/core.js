/* Cap Day core logic: everything here is pure (no DOM, no network, no clock),
   so it can be tested in Node as well as loaded by the page.

   Loaded by index.html as a plain script (the names become globals) and by the
   tests through require(). Keep it free of browser-only APIs. */
"use strict";

/* The app's version. This line is the only place the number lives: the footer,
   the anonymous error reports and the release check all read it from here.
   "-pre" means "on the way to that version, not released yet". See CHANGELOG.md. */
const VERSION = "0.1.0-pre";

/* W / D / L from one side's point of view; a level score with a shootout goes to the shootout winner. */
const outcome = (us, them, pen) => us > them ? "W" : us < them ? "L" : pen ? (pen[0] > pen[1] ? "W" : "L") : "D";

/* Lower-case letters only: the key used to match team names across feeds. */
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

/* FIFA's win-expectancy formula on rating points (a draw counts half). */
function winExpectancy(a, b) {
  return a == null || b == null ? null : 1 / (1 + Math.pow(10, -(a - b) / 600));
}

/* ── What a match is for ──
   Every fixture gets a kind (the coloured tag) and a plain one-liner,
   matched on the competition's name. */
const COMPS = [
  [/friendly/i, "friendly", "Friendly", "", "An exhibition match. Nothing rides on the result."],
  [/nations league/i, "competitive", "Competitive", "Concacaf Nations League", "A competition between the national teams of North America, Central America and the Caribbean."],
  [/gold cup/i, "tournament", "Tournament", "Concacaf Gold Cup", "The men's championship of North America, Central America and the Caribbean."],
  [/w championship|women.?s championship/i, "qualifier", "Qualifier", "Concacaf W Championship", "The women's championship of North America, Central America and the Caribbean. It doubles as World Cup qualifying."],
  [/shebelieves/i, "tournament", "Tournament", "SheBelieves Cup", "An invitational tournament the United States hosts each year."],
  [/qualif/i, "qualifier", "Qualifier", "", "A qualifying match: results decide who reaches the tournament."],
  [/women.?s world cup/i, "tournament", "World Cup", "Women's World Cup", "The world championship, held every four years."],
  [/world cup/i, "tournament", "World Cup", "World Cup", "The world championship, held every four years."],
  [/olympic/i, "tournament", "Tournament", "Olympic Games", "The Olympic football tournament."],
  [/copa am/i, "tournament", "Tournament", "Copa América", "South America's championship, with invited guests."],
];
function compInfo(m) {
  const c = COMPS.find(x => x[0].test(m.comp || ""));
  return c ? { kind: c[1], label: c[2], name: c[3] || m.comp, what: c[4] } : { kind: "competitive", label: "Competitive", name: m.comp || "", what: "" };
}
/* "This match" in one plain sentence, from the round and leg. */
function matchLine(m, first) {
  const ci = compInfo(m), round = (m.round || "").replace(/s$/, "");
  if (ci.kind === "friendly") return "A friendly against " + m.opp.name + ".";
  if (/1st/i.test(m.leg)) return `${round}, the first of two matches against ${m.opp.name}. The scores from both are added together to decide who goes through.`;
  if (/2nd/i.test(m.leg)) return `${round}, the second of two matches against ${m.opp.name}. ` + (first ? `The USA ${first.us > first.them ? "leads" : first.us < first.them ? "trails" : "is level"} ${Math.max(first.us, first.them)}–${Math.min(first.us, first.them)} from the first; the combined score decides who goes through.` : "The combined score decides who goes through.");
  if (/final|quarter|semi|round of|play/i.test(round)) return `${round}: a single knockout match against ${m.opp.name}.`;
  return round ? `${round} match against ${m.opp.name}.` : "";
}

/* How a locked-in score prediction is doing: graded at full time, tracked while live. */
function callVerdict(c, us, them, st) {
  let verdict = "";
  if (st === "post") verdict = c.us === us && c.them === them ? "🎯 Spot on — exact score!" : outcome(c.us, c.them) === outcome(us, them) ? "✅ Right result, wrong score." : "❌ Not this time.";
  else if (st === "in") verdict = c.us === us && c.them === them ? "🎯 On the money right now." : c.us >= us && c.them >= them ? "🤞 Still alive." : "💥 Busted — that score can't happen now.";
  return verdict;
}

/* ── Score challenge ──
   A challenge is a link that carries the sender's call (and any calls the sender
   was sent) for one match: "<event id>~<name>:<USA goals>-<opponent goals>~…".
   Everything that arrives in a link is untrusted, so it is parsed strictly and
   names are reduced to plain characters before they are stored or shown. */
const MAX_RIVALS = 8, MAX_NAME = 16, MAX_GOALS = 15;

/* A first name as typed, made safe to carry in a link: letters, digits, spaces and . ' - only. */
function cleanName(s) {
  const t = String(s == null ? "" : s).normalize("NFC").replace(/[^\p{L}\p{N} .'’-]/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(t).slice(0, MAX_NAME).join("").trim();
}

function packChallenge(id, calls) {
  return String(id) + (calls || []).slice(0, MAX_RIVALS + 1).map(c => "~" + encodeURIComponent(cleanName(c.n)) + ":" + c.us + "-" + c.them).join("");
}

/* → { id, calls: [{ n, us, them }] }, or null if nothing in it can be trusted. */
function parseChallenge(str) {
  if (typeof str !== "string" || str.length > 900) return null;
  const parts = str.split("~");
  if (!/^\d{1,12}$/.test(parts[0])) return null;
  const calls = [], seen = new Set();
  for (const raw of parts.slice(1)) {
    let text; try { text = decodeURIComponent(raw); } catch (e) { continue; }
    const m = /^(.+):(\d{1,2})-(\d{1,2})$/.exec(text); if (!m) continue;
    const n = cleanName(m[1]), us = Number(m[2]), them = Number(m[3]);
    if (!n || us > MAX_GOALS || them > MAX_GOALS || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase()); calls.push({ n, us, them });
    if (calls.length > MAX_RIVALS) break;
  }
  return calls.length ? { id: parts[0], calls } : null;
}

/* The calls held for a match after a link arrives: the new ones first, then the
   ones already there, one per name, never the viewer's own, at most MAX_RIVALS. */
function mergeRivals(have, got, me) {
  const mine = cleanName(me).toLowerCase(), out = [], seen = new Set();
  for (const c of [...(got || []), ...(have || [])]) {
    const k = String(c.n).toLowerCase();
    if (k === mine || seen.has(k)) continue;
    seen.add(k); out.push({ n: c.n, us: c.us, them: c.them });
  }
  return out.slice(0, MAX_RIVALS);
}

/* How far a call is from a score, most important first: wrong result, goal
   difference off by, goals off by. Lower is better. */
const callDistance = (c, us, them) => [outcome(c.us, c.them) === outcome(us, them) ? 0 : 1, Math.abs((c.us - c.them) - (us - them)), Math.abs(c.us - us) + Math.abs(c.them - them)];

/* Calls ranked against a score. Equal calls share a place. */
function rankCalls(calls, us, them) {
  const cmp = (a, b) => a.d[0] - b.d[0] || a.d[1] - b.d[1] || a.d[2] - b.d[2];
  const list = (calls || []).map((c, i) => ({ ...c, i, d: callDistance(c, us, them) })).sort((a, b) => cmp(a, b) || a.i - b.i);
  list.forEach((c, i) => { c.place = i && !cmp(c, list[i - 1]) ? list[i - 1].place : i + 1; c.exact = c.d[2] === 0; c.right = c.d[0] === 0; delete c.i; });
  return list;
}

/* Club form in one number: goals and assists count most, then starts, then substitute appearances. */
const formScore = p => p.rec.reduce((n, r) => n + (r.g || 0) * 3 + (r.a || 0) * 2 + (r.st === "S" ? 1 : r.st === "I" ? .5 : 0), 0);

/* ── Live overlay from the match summary ── */
function parseSummary(G, teamId) {
  const c = G.header && G.header.competitions && G.header.competitions[0];
  if (!c) return null;
  const us = c.competitors.find(x => x.id === teamId), them = c.competitors.find(x => x.id !== teamId);
  const st = c.status || {}, ty = st.type || {};
  const num = v => v == null || v === "" ? null : Number(v);
  /* While play is stopped the feed's running clock freezes on the last minute
     played ("45'+3'" all through half time) and only its status says what is
     happening ("HT"). A status with no minute in it is a break: show that. */
  const brk = ty.state === "in" && ty.shortDetail && !/\d/.test(ty.shortDetail) ? ty.shortDetail : "";
  const out = {
    state: ty.state || "pre",
    clock: ty.state === "in" ? (brk ? (brk === "HT" ? "Half time" : brk) : st.displayClock || ty.shortDetail || "") : (ty.shortDetail || ""),
    us: us ? num(us.score) : null, them: them ? num(them.score) : null,
    pen: us && them && us.shootoutScore != null && them.shootoutScore != null ? [num(us.shootoutScore), num(them.shootoutScore)] : null,
    events: [], xi: [], series: "", meetings: [], last5: [], stats: null,
    tv: [...new Set((G.broadcasts || []).map(b => b.media && b.media.shortName).filter(Boolean))],
  };
  for (const k of G.keyEvents || []) {
    const t = (k.type && k.type.type) || "";
    const isGoal = !!k.scoringPlay, isCard = /card/.test(t);
    if ((!isGoal && !isCard) || k.shootout) continue;
    const ps = (k.participants || []).map(p => p.athlete && p.athlete.displayName).filter(Boolean);
    out.events.push({
      min: (k.clock && k.clock.displayValue) || "", us: !!(k.team && k.team.id === teamId),
      icon: isGoal ? "⚽" : /red/.test(t) ? "🟥" : "🟨", who: ps[0] || (k.shortText || "").replace(/ (Goal|Yellow Card|Red Card).*/, ""),
      note: isGoal ? (/own/.test(t) ? "own goal" : /penalty/.test(t) ? "pen" : ps[1] ? "assist " + ps[1] : "") : "",
    });
  }
  for (const r of G.rosters || []) {
    const ros = r.roster || []; if (!ros.length) continue;
    out.xi.push({
      us: r.team.id === teamId, name: r.team.displayName, formation: r.formation || "",
      start: ros.filter(x => x.starter).map(x => ({ n: x.jersey || "", name: x.athlete.displayName, pos: (x.position && x.position.abbreviation) || "" })),
      bench: ros.filter(x => !x.starter).map(x => x.athlete.displayName),
    });
  }
  const bt = (G.boxscore && G.boxscore.teams) || [];
  const statsOf = t => { const o = {}; for (const q of (t && t.statistics) || []) o[q.name] = q.displayValue; return o; };
  const bu = bt.find(t => t.team && t.team.id === teamId), bo = bt.find(t => t.team && t.team.id !== teamId);
  if (bu && bo) out.stats = { us: statsOf(bu), them: statsOf(bo) };
  const ss = (G.seasonseries || [])[0];
  if (ss) {
    out.series = ss.summary || "";
    out.meetings = (ss.events || []).filter(e => e.status === "post").slice(0, 5).map(e => {
      const a = e.competitors.find(x => x.team.id === teamId), b = e.competitors.find(x => x.team.id !== teamId);
      return a && b ? { date: e.date, comp: e.competitionName || "", us: num(a.score), them: num(b.score) } : null;
    }).filter(Boolean);
  }
  for (const t of G.lastFiveGames || []) {
    out.last5.push({
      us: t.team.id === teamId, name: t.team.displayName,
      /* Newest first, and the score from this team's side (the feed's own
         "score" string is winner-first, which reads wrong next to an L). */
      games: (t.events || []).slice().sort((a, b) => String(b.gameDate).localeCompare(String(a.gameDate))).slice(0, 5).map(e => {
        const home = e.homeTeamId === t.team.id;
        return {
          res: e.gameResult || "", score: (home ? e.homeTeamScore : e.awayTeamScore) + "–" + (home ? e.awayTeamScore : e.homeTeamScore),
          opp: (e.opponent && (e.opponent.abbreviation || e.opponent.displayName)) || "", at: e.atVs === "@" ? "at" : "v", date: e.gameDate,
        };
      }),
    });
  }
  return out;
}


/* Whether the match numbers are worth showing yet. In the first minute the feed
   sends all zeros, or one side's first pass as "0% possession against 100%":
   wait until both sides have had the ball, or until something has been counted. */
const SHOWN_STATS = ["totalShots", "shotsOnTarget", "wonCorners", "foulsCommitted"];
function statsReady(s) {
  if (!s || !s.us || !s.them) return false;
  const n = (o, k) => parseFloat(o[k]) || 0;
  return (n(s.us, "possessionPct") > 0 && n(s.them, "possessionPct") > 0) || SHOWN_STATS.some(k => n(s.us, k) > 0 || n(s.them, k) > 0);
}

/* ── Did you know? ──
   The order the facts (js/facts.js) are shown in. Facts about the next opponent
   come first, then, before a two-leg tie, the one that explains legs. The rest
   are mixed afresh each day and take turns between the ones for newcomers and
   the deep cuts, so neither kind of reader waits long. A fact past its "until"
   date is left out until someone has checked it. */
function factOrder(facts, o) {
  o = o || {};
  const opp = norm(o.opp || ""), today = o.today || "";
  const mix = (facts || []).filter(f => !f.until || !today || today <= f.until);
  let s = (((o.day || 0) + 1) * 2654435761) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = mix.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mix[i], mix[j]] = [mix[j], mix[i]]; }
  const about = f => !!opp && (f.opp || []).some(x => norm(x) === opp);
  const first = mix.filter(about), second = mix.filter(f => o.leg && f.leg && !about(f));
  const rest = mix.filter(f => !first.includes(f) && !second.includes(f));
  const a = rest.filter(f => f.lv === "new"), b = rest.filter(f => f.lv !== "new"), out = [...first, ...second];
  while (a.length || b.length) { if (a.length) out.push(a.shift()); if (b.length) out.push(b.shift()); }
  return out;
}

if (typeof module === "object" && module.exports) {
  module.exports = { VERSION, outcome, norm, winExpectancy, COMPS, compInfo, matchLine, callVerdict, formScore, parseSummary, cleanName, packChallenge, parseChallenge, mergeRivals, callDistance, rankCalls, MAX_RIVALS, MAX_NAME, factOrder, statsReady };
}
