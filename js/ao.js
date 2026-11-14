/* AO Matchday concept: American Outlaws chapters and watch parties on top of Cap Day.
   Loaded only by ao.html, after the main script, so it can use its globals
   (S, $, h, D, fmtDay, fmtTime, NAME, render, track). The chapter and watch
   party listings are a snapshot of theamericanoutlaws.com (data/ao/chapters.json). */
"use strict";
const AO = { data: null, home: "middlesex-county", here: null, q: "", all: false, geo: "", more: false };
try { AO.home = localStorage.getItem("ao.home") || AO.home; } catch (e) {}

/* Visits on the concept page are counted apart from Cap Day's. */
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
  return `<span class="st ${k}">${h(c.status)}${c.num ? " · #" + c.num : ""}</span>`;
}

/* The match the hub is showing: the selected team's next fixture. */
function aoMatch() { const d = S.data[S.team]; return d && d.fixtures && d.fixtures[0]; }

function aoParties(m) {
  if (!AO.data || !m) return [];
  const out = [];
  for (const c of AO.data.chapters) for (const p of (c.parties || [])) if (p.date === m.date) out.push({ c, p });
  const o = aoOrigin();
  out.sort((x, y) => (aoMiles(o, x.c) ?? 1e9) - (aoMiles(o, y.c) ?? 1e9));
  return out;
}

function renderWatch() {
  const el = $("aoWatch"); if (!el) return;
  const m = aoMatch();
  if (!AO.data || !m) { el.innerHTML = ""; return; }
  const title = (m.ha === "H" ? "USA vs " : "USA at ") + m.opp.name + (S.team === "women" ? " (W)" : "");
  const all = aoParties(m), home = all.find(x => x.c.slug === AO.home), rest = all.filter(x => x !== home);
  const hc = aoChapter(AO.home);
  const venue = ({ c, p }) => p.venue ? `<b>${h(p.venue)}</b>${p.address ? `<small>${h(p.address)}</small>` : ""}` : `<b>Location to be announced</b><small>Check the chapter page closer to kickoff</small>`;
  const row = x => `<div class="aor">${aoCrest(x.c)}<div class="aot"><div class="aon">${h(aoName(x.c))}</div>${venue(x)}</div>
      <div class="aod">${h(aoMi(x.c))}${x.p.address ? `<a href="${h(aoMaps(x.p.address))}" target="_blank" rel="noopener">Map</a>` : ""}</div></div>`;
  const shown = AO.all ? rest : rest.slice(0, 5);
  /* Closed, the card is the one thing a member needs: where their own chapter is watching. The other parties fold away. */
  el.innerHTML = `<div class="card aocard">
    <div class="kicker">Watch with American Outlaws</div>
    <div class="cnote" style="margin:2px 0 0">${h(title)} · ${h(fmtDay(m.date))} · ${h(fmtTime(m.date))}</div>
    ${home ? `<div class="aohome">${aoCrest(home.c)}<div class="aot"><div class="kicker" style="color:var(--red)">Your chapter${home.p.official ? " · official watch party" : ""}</div>
        <div class="aon big">${h(aoName(home.c))}</div>${venue(home)}</div>
        ${home.p.address ? `<a class="btn aogo" href="${h(aoMaps(home.p.address))}" target="_blank" rel="noopener" onclick="track('directions')">📍 Directions</a>` : ""}</div>`
      : hc ? `<div class="empty" style="margin:8px 0 0">${h(aoName(hc))} hasn't posted a watch party for this match yet.</div>` : ""}
    ${rest.length ? `<details ${AO.more ? "open" : ""} ontoggle="AO.more=this.open"><summary>${rest.length} more watch part${rest.length === 1 ? "y" : "ies"}${AO.here ? " near you" : " nearby"}</summary>` + shown.map(row).join("") +
      `<div class="acts">${rest.length > 5 ? `<button class="btn" onclick="AO.all=!AO.all;renderWatch()">${AO.all ? "Show fewer" : "Show all " + rest.length}</button>` : ""}
      <button class="btn" onclick="aoLocate()">${AO.here ? "📍 Using your location" : "📍 Sort by my location"}</button></div>
      ${AO.geo ? `<div class="cnote" style="margin:8px 0 0">${h(AO.geo)}</div>` : ""}</details>` : ""}
  </div>`;
}

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
  const rows = list.slice(0, q ? 40 : 6).map(c => `<div class="aor">${aoCrest(c)}<div class="aot">
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
  el.innerHTML = sec("chapters", "Find your crew", (hc ? h(aoName(hc)) + " · " : "") + AO.data.chapters.length + " American Outlaws chapters", `
    <div class="cnote">Search by city, state, or bar.</div>
    ${hc ? `<div class="aohome">${aoCrest(hc)}<div class="aot"><div class="kicker" style="color:var(--red)">Your chapter</div>
      <div class="aon big">${h(aoName(hc))} ${aoStatus(hc)}</div>
      ${hc.bar ? `<b>${h(hc.bar.name)}</b><small>${h(hc.bar.address)}</small>` : `<small>${h(hc.state)}</small>`}
      <div class="acts" style="margin-top:10px"><a class="btn" href="${h(aoPage(hc))}/signup" target="_blank" rel="noopener">Join this chapter</a>
      <a class="btn" href="${h(aoPage(hc))}" target="_blank" rel="noopener">Chapter page</a>
      ${hc.ig ? `<a class="btn" href="${h(hc.ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}</div></div></div>` : ""}
    <input class="aoq" id="aoQ" type="search" placeholder="Search chapters" value="${h(AO.q)}" autocomplete="off" enterkeyhint="search">
    <div id="aoList">${aoList()}</div>
    <div class="cnote" style="margin:12px 0 0">Chapter list copied from theamericanoutlaws.com on ${h(when)}. Bars and watch parties are filled in for chapters in New Jersey, New York City, the Hudson Valley, and eastern Pennsylvania.</div>`);
  $("aoQ").addEventListener("input", e => { AO.q = e.target.value; $("aoList").innerHTML = aoList(); });
}
function renderAO() {
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
  .then(j => { if (j) { AO.data = j; renderAO(); } }).catch(() => {});
