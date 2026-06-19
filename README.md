# FIFA World Cup 2026 — Stadiums & Live Tracker

A near-zero-dependency web app for the 2026 FIFA World Cup (June 11 – July 19, 2026) hosted across the USA, Canada, and Mexico. It shows all 16 stadiums and their full match schedule, live & final scores, computed group standings, and the complete knockout bracket — and it pulls live data on its own, so nothing goes stale.

The whole app is [`index.html`](index.html) — HTML, CSS, and vanilla JavaScript, no build step or framework. Three small companion files make it installable and offline-capable: [`manifest.webmanifest`](manifest.webmanifest), [`apple-touch-icon.png`](apple-touch-icon.png), and a network-first service worker ([`sw.js`](sw.js)).

## Features

- **All 16 stadiums** with FIFA tournament names, real venue names, city, capacity, and resident home teams (NFL / MLS / Liga MX / CFL).
- **Full match schedule** — every group and knockout fixture, with kickoff times in U.S. Eastern (ET) matched to the FOX / Telemundo broadcast schedule. Three late games that kick off at 12:00 AM ET and roll past midnight are flagged with their next-day Eastern date.
- **Today & Live banner** — today's fixtures with live scores, full-time results, and upcoming kickoff times.
- **Filters** by country, group (A–L), and team, with a running summary and reset.
- **Live & final scores** pulled automatically on load and via the **Refresh latest scores** button. Matches in progress show a red LIVE badge and the current minute, and the page **auto-refreshes every 60s while a match is live**. A goal **flashes** the match on screen, and you can opt in to **browser goal notifications**.
- **Group standings — live**, computed from the fetched scores (never hardcoded), with full FIFA tiebreakers (see below), plus a **best-third-placed race** showing the top-8 Round-of-32 cut line.
- **Team rankings** — all 48 qualified nations listed by FIFA World Ranking, filterable by confederation.
- **Team info popup** — click any team name *anywhere* (schedule, standings, third-place race, knockout bracket, Today bar, friendlies, or the rankings table) to open a profile card: flag, FIFA rank, group, confederation, head coach, capital, World Cup appearances and best finish, a fact about the country, and a key-player squad list (color-coded by position).
- **Knockout bracket** — the complete Round of 32 → Final tree using the official 2026 slotting, with team names and scores filling in from the live feed as the tournament progresses.
- **Time-zone toggle** — view kickoff times in ET, your local zone, or any picked zone.
- **Dark mode** (respects your system preference) and **persistent preferences** — theme, time zone, filters, open/closed sections, and auto-refresh are remembered across visits.
- **Installable** — add it to your phone's home screen for a full-screen, app-like experience (see below).
- **Pre-tournament warm-up friendlies** played across the host nations (collapsible).

## Installing it (add to home screen)

The app ships a web manifest and icons, so it can be installed:

- **iPhone / iPad (Safari):** Share → *Add to Home Screen*. It launches full-screen with its own icon.
- **Android (Chrome):** the ⋮ menu shows *Install app* / *Add to Home screen*.
- **Desktop (Chrome/Edge):** an install icon appears in the address bar.

### Offline

A small **network-first** service worker ([`sw.js`](sw.js)) makes the installed app resilient: it **always tries the network first**, so when you're online you get fresh content (no stale-cache surprises). Only when the network is unreachable does it serve the last-cached app shell, so the page still opens offline. Live score feeds (ESPN / Anthropic) are cross-origin and are never intercepted or cached — they go straight to the network and degrade gracefully on their own when there's no connection.

## How live data works

Scores are **not stored in the file**. They are fetched at runtime from two sources, tried in order:

1. **ESPN's public scoreboard** (`site.api.espn.com/.../soccer/fifa.world/scoreboard`) — keyless and CORS-friendly, so it works in any normal browser **when the page is served over http(s)**. Each tournament day so far is fetched in parallel and merged, so one refresh backfills every completed result plus anything live right now.
2. **Claude web search** (Anthropic API) — used as a fallback when the page is open inside Claude's artifact view.

If neither is reachable — e.g. the file is opened straight from disk via `file://`, where browsers block web requests — the app degrades gracefully, keeps the last scores it has, and the status line says so plainly.

The standings and the bracket both recompute from the live scores every refresh.

## Group standings & FIFA tiebreakers

Tables are derived from completed group matches. In-progress matches are listed under their group as provisional and counted once they finish. Teams are ranked by FIFA's official 2026 criteria, in order:

1. Points
2. Goal difference (all group matches)
3. Goals scored (all group matches)
4. Head-to-head points among the tied teams
5. Head-to-head goal difference among the tied teams
6. Head-to-head goals scored among the tied teams

Criteria 4–6 are applied only to the matches between the still-tied teams, and re-applied recursively to any sub-group that remains level — matching FIFA's procedure. The only criteria **not** modeled are fair-play/disciplinary points and the final drawing of lots; a table that is still dead level after head-to-head is tagged `tied`. Rows whose order was decided by head-to-head are tagged `h2h`. These tags appear only once a group is complete, when the final ordering matters.

## Knockout bracket

The bracket structure (which group winners / runners-up / best-third-placed teams meet in each Round-of-32 slot, and how every winner flows up to the Final) is fixed by the official 2026 schedule and verified against it. Each match carries its date and venue, and live results are matched to the correct slot by **date + venue** — stable whether a slot still shows a placeholder (e.g. `Winner A`, `3rd C/E/F/H/I`) or has resolved to a real team. The third-place play-off is shown beneath the main tree.

## Running it

It's a static file, so any of these work:

```bash
# Open directly (saved scores only — file:// blocks live fetch)
open index.html

# Serve over http for live scores in a normal browser
python3 -m http.server 8000
# then visit http://localhost:8000/index.html
```

Inside Claude's artifact view, live fetching works without a server.

## Notes & data sources

- Kickoff times are U.S. Eastern, aligned to the FOX / Telemundo schedule.
- Live scores and bracket resolution come from ESPN's public FIFA World Cup scoreboard.
- Team-name differences between the feed and the fixtures (e.g. `Bosnia-Herzegovina` → `Bosnia`, `Congo DR` → `DR Congo`, `Türkiye`, `Curaçao`) are reconciled by a normalization + alias table.
