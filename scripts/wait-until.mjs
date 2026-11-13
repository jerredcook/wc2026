/* Waits for a time, or for as long as one job may, whichever comes first.

     node scripts/wait-until.mjs 2026-11-14T20:45Z [--max-minutes 345] [--horizon-hours 34]

   GitHub's scheduler runs timed jobs hours late, and a job may run for six
   hours at most. The "Start a workflow later" Action chains several of these
   waits, one job after another, to reach a time up to a day and a half ahead:
   each waits its share and the last one ends at the time asked for. A wait
   that finds the time already here ends at once.

   Exit code 1: the time cannot be read, or it is further off than the chain
   can reach (so a mistyped date fails at once instead of waiting for nothing). */
import { pathToFileURL } from "node:url";

/* What one wait should do. now and at are milliseconds; the rest are limits. */
export function plan(now, at, maxMs, horizonMs) {
  if (!Number.isFinite(at)) return { error: "that is not a time. Write it like 2026-11-14T20:45Z (UTC)." };
  const left = at - now;
  if (left <= 0) return { sleep: 0, reached: true };
  if (left > horizonMs) return { error: `that is ${(left / 36e5).toFixed(1)} hours away; the furthest this can wait is ${Math.round(horizonMs / 36e5)} hours.` };
  return { sleep: Math.min(left, maxMs), reached: left <= maxMs };
}

/* A time with no zone on it is read as UTC, never as the runner's local time. */
export const parseAt = s => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : s + "Z");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? Number(argv[i + 1]) : d; };
  const when = argv.find(a => !a.startsWith("--") && !/^\d+(\.\d+)?$/.test(a)) || "";
  const p = plan(Date.now(), parseAt(when), opt("max-minutes", 345) * 6e4, opt("horizon-hours", 34) * 36e5);
  if (p.error) { console.error(`::error::Cannot wait until "${when}": ${p.error}`); process.exit(1); }
  if (!p.sleep) console.log(`${when} is here. Nothing to wait for.`);
  else {
    console.log(`Waiting ${Math.round(p.sleep / 6e4)} minutes${p.reached ? `, until ${when}` : ` of the way to ${when}; the next job carries on`}.`);
    await new Promise(r => setTimeout(r, p.sleep));
  }
}
