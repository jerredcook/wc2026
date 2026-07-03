# FIFA World Cup 2026 — Stadiums & Live Tracker

A near-zero-dependency web app for the 2026 FIFA World Cup (June 11 – July 19, 2026) hosted across the USA, Canada, and Mexico. It shows all 16 stadiums and their full match schedule, live & final scores, computed group standings, and the complete knockout bracket — and it pulls live data on its own, so nothing goes stale.

The whole app is [`index.html`](index.html) — HTML, CSS, and vanilla JavaScript, no build step or framework. Three small companion files make it installable and offline-capable: [`manifest.webmanifest`](manifest.webmanifest), [`apple-touch-icon.png`](apple-touch-icon.png), and a network-first service worker ([`sw.js`](sw.js)).

## Features

- **All 16 stadiums** with FIFA tournament names, real venue names, city, capacity, and resident home teams (NFL / MLS / Liga MX / CFL).
- **Full match schedule** — every group and knockout fixture, with kickoff times in U.S. Eastern (ET) matched to the FOX / Telemundo broadcast schedule. Three late games that kick off at 12:00 AM ET and roll past midnight are flagged with their next-day Eastern date.
- **Today & Live banner** — today's fixtures with live scores, full-time results, and upcoming kickoff times. Knockout games show **who's actually playing** (e.g. *South Africa vs Canada*), or a readable placeholder while undetermined (*Mexico vs 3rd (C/E/F/H/I)*), with their score and timeline — pulled across from the bracket by matching each fixture to its bracket match (date + venue), so the schedule and popovers are no longer just "Round of 32 · time · location". On a **rest day** it doesn't dead-end — it shows the **next fixture** (day, kickoff in your zone, and the matchup), tappable straight into the match card.
- **Full Schedule** — a forward-looking list of every fixture **grouped by date** (with a *Today* marker), right at the top of the page so you never have to dig through the bracket to find what's next. Each row uses the same Today-bar rendering — kickoff time **in your timezone**, the matchup (resolved teams or a knockout slot label like *3rd (B/E/F/I/J)*), and round · city — and is tappable into the match card. Defaults to **upcoming-only** with a one-tap toggle to **all**, respects the country/group/team filters, and date groups collapse individually or all at once.
- **Filters** by country, group (A–L), and team, with a running summary and reset.
- **Live & final scores** pulled automatically on load and via the **Refresh latest scores** button. Matches in progress show a red LIVE badge and the current minute, and the page **auto-refreshes every 60s while a match is live** (and **wakes itself at the next kickoff** / when the tab regains focus). A goal **flashes** the match on screen, and you can opt in to **browser goal notifications**. The live poll is lean: finished matchdays are **cached and never re-fetched**, so it only pulls today + the remaining fixture days (≈13 requests now, shrinking to a handful by the semifinals, instead of the whole 39-day window every minute).
- **Inline goals & cards timeline** — every played (and live) match shows its scorers and cards **by minute** right under the score (e.g. `7' ⚽ Dembélé · 13' 🟥 Sulaka · 20' ⚽ Dembélé`), in both the Today bar and the full schedule, with no tap needed. It's parsed from the same scoreboard feed the scores come from, so it costs no extra requests and is preserved in the snapshot too.
- **Results browser** — a collapsible *Results* section lists **every completed match**, each with its goals & cards timeline by minute and tappable into the full match card — the results-organized companion to the venue-organized schedule grid, with a running matches-played / goals tally. **Group by round** (Group A–L, then the knockouts) **or by date** (newest first), and **filter by nation, group, or host country** (the same filters as the schedule, so picking a team pulls up just its results). Round groups **collapse individually or all at once** for quick scanning, and each **team card has a "See results" button** that jumps straight here, filtered to that nation.
- **Group standings — live**, computed from the fetched scores (never hardcoded), with full FIFA tiebreakers (see below), plus a **best-third-placed race** showing the top-8 Round-of-32 cut line. Once every group is final the page **shifts into knockout mode** — the tables retitle to *Group Stage — Final Tables*, and the layout demotes the now-frozen Standings/best-thirds while surfacing **Results** and the **Golden Boot** race, the things that change day to day in the knockouts.
- **Recent-form dots** — each standings row and team card carries a small W/D/L strip (green/grey/red, hover for the score and opponent) summarising how each side has been playing.
- **"What needs to happen"** — on the final group matchday, each table shows a plain-English qualification scenario per team (*Won the group · Through · A draw is enough · Must win to be sure · Out of the top two*), derived by enumerating every remaining win/draw/loss combination through the same adversarial 2026-tiebreaker clinch test the bracket uses.
- **Top scorers — Golden Boot race**, a live leaderboard built from the scoring plays already in the match feed (own goals excluded, penalties flagged), with ties sharing a rank.
- **Card tracker** — yellow & red cards in four views: **by team** (a discipline leaderboard, sorted by reds then yellows, each team tappable), **fair play** (FIFA fair-play points — yellow −1, second-yellow −3, direct red −4 — the actual group tiebreaker, most-penalised first), **by round**, and **by match** (most-booked games, reds weighted, tappable into the timeline). Built from the same goals/cards timeline already on each match, so it costs no extra requests.
- **Follow a team** — pick a favorite nation (persisted): it's starred everywhere, pinned in a bar with its next match, and goal alerts can be scoped to just that team.
- **Team rankings — kickoff vs. now** — all 48 qualified nations listed by FIFA World Ranking, filterable by confederation. Each row shows the ranking **at kickoff** (used for seeding) *and* the **current** ranking, with the movement between them (▲ up / ▼ down). The live ranking is pulled straight from FIFA's own feed by the daily GitHub Action into [`data/rankings.json`](data/) — FIFA publishes on fixed dates (~monthly), so "now" updates when they do (the next release after a World Cup reflects its results). Team profile cards show both ranks too. (The fetch script takes `--women`, ready for the Women's World Cup edition.)
- **Team info popup** — click any team name *anywhere* (schedule, standings, third-place race, knockout bracket, Today bar, friendlies, or the rankings table) to open a profile card: flag, FIFA rank, group, confederation, head coach, capital, World Cup appearances and best finish, a fact about the country, the team's **full schedule & results** (group games and resolved knockout fixtures, each tappable into the match card), and the **official final 26-player squad** (every player with position and club, color-coded by position). Each player also carries a **club-role tag** — Starter / Rotation / Sub / Reserve / Injured / On loan — a researched one-time snapshot of their status at their club going into the tournament.
- **Player cards** — click any player in a squad to open a detailed card, enriched **live** from Wikipedia + Wikidata: a recent photo, bio, date of birth / age, birthplace & nationality, height, the positions they've played, current club, and international caps & goals where available — with one-tap links to Wikipedia, FBref, and Transfermarkt for full match logs and disciplinary (cards) data. Like the live scores, this needs a network connection (works on the hosted site, not a `file://` copy).
- **Match-detail popover** — tap any match (schedule, Today bar, or bracket) — clicking a *team name* opens that team's card; clicking anywhere else opens a match card with the teams/score, kickoff in the active zone, venue and capacity, a **goals & cards timeline**, a **match-stats comparison** (possession, shots, on-target, corners, fouls, offsides, cards, saves), a **World Cup head-to-head** of the two nations' past meetings (1930–2022, from the archive — West Germany folded into Germany), the **lineups**, and an expandable **full play-by-play commentary** — all loaded on demand from ESPN's match summary (and from the preserved snapshot when the live feed is gone).
- **Knockout bracket ("Bracket · Live")** — a stylized dark-and-gold bracket with the World Cup trophy in the centre: the two halves of the draw mirror inward and close on the Final. On open it **auto-scrolls to the round that's live** (or the next match) rather than the finished far-left Round of 32 — so on a phone it lands on the action and walks inward toward the trophy as the rounds deepen. Every slot starts as a compact code chip (`1·C` = Group C winner, `2·F` = runner-up, `3·ABCDF` = best third, `W·1` = winner of the feeding match) and resolves to a flag + team name as groups play out; scores, a live/FT badge, winner highlighting in gold, and finally the crowned champion all fill in from the live feed as the tournament progresses. **Penalty shootouts are first-class**: a knockout game that ends level shows each side's shootout tally beside the score (e.g. *1 (3) / 1 (4)*), the shootout winner takes the gold highlight (and advances correctly through Pick'em/results logic), rows across Today/Schedule/Results carry a *`3–4 pens`* tag, and a drawn Final still crowns its champion with the shootout score under the trophy. Each card is labelled with its **match number** (`R32-8`, `R16-1`, `QF-1`, …) so a `W·8` feeder chip can be traced back to the exact match it depends on, and shows the **kickoff time in the active timezone** alongside the date. Group finishers drop into their Round-of-32 slots early: a placing is **confirmed** once it's locked (group complete, or no rival can reach the team's points), and a current group leader that has **clinched advancing** is shown in its slot as a **`PROJ` (projected)** placement that auto-corrects if the final group game swaps 1st/2nd.
- **Time-zone aware** — kickoff times default to your **auto-detected local zone** (re-resolved each load, so it follows you if you travel), with one-tap toggles to U.S. Eastern (the broadcast reference) or any picked zone.
- **Add to calendar** — export the whole tournament (📅 Calendar) or a single nation's matches (from its team card) as a standard `.ics` file with correct UTC kickoff instants, so the games land at the right local time in Apple / Google / Outlook calendars. Played matches carry the result in the event notes, and a nation's export includes its **knockout run** (resolved opponents, or the feeder slot like *Winner R32·8* while undetermined), not just the group games. The team filter and match highlighting resolve knockout teams the same way, and the app **wakes itself at the next kickoff** (plus refreshes when the tab regains focus), so live coverage starts even if the page was opened before the game.
- **Dark mode** (respects your system preference) and **persistent preferences** — theme, time zone, filters, open/closed sections, and auto-refresh are remembered across visits.
- **Installable** — add it to your phone's home screen for a full-screen, app-like experience (see below).
- **World Cup history — men's *and* women's** — a **Men's / Women's toggle** switches the whole section between the men's tournaments (every champion since 1930) and the **Women's World Cup** (all nine editions, 1991–2023). Tap any tournament to expand the final, the top-four finishers, key stats, a notable fact, a **per-tournament Golden Boot leaderboard**, the **host-stadiums list**, and its **full match results by round** (lazy-loaded from a static snapshot). Tap any historic match (e.g. the France 4–3 Argentina 2018 thriller, or the USA 2–0 Netherlands 2019 women's final) to open the same detail popover with its **goal & card timeline, venue, and both teams' lineups**; tap any participating **team to see its full squad** (grouped by position, with appearances/starts). Matches, scorers, lineups and squads are pre-pulled from ESPN (men's `fifa.world` → [`data/wc/`](data/wc/); women's `fifa.wwc` → `data/wwc/`) and venues from [openfootball](https://github.com/openfootball) (CC0) by [`scripts/build-history.mjs`](scripts/build-history.mjs) (`--women` for the women's build), so everything loads fast and works offline. ESPN's women's data reaches back to 2003; **1991/1995/1999** show a hand-authored summary (final, podium, Golden Boot). (Modern squads are the full 23/26; pre-substitution eras show the players who appeared.)
- **Pre-tournament warm-up friendlies** played across the host nations (collapsible).

## Installing it (add to home screen)

**Live app: [jerredcook.github.io/wc2026](https://jerredcook.github.io/wc2026/)** (hosted free on GitHub Pages).

It's a full PWA — proper manifest (`id`, `standalone`, theme color, 192/512/maskable icons) and a network-first service worker — so it installs as a real app:

- **Android (Chrome):** open the link and tap the in-app **⬇ Install app** button (or the ⋮ menu → *Install app*). Launches full-screen with its own adaptive icon, works offline.
- **iPhone / iPad (Safari):** Share → *Add to Home Screen*.
- **Desktop (Chrome/Edge):** an install icon appears in the address bar.

Because it's a standards-compliant PWA, the *same* code can later be wrapped as a **Trusted Web Activity** (e.g. via [PWABuilder](https://www.pwabuilder.com/)) for a Google Play listing — no rewrite, just a thin Android shell over this site.
- **Desktop (Chrome/Edge):** an install icon appears in the address bar.

### Offline

A small **network-first** service worker ([`sw.js`](sw.js)) makes the installed app resilient: it **always tries the network first**, so when you're online you get fresh content (no stale-cache surprises). Only when the network is unreachable does it serve the last-cached app shell, so the page still opens offline. Live score feeds (ESPN / Anthropic) are cross-origin and are never intercepted or cached — they go straight to the network and degrade gracefully on their own when there's no connection.

## How live data works

Live scores are fetched at runtime from three sources, tried in order:

1. **ESPN's public scoreboard** (`site.api.espn.com/.../soccer/fifa.world/scoreboard`) — keyless and CORS-friendly, so it works in any normal browser **when the page is served over http(s)**. **Every** tournament day — past *and* upcoming (Jun 11 → Jul 19) — is fetched in parallel and merged, so one refresh backfills every completed result, anything live right now, *and* the upcoming knockout matchups ESPN already knows. That last part is what makes winners appear in the next round and best-third teams slot into the Round of 32 (today/past dates use a no-store fetch for live freshness; future dates are browser-cached so they're not re-hammered every 60 s).
2. **Claude web search** (Anthropic API) — used as a fallback when the page is open inside Claude's artifact view.
3. **The preserved snapshot** (`data/2026-snapshot.json`) — see *Preserving the live data* below.

If none is reachable — e.g. the file is opened straight from disk via `file://`, where browsers block web requests — the app degrades gracefully, keeps the last scores it has, and the status line says so plainly.

The standings and the bracket both recompute from the scores every refresh.

### Preserving the live data

Because the 2026 scores, scorers, lineups and commentary come from a live third-party feed, they would vanish if ESPN ever drops or changes the data. So we snapshot the feed into a committed file and let the app **fall back to it**:

- [`scripts/snapshot-live.mjs`](scripts/snapshot-live.mjs) captures every played match into [`data/2026-snapshot.json`](data/) in the *exact* shape the app's live parser produces — the full event list (scores, goal scorers, red cards) plus each match's goals/cards timeline, lineups, and full commentary.
- When the two live sources above both fail, the app loads that snapshot and runs it through the **same** pipeline — so the schedule, **group standings, Golden Boot leaderboard and the knockout bracket all reconstruct from preserved data**, and the status line reads *"✓ Archived — showing the preserved snapshot."* Match popovers fall back too, tagged *📦 Archived from snapshot*. If the live feed comes back **partial** (fewer matches than we've archived), the app quietly fills the gaps from the snapshot rather than showing an incomplete tournament.
- It's only ever a fallback: while the tournament is on, fresh live data is always preferred, and the snapshot is never even fetched unless a live source fails or comes back short.
- **The capture never destroys data.** Each run **merges** into the existing archive — matches only accumulate (kept at their best-known status), and a match's summary is never dropped once captured, so a flaky or partial ESPN pull can't erase preserved data. If ESPN returns *less* than we already hold and nothing new is captured, the script **exits non-zero** so the daily Action emails a failure instead of passing green.

Re-run it to keep the archive current, and once more after the final for the permanent record:

```bash
node scripts/snapshot-live.mjs           # capture the full Jun 11–Jul 19 window (default)
node scripts/snapshot-live.mjs --today   # only up to today (skip not-yet-played dates)
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

The bracket structure (which group winners / runners-up / best-third-placed teams meet in each Round-of-32 slot, and how every winner flows up to the Final) is fixed by the official 2026 schedule and verified against it. It is drawn as a **mirrored tree** — the left half flows right, the right half flows left, and both close on the centred **Final** beneath the trophy, with orthogonal connector lines (drawn from the real card positions, so they stay aligned across resize/scroll) lighting up gold once a feeding match is decided. Each match carries its **match number** (`R32-8` — matching the `W·N` feeder chips so you can trace any slot back to the match that fills it), its date, **kickoff time in the active timezone**, and venue, and live results are matched to the correct slot by **date + venue** — stable whether a slot still shows a placeholder (rendered as a gold code chip) or has resolved to a real team with its flag. The third-place play-off is shown beneath the main tree, and the champion is crowned in the centre once the Final is decided.

**Road to the Final** — pick any placed team from the *🛣️ Trace a team's road to the final* selector and the bracket dims to spotlight only that nation's path, following the static winner-chain (`Winner R32-1` → `R16` → `QF` → `SF` → Final) from their entry match all the way to the centre.

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
