/* Starting a workflow at a set time (scripts/wait-until.mjs and the "Start a
   workflow later" Action): how long each wait in the chain lasts, what is
   refused, and that the Action's chain is long enough for what it promises. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { plan, parseAt } from "../scripts/wait-until.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX = 345 * 6e4, HORIZON = 34 * 36e5, T = Date.parse("2026-11-13T20:00:00Z");

test("a wait lasts until the time, or as long as one job may, whichever is sooner", () => {
  assert.deepEqual(plan(T, T + 10 * 6e4, MAX, HORIZON), { sleep: 10 * 6e4, reached: true });
  assert.deepEqual(plan(T, T + MAX, MAX, HORIZON), { sleep: MAX, reached: true });
  assert.deepEqual(plan(T, T + 24 * 36e5, MAX, HORIZON), { sleep: MAX, reached: false });
  assert.deepEqual(plan(T, T, MAX, HORIZON), { sleep: 0, reached: true });
  assert.deepEqual(plan(T, T - 5 * 36e5, MAX, HORIZON), { sleep: 0, reached: true }, "a time already past is not waited for");
});

test("a chain of waits ends exactly at the time asked for", () => {
  let now = T, jobs = 0;
  const at = T + 24.75 * 36e5;                       // Friday afternoon to Saturday's pre-match start
  for (;;) { const p = plan(now, at, MAX, HORIZON); jobs++; now += p.sleep; if (p.reached) break; }
  assert.equal(now, at);
  assert.equal(jobs, 5);
});

test("a time that cannot be read, or is too far off, is refused at once", () => {
  assert.match(plan(T, parseAt("tomorrow at nine"), MAX, HORIZON).error, /not a time/);
  assert.match(plan(T, parseAt(""), MAX, HORIZON).error, /not a time/);
  assert.match(plan(T, parseAt("2027-11-14T20:45Z"), MAX, HORIZON).error, /hours away; the furthest this can wait is 34 hours/);
});

test("times are read as UTC unless they say otherwise", () => {
  assert.equal(parseAt("2026-11-14T20:45Z"), Date.UTC(2026, 10, 14, 20, 45));
  assert.equal(parseAt("2026-11-14T20:45"), Date.UTC(2026, 10, 14, 20, 45));
  assert.equal(parseAt("2026-11-14T15:45-05:00"), Date.UTC(2026, 10, 14, 20, 45));
});

test("the Action: its waits follow one another, reach as far as the script allows, and it may only start the workflows listed", () => {
  const y = readFileSync(path.join(ROOT, ".github", "workflows", "later.yml"), "utf8");
  const waits = [...y.matchAll(/^  (wait\d+):\n(?:.*\n)*?    timeout-minutes: (\d+)/gm)];
  assert.ok(waits.length >= 6, "at least six waits");
  waits.forEach((w, i) => { if (i) assert.match(y, new RegExp(`^  ${w[1]}:\\n    needs: wait${i}\\n`, "m"), `${w[1]} follows wait${i}`); });
  assert.match(y, new RegExp(`^  start:\\n    needs: wait${waits.length}\\n`, "m"), "the start follows the last wait");
  for (const w of waits) assert.ok(Number(w[2]) > 345 && Number(w[2]) <= 360, "each job's own limit is above the wait and within GitHub's six hours");
  assert.ok(waits.length * 345 / 60 >= 34, "the chain reaches the 34 hours the script accepts");
  assert.equal([...y.matchAll(/node scripts\/wait-until\.mjs "\$AT"/g)].length, waits.length, "every wait runs the same script on the same time");
  assert.match(y, /type: choice/, "the workflow to start is picked from a list");
  for (const f of [...y.matchAll(/^          - (\S+\.yml)$/gm)].map(m => m[1])) {
    assert.match(readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8"), /workflow_dispatch/, `${f} can be started by another workflow`);
  }
  assert.match(y, /^\s*actions: write/m, "it is allowed to start a workflow");
  assert.ok(!/\$\{\{\s*inputs\.[a-z_]+\s*\}\}[^\n]*\n?/.test(y.split("run:").slice(1).join("run:").replace(/env:\n(?:\s+[A-Z_]+: .*\n)+/g, "")), "what the person typed reaches the shell only through the environment");
});
