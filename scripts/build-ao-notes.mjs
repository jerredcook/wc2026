/* Rebuilds data/ao/notes.json: what a chapter's leaders have written for the app.

     AO_SHEETS="middlesex-county=<sheet id>" node scripts/build-ao-notes.mjs
     ... --dry      read the sheets, print what would be written, write nothing

   Each chapter that uses this keeps a Google Sheet with two tabs:
     Notes     (the first tab)   match date (optional) | note for the watch party card
     Songbook  (the second tab)  chant or song         | its words
   The sheet is shared "anyone with the link can view" and its id is kept out of
   the repository, in the AO_SHEETS secret (several chapters: "slug=id,slug=id").
   Without AO_SHEETS the script does nothing, so a copy of this repository
   without the secret still builds.

   What leaders type is somebody else's text going onto a public page, so it is
   treated as plain text and nothing more: control characters go, lengths are
   capped, and the page escapes every character when it draws it.

   Like the other data scripts it is careful about leaving a good file alone:
   - a sheet that cannot be read (or answers with a sign-in page instead of the
     sheet) keeps what the file already says for that chapter, and the script
     exits non-zero so the failure shows;
   - an empty tab is a real answer (the leaders took their notes down);
   - the file is byte-identical when nothing changed. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "ao", "notes.json");
const UA = "Mozilla/5.0 (compatible; sheet-reader/1.0)";
export const LIMITS = { note: 240, notes: 20, title: 80, words: 1500, songs: 60 };

/* ── CSV, as Google Sheets writes it (RFC 4180: quoted cells may hold commas, quotes and new lines) ── */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  const s = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* Plain text only: no control characters, tidy spacing, and a cap on length. `lines` keeps line breaks (song words). */
export function clean(v, max, lines = false) {
  let s = String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, " ");
  s = lines ? s.split("\n").map(l => l.replace(/\s+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/* A match date as leaders might type it: 11/17/2026, 11/17/26, 11/17, 2026-11-17, Nov 17, November 17, 2026.
   Returns "YYYY-MM-DD", "" for an empty cell, or null when it cannot be read as a date.
   A date with no year means its next occurrence (counting from a week before `today`, also "YYYY-MM-DD"). */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function readDate(v, today) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "";
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}|\d{2}))?$/.exec(s))) [m, d, y] = [+x[1], +x[2], x[3] == null ? null : +x[3] < 100 ? 2000 + +x[3] : +x[3]];
  else if ((x = /^(?:[a-z]{3,9}\.?,? )?([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(s)) && MONTHS.includes(x[1].slice(0, 3))) [m, d, y] = [MONTHS.indexOf(x[1].slice(0, 3)) + 1, +x[2], x[3] == null ? null : +x[3]];
  else return null;
  const iso = yy => `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const real = yy => { const t = new Date(Date.UTC(yy, m - 1, d)); return t.getUTCFullYear() === yy && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  if (y == null) {
    const from = new Date(Date.parse(today + "T00:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
    y = +today.slice(0, 4); if (real(y) && iso(y) < from) y++;
  }
  return y >= 2024 && y <= 2100 && real(y) ? iso(y) : null;
}

/* The top row is the sheet's own heading unless someone deleted it. */
const body = (rows, heading) => (rows.length && heading.test((rows[0][1] || "") + " " + (rows[0][0] || "")) ? rows.slice(1) : rows);

/* The Notes tab. A note for a match already more than a day past is dropped; so is one whose date cannot be read
   (better missing than shown on every match by mistake). Returns { notes, skipped }. */
export function readNotes(rows, today) {
  const notes = [], skipped = [], floor = new Date(Date.parse(today + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
  for (const r of body(rows, /note for the watch party|match date/i)) {
    const text = clean(r[1], LIMITS.note); if (!text) continue;
    const date = readDate(r[0], today);
    if (date == null) { skipped.push(`"${clean(r[0], 30)}" is not a date`); continue; }
    if (date && date < floor) continue;
    notes.push(date ? { date, text } : { text });
  }
  return { notes: notes.slice(0, LIMITS.notes), skipped };
}
/* The Songbook tab, in the order it is written. */
export function readSongs(rows) {
  const songs = [];
  for (const r of body(rows, /chant or song|^words \(/i)) {
    const title = clean(r[0], LIMITS.title), words = clean(r[1], LIMITS.words, true);
    if (title || words) songs.push({ title: title || "Untitled", words });
  }
  return songs.slice(0, LIMITS.songs);
}

/* "slug=id,slug=id" → [[slug, id]]. Anything that is not a plain slug and a plain sheet id is ignored. */
export const sheetList = v => String(v || "").split(",").map(x => x.trim().split("=")).filter(x => x.length === 2 && /^[a-z0-9-]+$/.test(x[0]) && /^[A-Za-z0-9_-]{20,}$/.test(x[1]));

const today = (now = Date.now()) => new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/* One tab as text, or null. A sheet that is no longer shared answers with a sign-in page, which is not the sheet. */
export async function readTab(id, gid, get = fetch, pause = 1500) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await get(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      const type = r.headers.get("content-type") || "", text = await r.text();
      if (r.ok && /^text\/csv/i.test(type) && !/^\s*</.test(text)) return text;
      if (r.status === 401 || r.status === 403 || r.status === 404 || /text\/html/i.test(type)) return null;     // not shared, or gone: trying again will not help
    } catch (e) {}
    if (attempt < 2) await new Promise(res => setTimeout(res, pause * (attempt + 1)));
  }
  return null;
}

/* Reads every sheet. Returns { result, failed, skipped }: `result` is the whole file; a chapter whose sheet could
   not be read keeps its old entry. Chapters no longer in the list are dropped. */
export async function build(sheets, old, { get = fetch, now = Date.now(), pause = 1500 } = {}) {
  const day = today(now), chapters = {}, failed = [], skipped = [];
  for (const [slug, id] of sheets) {
    const [notesCsv, songsCsv] = [await readTab(id, 0, get, pause), await readTab(id, 1, get, pause)];
    if (notesCsv == null || songsCsv == null) { failed.push(slug); if (old && old.chapters && old.chapters[slug]) chapters[slug] = old.chapters[slug]; continue; }
    const n = readNotes(parseCsv(notesCsv), day);
    for (const s of n.skipped) skipped.push(slug + ": " + s);
    chapters[slug] = { notes: n.notes, songs: readSongs(parseCsv(songsCsv)) };
  }
  return { result: { chapters }, failed, skipped };
}

export const serialize = result => JSON.stringify(result, null, 1) + "\n";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sheets = sheetList(process.env.AO_SHEETS);
  if (!sheets.length) { console.log("AO_SHEETS is not set: no chapter sheets to read. Nothing was changed."); process.exit(0); }
  let oldText = ""; try { oldText = readFileSync(FILE, "utf8"); } catch (e) {}
  let old = null; try { old = JSON.parse(oldText); } catch (e) {}
  const { result, failed, skipped } = await build(sheets, old);
  for (const [slug, c] of Object.entries(result.chapters)) console.log(`${slug}: ${c.notes.length} note${c.notes.length === 1 ? "" : "s"}, ${c.songs.length} song${c.songs.length === 1 ? "" : "s"}`);
  for (const s of skipped) console.log("Skipped a note: " + s);
  const text = serialize(result);
  if (process.argv.includes("--dry")) console.log(text);
  else if (text === oldText) console.log("Nothing changed.");
  else { writeFileSync(FILE, text); console.log("Wrote data/ao/notes.json"); }
  if (failed.length) { console.error("Could not read the sheet for: " + failed.join(", ") + ". What the file already said for them was kept."); process.exit(1); }
}
