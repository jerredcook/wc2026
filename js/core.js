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

/* Club form in one number: goals and assists count most, then starts, then substitute appearances. */
const formScore = p => p.rec.reduce((n, r) => n + (r.g || 0) * 3 + (r.a || 0) * 2 + (r.st === "S" ? 1 : r.st === "I" ? .5 : 0), 0);

/* ── Live overlay from the match summary ── */
function parseSummary(G, teamId) {
  const c = G.header && G.header.competitions && G.header.competitions[0];
  if (!c) return null;
  const us = c.competitors.find(x => x.id === teamId), them = c.competitors.find(x => x.id !== teamId);
  const st = c.status || {}, ty = st.type || {};
  const num = v => v == null || v === "" ? null : Number(v);
  const out = {
    state: ty.state || "pre",
    clock: ty.state === "in" ? (st.displayClock || ty.shortDetail || "") : (ty.shortDetail || ""),
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


if (typeof module === "object" && module.exports) {
  module.exports = { VERSION, outcome, norm, winExpectancy, COMPS, compInfo, matchLine, callVerdict, formScore, parseSummary };
}
