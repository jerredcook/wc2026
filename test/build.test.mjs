/* The data pipeline's pure helpers: Wikipedia squad rows, calendar feeds, and
   the validation gate that stops thin data replacing good data. */
import test from "node:test";
import assert from "node:assert/strict";
import { wikiPlayer, unwiki, nameKey, ics, calEvents, validate, stamp, CHECK_EVERY, clubKey, indexClubs, findAthlete, keepPrevClubs } from "../scripts/build-usa.mjs";

test("wikiPlayer: a called-up player row", () => {
  const p = wikiPlayer("{{nat fs g player|no=|pos=DF|name={{sortname|Antonee|Robinson}}|age={{birth date and age|1997|8|8}}|caps=62|goals=5|club=[[Fulham F.C.|Fulham]]|clubnat=ENG}}", true);
  assert.deepEqual({ name: p.name, pos: p.pos, caps: p.caps, goals: p.goals, wclub: p.wclub, called: p.called, flag: p.flag },
    { name: "Antonee Robinson", pos: "D", caps: 62, goals: 5, wclub: "Fulham", called: true, flag: "" });
  assert.ok(p.age >= 29);
});

test("wikiPlayer: a retired player and an opponent code that looks like a flag", () => {
  const ret = wikiPlayer("{{nat fs r player|no=|pos=DF|name={{sortname|Tim|Ream}}|age={{birth date and age|1987|10|5}}|caps=86|goals=1|club=[[Charlotte FC]]|clubnat=USA|latest=[[2026 FIFA World Cup]]<sup>{{small|RET}}</sup>}}", false);
  assert.equal(ret.flag, "RET");
  assert.equal(ret.latest, "2026 FIFA World Cup");
  const plain = wikiPlayer("{{nat fs r player|no=|pos=GK|name={{sortname|Chris|Brady|dab=soccer}}|age={{birth date and age|2004|3|3}}|caps=2|goals=0|club=[[Chicago Fire FC|Chicago Fire]]|clubnat=USA|latest=v. {{fb|CAN}}; October 6, 2026}}", false);
  assert.equal(plain.name, "Chris Brady");
  assert.equal(plain.flag, "", "an opponent's country code is not a status marker");
  assert.equal(plain.latest, "v CAN, October 6, 2026");
});

test("unwiki and nameKey", () => {
  assert.equal(unwiki("called up for [[2026-27 CONCACAF Nations League A#Quarter-finals|the quarter-finals]] against [[Haiti national football team|Haiti]].<ref>x</ref>"), "called up for the quarter-finals against Haiti.");
  assert.equal(nameKey("Sergiño Dest"), "sergino dest");
});

test("calendar feed: valid structure, folded lines, escaped text, stable when nothing changes", () => {
  const fx = [{ id: "1", date: "2026-11-14T21:30Z", ha: "A", opp: { name: "Haiti" }, state: "pre", us: null, them: null, comp: "Concacaf Nations League", round: "Quarterfinals", leg: "1st Leg", venue: "Nu Stadium", city: "Miami, Florida", tv: ["TBS", "truTV", "Universo", "HBO Max", "Peacock"] }];
  const rs = [{ id: "2", date: "2026-10-07T00:00Z", ha: "H", opp: { name: "Canada" }, state: "post", us: 1, them: 0, comp: "International Friendly", round: "", leg: "", venue: "Allianz Field", city: "Saint Paul, Minnesota", tv: [] }];
  const text = ics("Cap Day — USA Men", calEvents("Men", fx, rs));
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.endsWith("END:VCALENDAR\r\n"));
  assert.equal(text.split("BEGIN:VEVENT").length - 1, 2);
  assert.equal(text.split("END:VEVENT").length - 1, 2);
  for (const line of text.split("\r\n")) assert.ok(line.length <= 75, "line too long: " + line);
  const flat = text.replace(/\r\n /g, "");
  assert.ok(flat.includes("SUMMARY:Haiti vs USA Men"));
  assert.ok(flat.includes("SUMMARY:FT: USA Men vs Canada 1–0"));
  assert.ok(flat.includes("LOCATION:Nu Stadium\\, Miami\\, Florida"), "commas are escaped");
  assert.ok(flat.includes("Watch: TBS / truTV / Universo / HBO Max / Peacock"), "folding loses no characters");
  assert.equal(text, ics("Cap Day — USA Men", calEvents("Men", fx, rs)), "same input, same file");
});

const player = (name, rec = [{ st: "S" }]) => ({ name, pos: "M", rec });
const match = (id, extra = {}) => ({ id, date: "2026-11-14T21:30Z", ha: "H", opp: { name: "Haiti" }, us: 1, them: 0, ...extra });
const good = () => ({ fixtures: [match("f1", { us: null, them: null })], results: [match("r1"), match("r2")], pool: Array.from({ length: 23 }, (_, i) => player("P" + i)) });

test("validate: good data passes", () => {
  assert.deepEqual(validate(good(), null), []);
  assert.deepEqual(validate(good(), good()), []);
});

test("validate: malformed data is refused", () => {
  const noOpp = good(); noOpp.fixtures[0].opp = null;
  assert.ok(validate(noOpp, null).length);
  const noScore = good(); noScore.results[0].us = null;
  assert.ok(validate(noScore, null).length);
  const tiny = good(); tiny.pool = tiny.pool.slice(0, 5);
  assert.ok(validate(tiny, null).length);
  const unsorted = good(); unsorted.fixtures = [match("a", { date: "2026-12-01T00:00Z" }), match("b", { date: "2026-11-01T00:00Z" })];
  assert.ok(validate(unsorted, null).some(e => /date order/.test(e)));
});

test("validate: data that shrank sharply against the previous file is refused", () => {
  const prev = good(); prev.pool = Array.from({ length: 50 }, (_, i) => player("P" + i));
  assert.ok(validate(good(), prev).some(e => /pool shrank/.test(e)));
  const noForm = good(); noForm.pool.forEach(p => { p.rec = []; });
  assert.ok(validate(noForm, good()).some(e => /club form fell/.test(e)));
});

test("stamp: 'updated' moves only when the content changes; 'checked' is refreshed every six hours", () => {
  const T0 = Date.parse("2026-11-12T00:00:00Z"), iso = t => new Date(t).toISOString(), hour = 36e5;
  const file = extra => ({ updated: "", checked: "", fixtures: [{ id: "1" }], ...extra });

  const first = stamp(file(), null, T0);
  assert.equal(first.updated, iso(T0)); assert.equal(first.checked, iso(T0));

  /* Same content an hour later: byte-identical, so the job commits nothing. */
  const idle = stamp(file(), first, T0 + hour);
  assert.equal(JSON.stringify(idle), JSON.stringify(first));

  /* Same content after six hours: only 'checked' moves. */
  const later = stamp(file(), first, T0 + CHECK_EVERY + 1);
  assert.equal(later.updated, iso(T0)); assert.equal(later.checked, iso(T0 + CHECK_EVERY + 1));

  /* Changed content: both move. */
  const changed = stamp(file({ fixtures: [{ id: "2" }] }), first, T0 + hour);
  assert.equal(changed.updated, iso(T0 + hour)); assert.equal(changed.checked, iso(T0 + hour));

  /* A file from before 'checked' existed: content unchanged, so 'updated' is kept and 'checked' is added. */
  const legacy = { updated: iso(T0 - 9 * hour), fixtures: [{ id: "1" }] };
  const upgraded = stamp(file(), legacy, T0);
  assert.equal(upgraded.updated, legacy.updated); assert.equal(upgraded.checked, iso(T0));
});

/* ── Club lookup for players the squad feed does not list ── */
test("clubKey: the same club written two ways gives the same key", () => {
  assert.equal(clubKey("St. Louis City SC"), clubKey("St. Louis CITY SC"));
  assert.equal(clubKey("Gotham FC"), clubKey("NJ/NY Gotham FC"));
  assert.equal(clubKey("Atlético Madrid"), clubKey("Atletico Madrid"));
  assert.equal(clubKey("AC Milan"), "milan");
  assert.equal(clubKey("SV Elversberg"), "elversberg");
  assert.notEqual(clubKey("Manchester City"), clubKey("Manchester United"));
  assert.notEqual(clubKey("Inter Milan"), clubKey("AC Milan"));
  assert.equal(clubKey("FC"), "fc", "a name made only of filler words is kept as it is");
  assert.equal(clubKey(null), "");
});

test("indexClubs: finds a club by any of its names, and refuses a name two clubs share", () => {
  const idx = indexClubs([
    { lg: "ita.1", teams: [{ id: 103, displayName: "AC Milan", shortDisplayName: "Milan", name: "AC Milan", location: "AC Milan", abbreviation: "MIL", logos: [{ href: "https://x/milan.png" }] }] },
    { lg: "eng.1", teams: [{ id: 1, displayName: "Newcastle United", shortDisplayName: "Newcastle", abbreviation: "NEW" }, { id: 2, displayName: "Manchester United", shortDisplayName: "Man United" }] },
    { lg: "eng.2", teams: [{ id: 3, displayName: "Sheffield United", shortDisplayName: "Sheffield" }, { id: 4, displayName: "Sheffield Wednesday", shortDisplayName: "Sheffield" }] },
    { lg: "bad", teams: null },
  ]);
  assert.deepEqual(idx.get(clubKey("AC Milan")), { id: "103", lg: "ita.1", name: "AC Milan", abbr: "MIL", logo: "https://x/milan.png" });
  assert.equal(idx.get(clubKey("Milan")).id, "103");
  assert.equal(idx.get(clubKey("Newcastle")).id, "1");
  assert.equal(idx.get(clubKey("Sheffield United")).id, "3");
  assert.equal(idx.get(clubKey("Sheffield")), undefined, "two clubs answer to 'Sheffield': neither is guessed");
  assert.equal(idx.get(clubKey("Real Madrid")), undefined);
});

test("findAthlete: the full name, or a surname only one player has, never a guess", () => {
  const roster = [
    { id: "1", displayName: "Yunus Musah" }, { id: "2", displayName: "Christian Pulisic" },
    { id: "3", displayName: "Lo'eau LaBonta" }, { id: "4", displayName: "G. Campbell", fullName: "George Campbell" },
    { id: "5", displayName: "Tyler Adams" }, { id: "6", displayName: "Che Adams" }, { displayName: "No Id" }, null,
  ];
  assert.equal(findAthlete(roster, "Yunus Musah").id, "1");
  assert.equal(findAthlete(roster, "Lo’eau LaBonta").id, "3", "punctuation differences do not matter");
  assert.equal(findAthlete(roster, "George Campbell").id, "4", "the feed's full name counts");
  assert.equal(findAthlete(roster, "Chris Pulisic").id, "2", "a unique surname with the same initial");
  assert.equal(findAthlete(roster, "Mark Pulisic"), null, "same surname, different initial: someone else");
  assert.equal(findAthlete(roster, "Taylor Adams"), null, "two players share the surname: not guessed");
  assert.equal(findAthlete(roster, "Weston McKennie"), null);
  assert.equal(findAthlete(null, "Anyone"), null);
});

test("keepPrevClubs: an unanswered lookup keeps last run's club form; an answered one is respected", () => {
  const milan = { id: "103", name: "AC Milan" }, rec = [{ d: "2026-11-08T17:00Z", st: "S" }];
  const prev = { pool: [{ id: "307527", name: "Yunus Musah", club: milan, rec }, { id: "9", name: "Left Club", club: milan, rec }, { id: "w-new-guy", name: "New Guy", club: { id: null, name: "Lyon" }, rec: [] }] };
  const players = [
    { id: "w-yunus-musah", name: "Yunus Musah", club: { id: null, name: "AC Milan" }, rec: [], unanswered: true },
    { id: "w-left-club", name: "Left Club", club: { id: "7", name: "Lyon" }, rec: [] },                     // the feed answered: not in the roster
    { id: "w-new-guy", name: "New Guy", club: { id: null, name: "Lyon" }, rec: [], unanswered: true },       // nothing good to fall back on
    { id: "5", name: "Fine Already", club: milan, rec },
  ];
  assert.equal(keepPrevClubs(players, prev), 1);
  assert.deepEqual(players[0], { id: "307527", name: "Yunus Musah", club: milan, rec });
  assert.equal(players[1].club.name, "Lyon"); assert.deepEqual(players[1].rec, []);
  assert.deepEqual(players[2].rec, []);
  assert.ok(players.every(p => !("unanswered" in p)), "the working flag never reaches the data file");
  assert.equal(keepPrevClubs([{ name: "X", club: null, rec: [], unanswered: true }], null), 0, "first run: nothing to keep");
});
