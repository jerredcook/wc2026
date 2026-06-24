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
- **"What needs to happen"** — on the final group matchday, each table shows a plain-English qualification scenario per team (*Won the group · Through · A draw is enough · Must win to be sure · Out of the top two*), derived by enumerating every remaining win/draw/loss combination through the same adversarial 2026-tiebreaker clinch test the bracket uses.
- **Top scorers — Golden Boot race**, a live leaderboard built from the scoring plays already in the match feed (own goals excluded, penalties flagged), with ties sharing a rank.
- **Follow a team** — pick a favorite nation (persisted): it's starred everywhere, pinned in a bar with its next match, and goal alerts can be scoped to just that team.
- **Team rankings** — all 48 qualified nations listed by FIFA World Ranking, filterable by confederation.
- **Team info popup** — click any team name *anywhere* (schedule, standings, third-place race, knockout bracket, Today bar, friendlies, or the rankings table) to open a profile card: flag, FIFA rank, group, confederation, head coach, capital, World Cup appearances and best finish, a fact about the country, the team's **full schedule & results** (group games and resolved knockout fixtures, each tappable into the match card), and the **official final 26-player squad** (every player with position and club, color-coded by position). Each player also carries a **club-role tag** — Starter / Rotation / Sub / Reserve / Injured / On loan — a researched one-time snapshot of their status at their club going into the tournament.
- **Player cards** — click any player in a squad to open a detailed card, enriched **live** from Wikipedia + Wikidata: a recent photo, bio, date of birth / age, birthplace & nationality, height, the positions they've played, current club, and international caps & goals where available — with one-tap links to Wikipedia, FBref, and Transfermarkt for full match logs and disciplinary (cards) data. Like the live scores, this needs a network connection (works on the hosted site, not a `file://` copy).
- **Match-detail popover** — tap any match (schedule, Today bar, or bracket) — clicking a *team name* opens that team's card; clicking anywhere else opens a match card with the teams/score, kickoff in the active zone, venue and capacity, a **goals & cards timeline**, a **match-stats comparison** (possession, shots, on-target, corners, fouls, offsides, cards, saves), a **World Cup head-to-head** of the two nations' past meetings (1930–2022, from the archive — West Germany folded into Germany), the **lineups**, and an expandable **full play-by-play commentary** — all loaded on demand from ESPN's match summary (and from the preserved snapshot when the live feed is gone).
- **Knockout bracket ("Bracket · Live")** — a stylized dark-and-gold bracket with the World Cup trophy in the centre: the two halves of the draw mirror inward and close on the Final. Every slot starts as a compact code chip (`1·C` = Group C winner, `2·F` = runner-up, `3·ABCDF` = best third, `W·1` = winner of the feeding match) and resolves to a flag + team name as groups play out; scores, a live/FT badge, winner highlighting in gold, and finally the crowned champion all fill in from the live feed as the tournament progresses. Group finishers drop into their Round-of-32 slots early: a placing is **confirmed** once it's locked (group complete, or no rival can reach the team's points), and a current group leader that has **clinched advancing** is shown in its slot as a **`PROJ` (projected)** placement that auto-corrects if the final group game swaps 1st/2nd.
- **Time-zone toggle** — view kickoff times in ET, your local zone, or any picked zone.
- **Dark mode** (respects your system preference) and **persistent preferences** — theme, time zone, filters, open/closed sections, and auto-refresh are remembered across visits.
- **Installable** — add it to your phone's home screen for a full-screen, app-like experience (see below).
- **World Cup history** — every champion since 1930; tap any tournament to expand the final, the top-four finishers, key stats, a notable fact, a **per-tournament Golden Boot leaderboard**, the **host-stadiums list**, and its **full match results by round** (lazy-loaded from a static snapshot). Tap any historic match (e.g. the France 4–3 Argentina 2018 thriller) to open the same detail popover with its **goal & card timeline, venue, and both teams' lineups**; tap any participating **team to see its full squad** (grouped by position, with appearances/starts). Matches, scorers, lineups and squads are pre-pulled from ESPN and venues from [openfootball](https://github.com/openfootball) (CC0) by [`scripts/build-history.mjs`](scripts/build-history.mjs) into [`data/wc/`](data/wc/), so everything loads fast and works offline. (Modern squads are the full 23/26; pre-substitution eras show the players who appeared.)
- **Pre-tournament warm-up friendlies** played across the host nations (collapsible).

## Installing it (add to home screen)

The app ships a web manifest and icons, so it can be installed:

- **iPhone / iPad (Safari):** Share → *Add to Home Screen*. It launches full-screen with its own icon.
- **Android (Chrome):** the ⋮ menu shows *Install app* / *Add to Home screen*.
- **Desktop (Chrome/Edge):** an install icon appears in the address bar.

### Offline

A small **network-first** service worker ([`sw.js`](sw.js)) makes the installed app resilient: it **always tries the network first**, so when you're online you get fresh content (no stale-cache surprises). Only when the network is unreachable does it serve the last-cached app shell, so the page still opens offline. Live score feeds (ESPN / Anthropic) are cross-origin and are never intercepted or cached — they go straight to the network and degrade gracefully on their own when there's no connection.

## How live data works

Live scores are fetched at runtime from three sources, tried in order:

1. **ESPN's public scoreboard** (`site.api.espn.com/.../soccer/fifa.world/scoreboard`) — keyless and CORS-friendly, so it works in any normal browser **when the page is served over http(s)**. Each tournament day so far is fetched in parallel and merged, so one refresh backfills every completed result plus anything live right now.
2. **Claude web search** (Anthropic API) — used as a fallback when the page is open inside Claude's artifact view.
3. **The preserved snapshot** (`data/2026-snapshot.json`) — see *Preserving the live data* below.

If none is reachable — e.g. the file is opened straight from disk via `file://`, where browsers block web requests — the app degrades gracefully, keeps the last scores it has, and the status line says so plainly.

The standings and the bracket both recompute from the scores every refresh.

### Preserving the live data

Because the 2026 scores, scorers, lineups and commentary come from a live third-party feed, they would vanish if ESPN ever drops or changes the data. So we snapshot the feed into a committed file and let the app **fall back to it**:

- [`scripts/snapshot-live.mjs`](scripts/snapshot-live.mjs) captures every played match into [`data/2026-snapshot.json`](data/) in the *exact* shape the app's live parser produces — the full event list (scores, goal scorers, red cards) plus each match's goals/cards timeline, lineups, and full commentary.
- When the two live sources above both fail, the app loads that snapshot and runs it through the **same** pipeline — so the schedule, **group standings, Golden Boot leaderboard and the knockout bracket all reconstruct from preserved data**, and the status line reads *"✓ Archived — showing the preserved snapshot."* Match popovers fall back too, tagged *📦 Archived from snapshot*.
- It's only ever a fallback: while the tournament is on, fresh live data is always preferred, and the snapshot is never even fetched unless a live source fails.

Re-run it to keep the archive current, and once more after the final for the permanent record:

```bash
node scripts/snapshot-live.mjs          # capture every match up to today
node scripts/snapshot-live.mjs --full   # ignore the "today" cap
```

A year from now, even if every live source is gone, opening the app still shows the complete 2026 tournament.

## Group standings & FIFA tiebreakers

Tables are derived from completed group matches. In-progress matches are listed under their group as provisional and counted once they finish. Teams are ranked by FIFA's official **2026** criteria, in order:

1. Points
2. Head-to-head points among the tied teams
3. Head-to-head goal difference among the tied teams
4. Head-to-head goals scored among the tied teams
5. Goal difference (all group matches)
6. Goals scored (all group matches)
7. Disciplinary record (fewest cards)
8. FIFA World Ranking

**Note the 2026 change:** head-to-head is now applied **before** overall goal difference — the reverse of 2018/2022 — so a team can finish above another it beat head-to-head even with a worse overall goal difference. Criteria 2–4 are applied only to the matches between the still-tied teams, and re-applied recursively to any sub-group that stays level — matching FIFA's procedure. The drawing of lots was removed for 2026 and replaced by the FIFA World Ranking, so ties are always broken. The one criterion **not** modeled is disciplinary points (criterion 7); a table separated by the ranking is tagged `rank`, and rows whose order was decided by head-to-head are tagged `h2h`. These tags appear only once a group is complete.

## Knockout bracket

The bracket structure (which group winners / runners-up / best-third-placed teams meet in each Round-of-32 slot, and how every winner flows up to the Final) is fixed by the official 2026 schedule and verified against it. It is drawn as a **mirrored tree** — the left half flows right, the right half flows left, and both close on the centred **Final** beneath the trophy, with orthogonal connector lines (drawn from the real card positions, so they stay aligned across resize/scroll) lighting up gold once a feeding match is decided. Each match carries its date and venue, and live results are matched to the correct slot by **date + venue** — stable whether a slot still shows a placeholder (rendered as a gold code chip) or has resolved to a real team with its flag. The third-place play-off is shown beneath the main tree, and the champion is crowned in the centre once the Final is decided.

Group finishers drop into the Round-of-32 slots as soon as their place is mathematically secured — using the **2026 tiebreakers**, so a head-to-head sweep counts. A placing is **confirmed** (shown settled) when no remaining result can dislodge it — e.g. a team that has beaten everyone who could draw level on points has *won the group* outright, even before the final matchday. A current group leader that has only clinched a top-2 **berth** is shown in its slot tagged **`PROJ`** (projected) and auto-corrects if the last games swap 1st/2nd. The clinch test enumerates every remaining result and, because head-to-head points is the first tiebreaker, treats a team as secure over a rival only when it strictly leads that rival on head-to-head points (deeper, goal-margin-based criteria are taken as adversarial).

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
