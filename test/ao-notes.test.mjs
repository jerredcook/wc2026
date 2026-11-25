// What a chapter's leaders write for the app (scripts/build-ao-notes.mjs, data/ao/notes.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCsv, clean, readDate, readNotes, readSongs, sheetList, readTab, build, serialize, LIMITS } from "../scripts/build-ao-notes.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const chr = n => String.fromCharCode(n);
const TODAY = "2026-11-15";

test("notes: a sheet's text is read cell by cell, quotes, commas and line breaks included", () => {
  assert.deepEqual(parseCsv('a,"b, c"\r\n"line1\nline2","say ""hi"""\n,,\nlast'), [["a", "b, c"], ["line1\nline2", 'say "hi"'], ["", "", ""], ["last"]]);
  assert.deepEqual(parseCsv(chr(0xFEFF) + "x,y\n"), [["x", "y"]], "a byte-order mark is not part of the first cell");
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv('"never closed, still one cell'), [["never closed, still one cell"]]);
});

test("notes: what leaders type becomes plain text of a bounded length", () => {
  assert.equal(clean("  Doors   at 6,\n upstairs\t ", 240), "Doors at 6, upstairs");
  assert.equal(clean("a" + chr(0) + "b" + chr(0x202E) + "c" + chr(0x200B) + "d" + chr(7), 50), "a b c d", "control and direction-flipping characters are removed");
  assert.equal(clean("x".repeat(300), 240).length, 240);
  assert.ok(clean("x".repeat(300), 240).endsWith("…"));
  assert.equal(clean("<b onclick=x>hi</b>", 240), "<b onclick=x>hi</b>", "markup is kept as the characters typed; the page escapes it when drawing");
  assert.equal(clean("one \r\n  two\n\n\n\nthree  ", 100, true), "one\ntwo\n\nthree", "song words keep their lines");
  assert.equal(clean(null, 10), ""); assert.equal(clean(42, 10), "42");
});

test("notes: a match date is read the ways people type it, and anything else is not a date", () => {
  for (const v of ["11/17/2026", "11/17/26", "11/17", "2026-11-17", "Nov 17", "November 17, 2026", "Tue, Nov 17", " 11-17-2026 ", "nov. 17th"]) assert.equal(readDate(v, TODAY), "2026-11-17", v);
  assert.equal(readDate("", TODAY), ""); assert.equal(readDate("   ", TODAY), "");
  for (const v of ["tuesday", "13/40/2026", "2/30", "soon", "11/17/1999", "17 Nov extra words here", "Nob 17"]) assert.equal(readDate(v, TODAY), null, v);
  assert.equal(readDate("1/5", TODAY), "2027-01-05", "a date with no year is its next occurrence");
  assert.equal(readDate("11/10", TODAY), "2026-11-10", "a few days ago still means this year");
  assert.equal(readDate("11/01", TODAY), "2027-11-01");
  assert.equal(readDate("2/29", "2027-06-01"), null, "February 29 in a year without one is not a date");
});

test("notes: the Notes tab gives dated and undated notes, without its heading, past matches or unreadable dates", () => {
  const rows = [["Match date, like 11/17/2026 (leave blank to show on every match)", "Note for the watch party card (up to 240 characters)"],
    ["11/17/2026", "Doors at 6, we are upstairs."], ["", "  Members get $1 off drafts. "], ["11/14/2026", "Last Saturday's note"], ["11/14", "Yesterday's note"],
    ["Tuesday", "Wear white"], ["12/13", ""], ["", ""], ["Dec 13", "y".repeat(400)]];
  const { notes, skipped } = readNotes(rows, TODAY);
  assert.deepEqual(notes.slice(0, 4), [{ date: "2026-11-17", text: "Doors at 6, we are upstairs." }, { text: "Members get $1 off drafts." },
    { date: "2026-11-14", text: "Last Saturday's note" }, { date: "2026-11-14", text: "Yesterday's note" }], "in the sheet's order; yesterday's notes stay one more day");
  assert.equal(notes.length, 5);
  assert.deepEqual(notes[4], { date: "2026-12-13", text: "y".repeat(LIMITS.note - 1) + "…" });
  assert.deepEqual(skipped, ['"Tuesday" is not a date']);
  assert.deepEqual(readNotes([["11/13/2026", "two days gone"]], TODAY).notes, [], "a note for a match more than a day past is dropped");
  assert.deepEqual(readNotes([["", "the heading row was deleted"]], TODAY).notes, [{ text: "the heading row was deleted" }], "with no heading row the first row is a note");
  assert.equal(readNotes(Array.from({ length: 50 }, (_, i) => ["", "note " + i]), TODAY).notes.length, LIMITS.notes);
  assert.deepEqual(readNotes([], TODAY), { notes: [], skipped: [] });
});

test("notes: a \"no\" in the third column marks that match as having no official watch party", () => {
  const rows = [["Match date", "Note for the watch party card", "Official watch party? Type no if there is not one"],
    ["11/27/26", "There is no official watch party due to the holiday weekend.", "no"], ["12/13", "", " No "], ["11/17", "Upstairs", ""], ["11/18", "Bring a scarf", "yes"],
    ["11/19", "", "yes"], ["", "Members get $1 off drafts.", "no"], ["", "", "no"], ["someday", "", "no"], ["11/20", "x", "no thanks"]];
  const { notes, skipped } = readNotes(rows, TODAY);
  assert.deepEqual(notes, [{ date: "2026-11-27", text: "There is no official watch party due to the holiday weekend.", official: false },
    { date: "2026-12-13", official: false }, { date: "2026-11-17", text: "Upstairs" }, { date: "2026-11-18", text: "Bring a scarf" },
    { text: "Members get $1 off drafts." }, { date: "2026-11-20", text: "x" }], "only a plain no counts; a no with a date needs no note; anything else leaves the row as it was");
  assert.deepEqual(skipped, ['a "no" for the official watch party needs a match date', 'a "no" for the official watch party needs a match date', '"someday" is not a date'],
    "a no without a date would call off every match, so it is left out and said so");
  assert.deepEqual(readNotes([["11/13/2026", "", "no"]], TODAY).notes, [], "a no for a match more than a day past is dropped like any note");
});

test("notes: the Songbook tab keeps its order and its line breaks", () => {
  const rows = [["Chant or song", "Words (press Ctrl+Enter, or Cmd+Enter on a Mac, for a new line)"], ["I Believe", "I believe\r\nI believe that\nI believe that we will win!"], ["", ""], ["", "words with no name"], ["A name with no words", ""]];
  assert.deepEqual(readSongs(rows), [{ title: "I Believe", words: "I believe\nI believe that\nI believe that we will win!" }, { title: "Untitled", words: "words with no name" }, { title: "A name with no words", words: "" }]);
  assert.equal(readSongs(Array.from({ length: 100 }, (_, i) => ["s" + i, "w"])).length, LIMITS.songs);
  assert.equal(readSongs([["t".repeat(200), "w".repeat(5000)]])[0].title.length, LIMITS.title);
  assert.equal(readSongs([["t", "w".repeat(5000)]])[0].words.length, LIMITS.words);
});

test("notes: the list of sheets accepts only plain chapter names and sheet ids", () => {
  const id = "1TNdtpIeAXW58_abcDEF-0123456789abcdefghijklm";
  assert.deepEqual(sheetList("middlesex-county=" + id + " , nyc=" + id), [["middlesex-county", id], ["nyc", id]]);
  assert.deepEqual(sheetList(""), []); assert.deepEqual(sheetList(undefined), []);
  assert.deepEqual(sheetList("../evil=" + id + ",nyc=short,x=" + id + "/edit?x,ok-1=" + id), [["ok-1", id]]);
});

/* A stand-in for the network: answers by tab number. */
const net = tabs => async url => {
  const gid = /gid=(\d+)/.exec(url)[1], a = tabs[gid];
  if (a instanceof Error) throw a;
  return { ok: a.status == null || a.status === 200, status: a.status || 200, headers: { get: () => a.type || "text/csv; charset=utf-8" }, text: async () => a.body };
};
const NOW = Date.parse("2026-11-15T22:00:00Z"), ID = "1TNdtpIeAXW58_abcDEF-0123456789abcdefghijklm";

test("notes: reading a chapter's sheet gives its notes and songs; reading it twice gives the same file", async () => {
  const get = net({ 0: { body: 'Match date,Note for the watch party card\n11/17/2026,"Doors at 6, upstairs"\n,Bring a friend\n' }, 1: { body: "Chant or song,Words (press\nUSA,\"U-S-A!\nU-S-A!\"\n" } });
  const a = await build([["middlesex-county", ID]], null, { get, now: NOW, pause: 0 });
  assert.deepEqual(a, { result: { chapters: { "middlesex-county": { notes: [{ date: "2026-11-17", text: "Doors at 6, upstairs" }, { text: "Bring a friend" }], songs: [{ title: "USA", words: "U-S-A!\nU-S-A!" }] } } }, failed: [], skipped: [] });
  const b = await build([["middlesex-county", ID]], a.result, { get, now: NOW, pause: 0 });
  assert.equal(serialize(b.result), serialize(a.result));
  assert.ok(serialize(a.result).endsWith("}\n"));
  const empty = await build([["middlesex-county", ID]], a.result, { get: net({ 0: { body: "Match date,Note for the watch party card\n" }, 1: { body: "" } }), now: NOW, pause: 0 });
  assert.deepEqual(empty.result.chapters["middlesex-county"], { notes: [], songs: [] }, "an emptied sheet is a real answer: the notes come down");
  assert.deepEqual(empty.failed, []);
});

test("notes: a sheet that cannot be read keeps what the file already said, and says it failed", async () => {
  const old = { chapters: { "middlesex-county": { notes: [{ text: "kept" }], songs: [] }, gone: { notes: [{ text: "a chapter no longer in the list" }], songs: [] } } };
  const csv = { body: "Match date,Note for the watch party card\n,new\n" };
  for (const [what, tabs] of [
    ["a sign-in page instead of the sheet", { 0: { type: "text/html; charset=utf-8", body: "<!DOCTYPE html><html>Sign in</html>" }, 1: csv }],
    ["a sign-in page labelled as the sheet", { 0: { body: "  <html>Sign in</html>" }, 1: csv }],
    ["not shared any more", { 0: { status: 403, body: "" }, 1: csv }],
    ["the songs tab missing", { 0: csv, 1: { status: 404, body: "" } }],
  ]) {
    const r = await build([["middlesex-county", ID]], old, { get: net(tabs), now: NOW, pause: 0 });
    assert.deepEqual(r.failed, ["middlesex-county"], what);
    assert.deepEqual(r.result, { chapters: { "middlesex-county": old.chapters["middlesex-county"] } }, what + ": the old entry is kept, and a chapter dropped from the list goes");
  }
  const none = await build([["nyc", ID]], null, { get: net({ 0: { status: 403, body: "" }, 1: csv }), now: NOW, pause: 0 });
  assert.deepEqual(none, { result: { chapters: {} }, failed: ["nyc"], skipped: [] }, "with nothing to keep, the chapter is simply absent");
  assert.equal(await readTab(ID, 0, net({ 0: { type: "text/html", body: "<html>" } }), 0), null);
  let tries = 0;
  assert.equal(await readTab(ID, 0, async () => { tries++; if (tries < 3) throw new Error("network down"); return { ok: true, status: 200, headers: { get: () => "text/csv" }, text: async () => "a,b\n" }; }, 0), "a,b\n", "a dropped connection is tried again");
  assert.equal(tries, 3);
});

test("notes: the request names nothing about the chapter or its people", async () => {
  const seen = [];
  await readTab(ID, 1, async (url, o) => { seen.push([url, o.headers["User-Agent"]]); return { ok: true, status: 200, headers: { get: () => "text/csv" }, text: async () => "a,b\n" }; });
  assert.deepEqual(seen, [["https://docs.google.com/spreadsheets/d/" + ID + "/export?format=csv&gid=1", "Mozilla/5.0 (compatible; sheet-reader/1.0)"]]);
});

test("notes: the committed file is well-formed, and no sheet id is in the repository", () => {
  const text = readFileSync(path.join(root, "data/ao/notes.json"), "utf8"), d = JSON.parse(text);
  assert.equal(text, serialize(d), "the file is exactly what the script writes");
  const slugs = new Set(JSON.parse(readFileSync(path.join(root, "data/ao/chapters.json"), "utf8")).chapters.map(c => c.slug));
  for (const [slug, c] of Object.entries(d.chapters)) {
    assert.ok(slugs.has(slug), slug + " is a chapter");
    assert.ok(Array.isArray(c.notes) && c.notes.length <= LIMITS.notes && Array.isArray(c.songs) && c.songs.length <= LIMITS.songs);
    for (const n of c.notes) {
      assert.ok(n.text === undefined ? n.official === false : typeof n.text === "string" && n.text && n.text.length <= LIMITS.note, "a note has words, unless it only says there is no official watch party");
      assert.ok(n.date == null || /^\d{4}-\d\d-\d\d$/.test(n.date));
      assert.ok(n.official === undefined || (n.official === false && n.date), "\"no official watch party\" is always for one dated match");
      assert.deepEqual(Object.keys(n).filter(k => !["date", "text", "official"].includes(k)), []);
    }
    for (const s of c.songs) assert.ok(typeof s.title === "string" && s.title.length <= LIMITS.title && typeof s.words === "string" && s.words.length <= LIMITS.words);
  }
  const wf = readFileSync(path.join(root, ".github/workflows/ao-notes.yml"), "utf8");
  assert.match(wf, /AO_SHEETS: \$\{\{ secrets\.AO_SHEETS \}\}/, "the workflow takes the sheet from a secret");
  for (const f of ["scripts/build-ao-notes.mjs", ".github/workflows/ao-notes.yml", "js/ao.js", "README.md"]) assert.ok(!/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{25,}/.test(readFileSync(path.join(root, f), "utf8")), f + " names a sheet");
});
