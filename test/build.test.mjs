/* The data pipeline's pure helpers: Wikipedia squad rows, calendar feeds, and
   the validation gate that stops thin data replacing good data. */
import test from "node:test";
import assert from "node:assert/strict";
import { wikiPlayer, unwiki, nameKey, ics, calEvents, validate, stamp, CHECK_EVERY } from "../scripts/build-usa.mjs";

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
