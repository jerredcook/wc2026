/* AO Matchday, AO Central New Jersey's app: American Outlaws chapters and watch parties on top of Cap Day.
   Loaded only by ao.html, after the main script, so it can use its globals
   (S, $, h, D, fmtDay, fmtTime, NAME, render, track). The chapter and watch
   party listings are a snapshot of theamericanoutlaws.com (data/ao/chapters.json). */
"use strict";
const AO_OWN = "middlesex-county";   // AO Central New Jersey, whose app this is
const AO = { data: null, home: AO_OWN, here: null, q: "", wq: "", all: false, geo: "", more: false, linked: null, copied: false, notes: null };
/* A chapter's own link (ao.html?chapter=<slug>, the one on its sign) opens the app on that chapter. It becomes the
   person's saved chapter only if they have not already picked one themselves. */
try {
  const saved = localStorage.getItem("ao.home"), m = /[?&]chapter=([a-z0-9-]+)(?:&|$)/.exec(location.search || "");
  AO.home = (m && m[1]) || saved || AO.home;
  if (m && !saved) AO.linked = m[1];
} catch (e) {}

/* What people do on the AO page is counted apart from Cap Day's (the name dates from when the page was a concept). */
track = function (name) { name = "ao-concept: " + name; try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) {} };

const aoChapter = slug => AO.data && AO.data.chapters.find(c => c.slug === slug);
const aoName = c => "AO " + c.name;
function aoMiles(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(s));
}
const aoOrigin = () => AO.here || aoChapter(AO.home);
const aoMi = c => { const m = aoMiles(aoOrigin(), c); return m == null ? "" : m < 1 ? "here" : Math.round(m) + " mi"; };
const aoMaps = addr => "https://maps.google.com/?q=" + encodeURIComponent(addr);
const aoPage = c => "https://theamericanoutlaws.com/chapters/" + encodeURIComponent(c.slug);
const aoCrest = c => c.logo ? `<img class="crest" src="${h(c.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest ph',textContent:'AO'}))">` : `<span class="crest ph">AO</span>`;
function aoStatus(c) {
  if (!c.status) return "";
  const k = c.status === "Official" ? "ok" : c.status === "Rebuilding" ? "rb" : "un";
  return `<span class="aost ${k}">${h(c.status)}${c.num ? " · #" + c.num : ""}</span>`;
}

/* The match the hub's match card is showing. */
function aoMatch() { return focus(); }
/* A watch party's own position when the listing gives one (a chapter can use different bars), else its chapter's. */
const aoAt = x => (x.p.lat != null && x.p.lng != null ? x.p : x.c);
/* A party belongs to a match when the two kickoff times agree to within three hours: the two sites do not always agree to the minute. */
const aoSameKickoff = (a, b) => Math.abs(D(a) - D(b)) <= 3 * 36e5;

function aoParties(m) {
  if (!AO.data || !m) return [];
  const out = [];
  for (const c of AO.data.chapters) for (const p of (c.parties || [])) if (p.venue && aoSameKickoff(p.date, m.date)) out.push({ c, p });
  const o = aoOrigin();
  out.sort((x, y) => (aoMiles(o, aoAt(x)) ?? 1e9) - (aoMiles(o, aoAt(y)) ?? 1e9) || x.c.name.localeCompare(y.c.name));
  return out;
}

/* Every other chapter's party for this match: the nearest five, all of them, or the ones a search finds. */
function aoWatchList(rest) {
  const q = AO.wq.trim().toLowerCase();
  const found = q ? rest.filter(x => (x.c.name + " " + x.c.state + " " + x.p.venue + " " + x.p.address).toLowerCase().includes(q)) : rest;
  const shown = q ? found.slice(0, 40) : AO.all ? found : found.slice(0, 5);
  const row = x => `<div class="aor"><div class="aot"><div class="aon">${h(aoName(x.c))}</div><b>${h(x.p.venue)}</b>${x.p.address ? `<small>${h(x.p.address)}</small>` : ""}</div>
      <div class="aod">${h(aoMi(aoAt(x)))}${x.p.address ? `<a href="${h(aoMaps(x.p.address))}" target="_blank" rel="noopener">Map</a>` : ""}</div></div>`;
  return (q ? `<div class="cnote" style="margin:8px 0 0">${found.length} match${found.length === 1 ? "" : "es"}${found.length > 40 ? ", nearest 40 shown" : ""}</div>` : "") +
    (shown.map(row).join("") || `<div class="empty">No watch party matches “${h(AO.wq)}”.</div>`) +
    (!q && rest.length > 5 ? `<div class="acts"><button class="btn" onclick="AO.all=!AO.all;renderWatch()">${AO.all ? "Show the nearest five" : "Show all " + rest.length}</button></div>` : "");
}

/* Matches you can drive to: a home match whose stadium is within about four hours of your chapter (or of you, once
   you have shared your location). Distances are straight lines, so they are given as "about". */
const AO_DRIVE = 250;
function aoNear(m) {
  const v = m && m.ha === "H" && m.vinfo;
  if (!v || typeof v.lat !== "number" || typeof v.lng !== "number") return null;
  const mi = aoMiles(aoOrigin(), v);
  return mi != null && mi <= AO_DRIVE ? Math.round(mi) : null;
}
const aoNearText = mi => (mi < 3 ? "In town" : "About " + mi + " mi from " + (AO.here ? "you" : "your chapter"));
fixtureNote = function (m) { const mi = aoNear(m); return mi == null ? "" : `<div class="aonear">🚗 ${aoNearText(mi)}</div>`; };

/* What the chapter's leaders have written for the app: notes for the watch party card and a songbook
   (data/ao/notes.json, copied from a sheet they keep by scripts/build-ao-notes.mjs). It is their text, shown as
   plain text: every character goes through h(). */
const aoWritten = () => (AO.notes && Object.prototype.hasOwnProperty.call(AO.notes, AO.home) && AO.notes[AO.home]) || null;
const aoEtDay = iso => { try { return D(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); } catch (e) { return ""; } };
/* Notes for this match: the ones dated for its day (U.S. Eastern) first, then the undated ones. Two at most. */
function aoNotes(m) {
  const w = aoWritten(); if (!w || !Array.isArray(w.notes) || !m) return [];
  const day = aoEtDay(m.date), ok = n => n && typeof n.text === "string" && n.text;
  return w.notes.filter(n => ok(n) && n.date === day).concat(w.notes.filter(n => ok(n) && !n.date)).slice(0, 2);
}

function renderWatch() {
  const el = $("aoWatch"); if (!el) return;
  const m = aoMatch();
  if (!AO.data || !m) { el.innerHTML = ""; return; }
  const notes = aoNotes(m).map(n => `<div class="aonote">${h(n.text)}</div>`).join("");
  const said = notes ? `<div class="aonotes"><div class="kicker">From the chapter</div>${notes}</div>` : "";
  const title = (m.ha === "H" ? "USA vs " : "USA at ") + m.opp.name + (S.team === "women" ? " (W)" : "");
  const all = aoParties(m), home = all.find(x => x.c.slug === AO.home), rest = all.filter(x => x.c.slug !== AO.home);
  const hc = aoChapter(AO.home);
  /* Closed, the card is the one thing a member needs: where their own chapter is watching. Every other party in the country folds away under it. */
  el.innerHTML = `<div class="card aocard">
    <div class="kicker">Watch with American Outlaws</div>
    <div class="cnote" style="margin:2px 0 0">${h(title)} · ${h(fmtDay(m.date))} · ${h(fmtTime(m.date))}</div>
    ${aoNear(m) != null ? `<div class="aonear">🚗 You could go: ${h(m.venue)} is ${h(aoNearText(aoNear(m)).replace(/^[AI]/, c => c.toLowerCase()))}.</div>` : ""}
    ${home ? `<div class="aohome">${aoCrest(home.c)}<div class="aot"><div class="kicker" style="color:var(--red)">Your chapter${home.p.official ? " · official watch party" : ""}</div>
        <div class="aon big">${h(aoName(home.c))}</div><b>${h(home.p.venue)}</b>${home.p.address ? `<small>${h(home.p.address)}</small>` : ""}</div>
        ${said}<div class="aoacts">${home.p.address ? `<a class="btn" href="${h(aoMaps(home.p.address))}" target="_blank" rel="noopener" onclick="track('directions')">📍 Directions</a>` : ""}
        <button class="btn" onclick="aoSub()">📅 Add to calendar</button></div></div>`
      : hc ? `<div class="empty" style="margin:8px 0 0">${h(aoName(hc))} hasn't posted a watch party for this match yet.</div>${said ? `<div class="aohome">${said}</div>` : ""}` : ""}
    ${rest.length ? `<details ${AO.more ? "open" : ""} ontoggle="AO.more=this.open"><summary>${rest.length} more watch part${rest.length === 1 ? "y" : "ies"} across the country</summary>
      <input class="aoq" id="aoWQ" type="search" placeholder="Search by city, state, or bar" value="${h(AO.wq)}" autocomplete="off" enterkeyhint="search" aria-label="Search watch parties">
      <div class="cnote" style="margin:8px 0 0">Nearest to ${AO.here ? "you" : "your chapter"} first.</div>
      <div id="aoWList">${aoWatchList(rest)}</div>
      <div class="acts"><button class="btn" onclick="aoLocate()">${AO.here ? "📍 Using your location" : "📍 Sort by my location"}</button></div>
      ${AO.geo ? `<div class="cnote" style="margin:8px 0 0">${h(AO.geo)}</div>` : ""}</details>` : ""}
  </div>`;
  const box = $("aoWQ"); if (box) box.addEventListener("input", e => { AO.wq = e.target.value; $("aoWList").innerHTML = aoWatchList(rest); });
}

/* The chapter's own calendar feed (data/ao/cal/<chapter>.ics, written by scripts/build-ao-chapters.mjs):
   every match the chapter has named a place for, with the bar as the location. It uses the hub's dialog. */
const AO_SUB = [$("subHead").textContent, $("subText").textContent];
function aoSub() {
  const c = aoChapter(AO.home); if (!c) return;
  const feed = new URL("data/ao/cal/" + encodeURIComponent(c.slug) + ".ics", location.href).href;
  $("subHead").textContent = aoName(c) + " watch parties";
  $("subText").textContent = "Add every " + aoName(c) + " watch party to your phone's calendar, with the bar and its address. New matches and changes of place arrive automatically. Each one carries a reminder the day before and two hours before kickoff; Google Calendar only shows them if you turn on notifications for this calendar.";
  $("subApple").href = feed.replace(/^https?:/, "webcal:");
  $("subGoogle").href = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(feed.replace(/^https:/, "http:"));
  $("sub").showModal(); track("calendar-chapter");
}
/* The hub's own "all matches" calendar uses the same dialog: give it its own words back. */
const aoBaseSub = openSub;
openSub = function () { $("subHead").textContent = AO_SUB[0]; $("subText").textContent = AO_SUB[1]; aoBaseSub(); };

function aoLocate() {
  if (!navigator.geolocation) { AO.geo = "This browser can't share its location."; renderAO(); return; }
  AO.geo = "Finding you…"; renderAO();
  navigator.geolocation.getCurrentPosition(p => {
    AO.here = { lat: p.coords.latitude, lng: p.coords.longitude }; AO.geo = ""; renderAO(); track("located");
  }, () => { AO.geo = "Location wasn't shared, so distances are from your chapter."; renderAO(); }, { timeout: 10000, maximumAge: 600000 });
}
function aoSetHome(slug) {
  AO.home = slug; try { localStorage.setItem("ao.home", slug); } catch (e) {}
  track("home " + slug); renderAO(); const top = $("match"); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: "smooth", block: "start" });
}

function aoList() {
  const q = AO.q.trim().toLowerCase(), o = aoOrigin();
  let list = AO.data.chapters.slice();
  if (q) list = list.filter(c => (c.name + " " + c.state + " " + (c.bar ? c.bar.name + " " + c.bar.address : "")).toLowerCase().includes(q));
  else list = list.filter(c => c.slug !== AO.home);
  list.sort((a, b) => (aoMiles(o, a) ?? 1e9) - (aoMiles(o, b) ?? 1e9) || a.name.localeCompare(b.name));
  const rows = list.slice(0, q ? 40 : 6).map(c => `<div class="aor"><div class="aot">
      <div class="aon">${h(aoName(c))} ${aoStatus(c)}</div>
      ${c.bar ? `<b>${h(c.bar.name)}</b><small>${h(c.bar.address)}</small>` : `<small>${h(c.state)}</small>`}
      <div class="aol"><a href="${h(aoPage(c))}" target="_blank" rel="noopener">Chapter page</a>${c.ig ? `<a href="${h(c.ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}
      ${c.slug !== AO.home ? `<a href="#" onclick="aoSetHome('${h(c.slug)}');return false">Make this my chapter</a>` : ""}</div></div>
      <div class="aod">${h(aoMi(c))}</div></div>`).join("");
  return (q ? `<div class="cnote" style="margin:8px 0 0">${list.length} match${list.length === 1 ? "" : "es"}</div>` : `<div class="blk" style="margin-top:14px">Closest to ${AO.here ? "you" : "your chapter"}</div>`) + (rows || `<div class="empty">No chapter matches “${h(AO.q)}”.</div>`);
}
function renderChapters() {
  const el = $("aoChapters"); if (!el) return;
  if (!AO.data) { el.innerHTML = ""; return; }
  const hc = aoChapter(AO.home), when = D(AO.data.captured).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const w = aoWritten(), songs = hc && w && Array.isArray(w.songs) ? w.songs.filter(s => s && typeof s.title === "string" && typeof s.words === "string") : [];
  const book = songs.length ? sec("songs", "Songbook", songs.length + (songs.length === 1 ? " chant" : " chants and songs") + " from " + h(aoName(hc)),
    songs.map(s => `<details class="aosong"><summary>${h(s.title)}</summary><div class="aowords">${h(s.words)}</div></details>`).join("")) : "";
  el.innerHTML = sec("chapters", "Find your crew", (hc ? h(aoName(hc)) + " · " : "") + AO.data.chapters.length + " American Outlaws chapters", `
    <div class="cnote">Search by city, state, or bar.</div>
    ${hc ? `<div class="aohome">${aoCrest(hc)}<div class="aot"><div class="kicker" style="color:var(--red)">Your chapter</div>
      <div class="aon big">${h(aoName(hc))} ${aoStatus(hc)}</div>
      ${hc.bar ? `<b>${h(hc.bar.name)}</b><small>${h(hc.bar.address)}</small>` : `<small>${h(hc.state)}</small>`}
      <div class="acts" style="margin-top:10px"><a class="btn" href="${h(aoPage(hc))}/signup" target="_blank" rel="noopener">Join this chapter</a>
      <a class="btn" href="${h(aoPage(hc))}" target="_blank" rel="noopener">Chapter page</a>
      ${hc.ig ? `<a class="btn" href="${h(hc.ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}</div>
      <div class="aol" style="margin-top:10px"><a href="#" onclick="aoShare();return false">${AO.copied ? "Link copied" : "Share this chapter's link"}</a>
      <a href="ao-sign.html?chapter=${encodeURIComponent(hc.slug)}">Print a sign for the bar</a></div></div></div>` : ""}
    <input class="aoq" id="aoQ" type="search" placeholder="Search chapters" value="${h(AO.q)}" autocomplete="off" enterkeyhint="search">
    <div id="aoList">${aoList()}</div>
    <div class="cnote" style="margin:12px 0 0">Chapters, bars and watch parties copied from theamericanoutlaws.com on ${h(when)}. A chapter that has not named a place for a match is not listed for it.</div>`) + book;
  $("aoQ").addEventListener("input", e => { AO.q = e.target.value; $("aoList").innerHTML = aoList(); });
}
/* The band at the top names the chapter the app is set to. For any chapter but our own it says who built it. */
const AO_BAND = [$("aoBandW").textContent, $("aoBandP").textContent];
function renderBand() {
  const c = aoChapter(AO.home), own = !c || c.slug === AO_OWN;
  $("aoBandW").textContent = own ? AO_BAND[0] : aoName(c);
  $("aoBandP").textContent = own ? AO_BAND[1] : "AO Matchday, set to " + aoName(c) + ". Built by a member of AO Central New Jersey; not a product of American Outlaws national.";
}
/* The link that opens the app on this chapter, for a text or a group chat. */
const aoLink = c => new URL("ao.html?chapter=" + encodeURIComponent(c.slug), location.href).href;
function aoShare() {
  const c = aoChapter(AO.home); if (!c) return;
  const url = aoLink(c); track("share-chapter");
  if (navigator.share) navigator.share({ title: "AO Matchday", text: aoName(c) + " on AO Matchday: when the USA plays and where we watch.", url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { AO.copied = true; renderChapters(); }, () => {});
}
/* The listings have arrived: a link naming a chapter that does not exist falls back to the saved one, or ours. */
function aoLoaded(j) {
  AO.data = j;
  if (!aoChapter(AO.home)) { let s = null; try { s = localStorage.getItem("ao.home"); } catch (e) {} AO.home = aoChapter(s) ? s : AO_OWN; }
  else if (AO.linked === AO.home) { try { localStorage.setItem("ao.home", AO.home); } catch (e) {} track("chapter-link " + AO.home); }
  AO.linked = null;
  renderAO();
}
function renderAO() {
  try { renderBand(); } catch (e) {}
  try { renderFixtures(); } catch (e) {}     // its rows say which matches are within driving distance of the chapter
  try { renderWatch(); } catch (e) { $("aoWatch").innerHTML = ""; }
  try { renderChapters(); } catch (e) { $("aoChapters").innerHTML = ""; }
}

/* The installed AO app starts at ao.html#app (ao.webmanifest). Standing alone without that mark means the page
   was opened inside Cap Day's own window, where it cannot be installed: the Install button then shows the steps. */
try { if (location.hash === "#app") sessionStorage.setItem("ao.app", "1"); } catch (e) {}
inOwnApp = function () { try { return sessionStorage.getItem("ao.app") === "1" && matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; } };

/* Redraw the AO cards whenever the hub redraws (team switch, data arriving). */
const aoBaseRender = render;
render = function () { aoBaseRender.apply(this, arguments); renderAO(); };
fetch("data/ao/chapters.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null)
  .then(j => { if (j) aoLoaded(j); }).catch(() => {});
fetch("data/ao/notes.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null)
  .then(j => { if (j && j.chapters && typeof j.chapters === "object") { AO.notes = j.chapters; renderAO(); } }).catch(() => {});
