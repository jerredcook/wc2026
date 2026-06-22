#!/usr/bin/env node
/* Historical World Cup ETL.
   Pulls every past tournament from ESPN's public fifa.world scoreboard — the
   same endpoint the live app uses — and writes one normalized JSON file per
   tournament to data/wc/<year>.json, plus a manifest data/wc/index.json.
   Re-runnable; historical data is stable so this is a one-time snapshot.

   Usage:  node scripts/build-history.mjs            (all tournaments)
           node scripts/build-history.mjs 1970 2018  (only those years)
*/
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "wc");
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const OF_BASE = "https://raw.githubusercontent.com/openfootball/world-cup.json/master"; // CC0 venues

/* Normalize a nation for matching ESPN ↔ openfootball (their spellings differ). */
const NALIAS = { germanyfr:"westgermany", frgermany:"westgermany",
  korearepublic:"southkorea", iriran:"iran", chinapr:"china",
  czechrepublic:"czechia", bosniaandherzegovina:"bosnia", capeverdeislands:"capeverde",
  unitedstatesofamerica:"unitedstates", usa:"unitedstates" };
function nt(s){ const k=String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z]/g,""); return NALIAS[k]||k; }
function pairKey(a,b){ return [nt(a),nt(b)].sort().join("~"); }
function splitGround(g){ const i=String(g||"").lastIndexOf(", "); return i<0?{name:g||"",city:""}:{name:g.slice(0,i),city:g.slice(i+2)}; }

/* Tournament windows (a day or two of buffer each side). 2022 was in winter. */
const TOURNAMENTS = [
  { year: 1930, host: "Uruguay",            start: "1930-07-12", end: "1930-07-31" },
  { year: 1934, host: "Italy",              start: "1934-05-26", end: "1934-06-11" },
  { year: 1938, host: "France",             start: "1938-06-03", end: "1938-06-20" },
  { year: 1950, host: "Brazil",             start: "1950-06-23", end: "1950-07-17" },
  { year: 1954, host: "Switzerland",        start: "1954-06-15", end: "1954-07-05" },
  { year: 1958, host: "Sweden",             start: "1958-06-07", end: "1958-06-30" },
  { year: 1962, host: "Chile",              start: "1962-05-29", end: "1962-06-18" },
  { year: 1966, host: "England",            start: "1966-07-10", end: "1966-07-31" },
  { year: 1970, host: "Mexico",             start: "1970-05-30", end: "1970-06-22" },
  { year: 1974, host: "West Germany",       start: "1974-06-12", end: "1974-07-08" },
  { year: 1978, host: "Argentina",          start: "1978-05-31", end: "1978-06-26" },
  { year: 1982, host: "Spain",              start: "1982-06-12", end: "1982-07-12" },
  { year: 1986, host: "Mexico",             start: "1986-05-30", end: "1986-06-30" },
  { year: 1990, host: "Italy",              start: "1990-06-07", end: "1990-07-09" },
  { year: 1994, host: "United States",      start: "1994-06-16", end: "1994-07-18" },
  { year: 1998, host: "France",             start: "1998-06-09", end: "1998-07-13" },
  { year: 2002, host: "South Korea / Japan",start: "2002-05-30", end: "2002-07-01" },
  { year: 2006, host: "Germany",            start: "2006-06-08", end: "2006-07-10" },
  { year: 2010, host: "South Africa",       start: "2010-06-10", end: "2010-07-12" },
  { year: 2014, host: "Brazil",             start: "2014-06-11", end: "2014-07-14" },
  { year: 2018, host: "Russia",             start: "2018-06-13", end: "2018-07-16" },
  { year: 2022, host: "Qatar",              start: "2022-11-19", end: "2022-12-19" },
];

/* slug normalized (lowercased, alphanumerics only) → display round */
const ROUND_N = {
  groupstage:"Group stage", firstround:"Group stage", "1stround":"Group stage", firststage:"Group stage",
  secondround:"Second round", "2ndround":"Second round", secondgroupstage:"Second round", secondstage:"Second round",
  roundof32:"Round of 32", roundof16:"Round of 16",
  quarterfinals:"Quarterfinals", quarterfinal:"Quarterfinals",
  semifinals:"Semifinals", semifinal:"Semifinals",
  thirdplace:"Third-place play-off", "3rdplace":"Third-place play-off", thirdplaceplayoff:"Third-place play-off",
  final:"Final",
};
const ROUND_ORDER = ["Group stage", "Second round", "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Third-place play-off", "Final"];
function titleCase(s){ return String(s||"").split(/[-_ ]/).filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(" "); }
function roundName(slug){ const k=String(slug||"").toLowerCase().replace(/[^a-z0-9]/g,""); return ROUND_N[k] || (slug?titleCase(slug):"Group stage"); }

function daysBetween(start, end){
  const out=[]; const d=new Date(start+"T00:00:00Z"), e=new Date(end+"T00:00:00Z");
  for(let t=d; t<=e; t.setUTCDate(t.getUTCDate()+1))
    out.push(`${t.getUTCFullYear()}${String(t.getUTCMonth()+1).padStart(2,"0")}${String(t.getUTCDate()).padStart(2,"0")}`);
  return out;
}
async function getJSON(url, tries=3){
  for(let i=0;i<tries;i++){
    try{ const r=await fetch(url,{headers:{ "cache-control":"no-cache" }}); if(r.ok) return await r.json(); }
    catch(e){}
    await new Promise(r=>setTimeout(r, 400*(i+1)));
  }
  return null;
}
async function pool(items, n, fn){
  const res=[]; let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)}, async ()=>{
    while(i<items.length){ const idx=i++; res[idx]=await fn(items[idx], idx); }
  }));
  return res;
}

function parseEvent(ev){
  const comp=(ev.competitions&&ev.competitions[0])||{};
  const cs=comp.competitors||[];
  const home=cs.find(c=>c.homeAway==="home")||cs[0];
  const away=cs.find(c=>c.homeAway==="away")||cs[1];
  if(!home||!away) return null;
  const nm=c=>(c.team&&(c.team.displayName||c.team.shortDisplayName||c.team.name))||"";
  const st=((ev.status||comp.status||{}).type||{}).state;
  const status=st==="post"?"FT":(st==="in"?"LIVE":"UPCOMING");
  const hs=parseInt(home.score,10), as=parseInt(away.score,10);
  const slug=((comp.season||ev.season||{}).slug)||"";
  const ven=comp.venue||{};
  const city=(ven.address&&(ven.address.city||ven.address.summary))||"";
  const phs=parseInt(home.shootoutScore,10), pas=parseInt(away.shootoutScore,10);
  const win = home.winner===true ? "home" : (away.winner===true ? "away" : null);
  const HS = Number.isFinite(hs)?hs:null, AS = Number.isFinite(as)?as:null;
  const m = {
    eid:String(ev.id||""),
    date:(ev.date||"").slice(0,10),
    round: roundName(slug),
    home:nm(home), away:nm(away),
    hs: HS, as: AS,
    venue: ven.fullName||"", city,
    status,
  };
  if(Number.isFinite(phs)&&Number.isFinite(pas)) m.pens={h:phs,a:pas};     // penalty shootout
  if(win && (HS===AS || m.pens)) m.win=win;                                // winner when score alone doesn't show it

  // Goal scorers (for the per-tournament Golden Boot). Scoring plays are
  // chronological; anything beyond the match score (hs+as) is a shootout kick,
  // so we cap at the real total. Own goals count toward the score but credit
  // no scorer; unrecorded scorers (ESPN gaps) are skipped.
  const homeId=String(home.id||""), awayId=String(away.id||"");
  const teamOf=tid=> String(tid)===homeId?m.home : (String(tid)===awayId?m.away : "");
  const goals=[]; const total=(HS||0)+(AS||0);
  if(Array.isArray(comp.details)){
    let accounted=0;
    for(const p of comp.details){
      if(!p.scoringPlay) continue;
      if(accounted>=total) break;                 // remaining plays are shootout penalties
      accounted++;
      const tx=((p.type&&(p.type.text||p.type.name))||"")+"";
      if(/own goal/i.test(tx)) continue;          // counts toward score, credits nobody
      const a=(p.athletesInvolved&&p.athletesInvolved[0])||null;
      const name=a&&(a.displayName||a.shortName);
      if(!name) continue;                          // unrecorded scorer
      const tid=(a.team&&a.team.id)||(p.team&&p.team.id);
      goals.push({scorer:name, team:teamOf(tid), pen:/penalt/i.test(tx)});
    }
  }
  m._goals=goals;
  return m;
}

/* openfootball grounds for a tournament: a pair→[{date,ground}] map plus the
   distinct host stadiums with how many matches each hosted. */
async function loadOpenfootball(year){
  const j = await getJSON(`${OF_BASE}/${year}/worldcup.json`);
  const ms = (j && j.matches) || [];
  const byPair = {}; const venueCount = {};
  for(const m of ms){
    if(!m.ground) continue;
    (byPair[pairKey(m.team1,m.team2)] = byPair[pairKey(m.team1,m.team2)] || []).push({ date:m.date, ground:m.ground });
    venueCount[m.ground] = (venueCount[m.ground]||0) + 1;
  }
  const stadiums = Object.keys(venueCount).map(g=>{ const s=splitGround(g); return { name:s.name, city:s.city, matches:venueCount[g] }; })
    .sort((a,b)=> b.matches-a.matches || a.name.localeCompare(b.name));
  return { byPair, stadiums, have: ms.length>0 };
}

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=";
const POS_ORDER = { GK:0, DF:1, MF:2, FW:3, "":4 };
/* Normalize ESPN's granular position labels (G, CD-L, CF-R, AM, RM, ST, SUB…)
   to the four broad lines. Order of tests matters. */
function posBroad(raw){
  const p = String(raw||"").toUpperCase();
  if(!p || p==="SUB") return "";
  if(p[0]==="G") return "GK";
  if(/F|ST|RW|LW|SS/.test(p)) return "FW";
  if(/M/.test(p)) return "MF";
  if(/D|B/.test(p)) return "DF";
  return "";
}
/* Aggregate each team's squad from its matchday rosters across the tournament.
   Modern matchday rosters include the full bench (≈ the 23/26-man squad);
   pre-substitution eras list only the XI, so older squads are "players who
   appeared." apps = matchday-squad appearances, starts = times in the XI. */
async function fetchSquads(matches){
  const acc = {}; // team -> name -> {n,p,a,s}
  await pool(matches.filter(m=>m.eid), 8, async m=>{
    const j = await getJSON(SUMMARY + encodeURIComponent(m.eid));
    const rs = (j && j.rosters) || [];
    for(const t of rs){
      const tn = (t.team && t.team.displayName) || ""; if(!tn) continue;
      const team = acc[tn] = acc[tn] || {};
      for(const p of (t.roster || [])){
        const name = p.athlete && p.athlete.displayName; if(!name) continue;
        const broad = posBroad(p.position && p.position.abbreviation);
        const e = team[name] = team[name] || { n:name, p:broad, a:0, s:0 };
        e.a++; if(p.starter) e.s++;
        if(!e.p && broad) e.p = broad;   // fill a position once a real one appears
      }
    }
  });
  const out = {};
  for(const tn in acc){
    out[tn] = Object.values(acc[tn]).sort((a,b)=>
      ((POS_ORDER[a.p]??4)-(POS_ORDER[b.p]??4)) || b.s-a.s || b.a-a.a || a.n.localeCompare(b.n));
  }
  return out;
}

async function buildTournament(t){
  const days = daysBetween(t.start, t.end);
  const batches = await pool(days, 6, async ds => {
    const j = await getJSON(`${BASE}?dates=${ds}`);
    return (j&&j.events||[]).map(parseEvent).filter(Boolean);
  });
  const seen=new Set(), matches=[];
  for(const arr of batches) for(const m of arr){ if(m.eid&&seen.has(m.eid)) continue; if(m.eid) seen.add(m.eid); matches.push(m); }
  matches.sort((a,b)=> a.date<b.date?-1 : a.date>b.date?1 : 0);

  // Fix venues from openfootball (ESPN's historical venues are unreliable) and
  // build the host-stadiums list. Match by team pair, disambiguating by date.
  const of = await loadOpenfootball(t.year);
  let vfixed = 0;
  if(of.have){
    for(const m of matches){
      const cands = of.byPair[pairKey(m.home, m.away)];
      if(!cands || !cands.length) continue;
      const pick = cands.find(c=>c.date===m.date) || cands.sort((a,b)=>Math.abs(new Date(a.date)-new Date(m.date))-Math.abs(new Date(b.date)-new Date(m.date)))[0];
      if(pick){ const g=splitGround(pick.ground); m.venue=g.name; m.city=g.city; vfixed++; }
    }
  }

  const played = matches.filter(m=>m.hs!=null&&m.as!=null);
  const goals = played.reduce((n,m)=>n+m.hs+m.as,0);
  const fin = matches.find(m=>m.round==="Final");
  let champion=null;
  if(fin){
    if(fin.win) champion = fin.win==="home"?fin.home:fin.away;                          // incl. penalty wins
    else if(fin.hs!=null&&fin.as!=null&&fin.hs!==fin.as) champion = fin.hs>fin.as?fin.home:fin.away;
  }
  const rounds = ROUND_ORDER.filter(r=>matches.some(m=>m.round===r))
    .concat([...new Set(matches.map(m=>m.round))].filter(r=>!ROUND_ORDER.includes(r)));

  // Aggregate the tournament Golden Boot from per-match scorers, then strip the
  // working data so the stored matches stay lean.
  const tally={};
  for(const m of matches){ for(const g of (m._goals||[])){
    const k=g.scorer+"|"+g.team;
    (tally[k]=tally[k]||{scorer:g.scorer,team:g.team,goals:0,pens:0});
    tally[k].goals++; if(g.pen)tally[k].pens++;
  }}
  const scorers=Object.values(tally)
    .sort((a,b)=> b.goals-a.goals || a.pens-b.pens || a.scorer.localeCompare(b.scorer))
    .slice(0,20);
  matches.forEach(m=>{ delete m._goals; });

  const squads = await fetchSquads(matches);

  return {
    year:t.year, host:t.host, source: of.have ? "ESPN + openfootball (venues)" : "ESPN",
    rounds,
    stats:{ matches:matches.length, played:played.length, goals, venuesFixed:vfixed, teams:Object.keys(squads).length },
    champion,
    scorers,
    stadiums: of.stadiums,
    squads,
    matches,
  };
}

const wanted = process.argv.slice(2).map(Number).filter(Boolean);
const list = wanted.length ? TOURNAMENTS.filter(t=>wanted.includes(t.year)) : TOURNAMENTS;

await mkdir(OUT, { recursive:true });
const manifest=[];
for(const t of list){
  process.stdout.write(`• ${t.year} ${t.host} … `);
  const data = await buildTournament(t);
  await writeFile(join(OUT, `${t.year}.json`), JSON.stringify(data));
  manifest.push({ year:t.year, host:t.host, matches:data.stats.matches, goals:data.stats.goals, champion:data.champion });
  console.log(`${data.stats.matches} matches, ${data.stats.goals} goals${data.champion?`, champion ${data.champion}`:""}`);
}
manifest.sort((a,b)=>b.year-a.year);
await writeFile(join(OUT, "index.json"), JSON.stringify(manifest, null, 1));
console.log(`\n✓ wrote ${list.length} tournament file(s) + index.json to data/wc/`);
