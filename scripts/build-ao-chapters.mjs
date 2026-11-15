/* Rebuilds data/ao/chapters.json, the American Outlaws chapters and watch parties
   shown on the AO Matchday page (ao.html), from theamericanoutlaws.com.

     node scripts/build-ao-chapters.mjs            read the site and write the file
     node scripts/build-ao-chapters.mjs --dry      read the site, print a summary, write nothing

   It reads the chapter list once and then each chapter's own page, one at a
   time with a pause between them (about 280 pages, four to five minutes). A
   chapter's page gives its number, status, crest, Instagram, the bars it
   watches at (with map coordinates) and where it will be for each upcoming
   match.

   It is careful about leaving a good file alone:
   - a chapter whose page cannot be read keeps what the file already says;
   - if the list is much shorter than before, or more than a tenth of the pages
     fail, nothing is written and the script exits non-zero;
   - the file is byte-identical when nothing changed (the "captured" time only
     moves when the content does).

   It also writes a calendar feed for each chapter, data/ao/cal/<chapter>.ics:
   the matches that chapter has named a place for, with the bar as the location. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ics } from "./build-usa.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "ao", "chapters.json");
const CAL = path.join(ROOT, "data", "ao", "cal");
const SITE = "https://theamericanoutlaws.com";
const PAUSE_MS = 700;

const unescape = s => String(s).replace(/&amp;/g, "&").replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = html => unescape(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const cut = (s, from, to) => { const i = s.indexOf(from); if (i < 0) return ""; const j = to ? s.indexOf(to, i + from.length) : -1; return s.slice(i, j < 0 ? undefined : j); };

/* The chapter list page: every chapter's address on the site. */
export function parseList(html) {
  return [...new Set([...String(html).matchAll(/href="\/chapters\/([a-z0-9-]+)"/g)].map(m => m[1]))].sort();
}

/* The fixture feed writes times as 2026-11-18T00:00Z; AO's pages add the seconds. */
const shortIso = s => { const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(?::\d\d(?:\.\d+)?)?Z$/.exec(String(s)); return m ? m[1] + "Z" : null; };
const coord = (v, max) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= max && n !== 0 ? Math.round(n * 1e5) / 1e5 : null; };
/* Links from the site are shown as links: keep only plain https ones to the place they claim to be. */
const httpsAt = (u, host) => { try { const x = new URL(unescape(u)); return x.protocol === "https:" && (x.hostname === host || x.hostname.endsWith("." + host)) ? x.href : null; } catch (e) { return null; } };

/* One chapter's page. Returns null when the page is not a chapter page. */
export function parseChapter(html, slug) {
  html = String(html);
  const head = cut(html, "All chapters</a>", "</h1>");
  const name = text((/<h1[^>]*>([\s\S]*)$/.exec(head) || [])[1] || "");
  if (!name) return null;
  const before = head.slice(0, head.search(/<h1/));
  const state = text((before.match(/<div[^>]*>([^<]+)<\/div>\s*$/) || [])[1] || "") || "";
  const top = cut(html, "</h1>", "About</div>").slice(0, 4000);
  const out = { slug, name, state };
  const num = /Chapter #(\d{1,4})\b/.exec(top);
  if (num) out.num = +num[1];
  const kind = /<\/i>\s*(Official|Unofficial)\s+chapter\s*</.exec(cut(html, "Chapter status</div>"));
  const status = /<\/i>\s*Rebuilding\s*</.test(top) ? "Rebuilding" : kind ? kind[1] : "";
  if (status) out.status = status;

  /* The bars on the chapter's map: name, address, coordinates. */
  let bars = [];
  const feat = /const FEATURES = (\[[\s\S]*?\]);/.exec(html);
  if (feat) { try { bars = JSON.parse(feat[1]); } catch (e) { bars = []; } }
  bars = (Array.isArray(bars) ? bars : []).map(b => ({ name: String(b.name || "").trim(), address: String(b.address || "").trim(), lat: coord(b.lat, 90), lng: coord(b.lng, 180), official: !!b.official })).filter(b => b.name);
  if (bars.length) { out.bar = { name: bars[0].name, address: bars[0].address }; out.detail = true; if (bars[0].lat != null && bars[0].lng != null) { out.lat = bars[0].lat; out.lng = bars[0].lng; } }

  const ig = [...cut(html, "Follow along</div>", "Chapter status</div>").matchAll(/href="([^"]+)"/g)].map(m => httpsAt(m[1], "instagram.com")).find(Boolean);
  if (ig) out.ig = ig;
  const logo = [...top.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map(m => httpsAt(m[1], "theamericanoutlaws.com")).find(Boolean);
  if (logo) out.logo = logo;

  /* Where the chapter will be for each upcoming match. A match with no place named yet is left out. */
  const parties = [];
  const up = cut(html, "Upcoming Watch Parties</h2>", "Where We Watch</h2>") || cut(html, "Upcoming Watch Parties</h2>", "</section>");
  const blocks = up.split(/(?=<a[^>]*href="\/events\/)/).slice(1);
  for (const b of blocks) {
    const title = text((/<a[^>]*href="\/events\/[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(b) || [])[1] || "");
    const date = shortIso((/<local-time[^>]*\sdatetime="([^"]+)"/.exec(b) || [])[1]);
    if (!title || !date) continue;
    const seen = new Set();
    for (const m of b.matchAll(/google\.com\/maps\/search\/\?api=1&(?:amp;)?query=([^"]+)"/g)) {
      let address = ""; try { address = decodeURIComponent(m[1]).trim(); } catch (e) { continue; }
      if (!address || seen.has(address)) continue;
      seen.add(address);
      const bar = bars.find(x => x.address === address);
      const party = { date, title, venue: bar ? bar.name : "", address, official: bar ? bar.official : false };
      if (bar && bar.lat != null && bar.lng != null) { party.lat = bar.lat; party.lng = bar.lng; }
      if (party.venue) parties.push(party);
    }
  }
  if (parties.length) out.parties = parties;
  return out;
}

/* Put the fresh pages together with what the file already had.
   pages: { slug: parsed chapter | null (could not be read) | false (read, but not a chapter's page) }.
   The list links to a few pages that are not chapters ("start a chapter"); one of those is only a
   failure when the file had a chapter there before. */
export function merge(slugs, pages, old, now) {
  const was = new Map(((old && old.chapters) || []).map(c => [c.slug, c]));
  const failed = slugs.filter(s => pages[s] == null || (pages[s] === false && was.has(s)));
  const chapters = slugs.map(s => {
    const c = pages[s], o = was.get(s);
    if (!c) return o || null;                                    // could not be read: keep what we had
    if (!c.state) c.state = (o && o.state) || "International";   // chapters abroad are listed without a state
    if (c.lat == null && o && o.lat != null) { c.lat = o.lat; c.lng = o.lng; }      // no bar on the map: keep the rough position worked out by hand
    return c;
  }).filter(Boolean);
  chapters.sort((a, b) => (a.state === "International") - (b.state === "International") || a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  const same = old && JSON.stringify(old.chapters) === JSON.stringify(chapters);
  return { data: { captured: same ? old.captured : now, source: SITE + "/chapters", chapters }, failed, same: !!same };
}

/* A chapter's calendar feed: each match it has named a place for, with the bar as the location.
   A chapter with nothing posted gets an empty calendar, so a subscription made earlier keeps working. */
export function chapterCal(c) {
  const events = (c.parties || []).map((p, i) => ({
    uid: `ao-${c.slug}-${p.date.replace(/\W/g, "")}-${i}@capday`, start: p.date.replace(/Z$/, ":00Z"),
    summary: `${p.title} · AO ${c.name} watch party`, location: [p.venue, p.address].filter(Boolean).join(", "),
    desc: [p.official ? "Official American Outlaws watch party." : "", `${SITE}/chapters/${c.slug}`].filter(Boolean).join("\n"),
    alarms: ["-P1D", "-PT2H"],     // the day before, and two hours before kickoff
  }));
  return ics(`AO ${c.name} watch parties`, events);
}
/* Writes the feeds that differ from what is on disk. Returns how many were written. */
export function writeCals(chapters, dir = CAL) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const c of chapters) {
    if (!/^[a-z0-9-]+$/.test(c.slug)) continue;
    const file = path.join(dir, c.slug + ".ics"), text = chapterCal(c);
    let have = null; try { have = readFileSync(file, "utf8"); } catch (e) {}
    if (have !== text) { writeFileSync(file, text); n++; }
  }
  return n;
}

/* Refuse to replace a good file with a thin one. */
export function problems(result, slugs, old) {
  const out = [], before = ((old && old.chapters) || []).length;
  if (slugs.length < 150 || slugs.length < before * 0.8) out.push(`the chapter list has ${slugs.length} chapters (it had ${before})`);
  if (result.failed.length > slugs.length / 10) out.push(`${result.failed.length} of ${slugs.length} chapter pages could not be read`);
  const hadParties = ((old && old.chapters) || []).filter(c => (c.parties || []).length).length, has = result.data.chapters.filter(c => (c.parties || []).length).length;
  if (hadParties >= 10 && has < hadParties / 3) out.push(`only ${has} chapters list a watch party (${hadParties} did before)`);
  return out;
}

async function get(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; chapter-listing-reader/1.0)", "Accept": "text/html" }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch (e) { /* try once more */ }
    await new Promise(res => setTimeout(res, 3000));
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dry = process.argv.includes("--dry");
  let old = null; try { old = JSON.parse(readFileSync(FILE, "utf8")); } catch (e) {}
  const list = await get(SITE + "/chapters");
  if (!list) { console.error("The chapter list could not be read. Nothing was changed."); process.exit(1); }
  const slugs = parseList(list), pages = {};
  for (const [i, slug] of slugs.entries()) {
    const html = await get(`${SITE}/chapters/${slug}`);
    pages[slug] = html ? (parseChapter(html, slug) || false) : null;
    if ((i + 1) % 40 === 0) console.error(`  ${i + 1} of ${slugs.length} chapter pages read`);
    await new Promise(res => setTimeout(res, PAUSE_MS));
  }
  const now = new Date().toISOString().slice(0, 16) + "Z";
  const result = merge(slugs, pages, old, now), bad = problems(result, slugs, old);
  const ch = result.data.chapters, dates = {};
  for (const c of ch) for (const p of c.parties || []) dates[p.date] = (dates[p.date] || 0) + 1;
  console.error(`${ch.length} chapters · ${ch.filter(c => c.bar).length} with a bar · ${ch.filter(c => (c.parties || []).length).length} with a watch party posted · ${ch.filter(c => c.lat != null).length} with a position · ${result.failed.length} pages not read`);
  console.error("watch parties by kickoff: " + JSON.stringify(dates));
  if (bad.length) { console.error("Not written: " + bad.join("; ") + "."); process.exit(1); }
  if (dry) console.error("Dry run: nothing written.");
  else {
    if (result.same) console.error("Nothing changed.");
    else { writeFileSync(FILE, JSON.stringify(result.data) + "\n"); console.error("Wrote data/ao/chapters.json"); }
    const n = writeCals(result.data.chapters);
    if (n) console.error(`Wrote ${n} chapter calendars in data/ao/cal`);
  }
}
