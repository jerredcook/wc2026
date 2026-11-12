/* The version number, the changelog and the release check have to agree. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VERSION_RE, entries, checkRelease } from "../scripts/release-notes.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { VERSION } = createRequire(import.meta.url)(path.join(ROOT, "js", "core.js"));
const changelog = readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = v => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);

test("the version is written as 1.2.3 or 1.2.3-pre", () => {
  assert.match(VERSION, VERSION_RE);
});

test("the version number lives in one place", () => {
  for (const f of ["index.html", "sw.js", "manifest.webmanifest", "privacy.html"]) {
    const text = readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!text.includes(VERSION), `${f} has the version typed into it; it should read VERSION from js/core.js`);
  }
  assert.equal(readFileSync(path.join(ROOT, "js", "core.js"), "utf8").split(VERSION).length - 1, 1, "js/core.js should state the version exactly once");
});

test("the changelog's newest entry is this version", () => {
  const list = entries(changelog);
  assert.ok(list.length, "CHANGELOG.md has no version entries");
  const [, a, b, c, pre] = VERSION_RE.exec(VERSION);
  assert.equal(list[0].version, `${a}.${b}.${c}`, "add an entry to CHANGELOG.md for the version in js/core.js");
  if (pre) assert.equal(list[0].when, "not yet released", "a -pre version's entry is marked 'not yet released'");
  else assert.ok(isDate(list[0].when), "a released version's entry carries its date, like 2026-11-15");
  assert.ok(list[0].body.length > 40, "the entry says what changed");
});

test("changelog entries run newest first, each version once, older ones dated", () => {
  const list = entries(changelog);
  for (let i = 1; i < list.length; i++) {
    assert.ok(num(list[i - 1].version) > num(list[i].version), `${list[i - 1].version} should come above ${list[i].version}`);
    assert.ok(isDate(list[i].when), `${list[i].version} is not the newest entry, so it needs a release date`);
  }
});

test("a release is refused unless the tag, the version and the changelog agree", () => {
  const log = "# What's new\n\n## 0.2.0 — 2026-12-01\n\n- Added a thing.\n\n## 0.1.0 — 2026-11-15\n\n- First.\n";
  assert.deepEqual(checkRelease({ tag: "v0.2.0", version: "0.2.0", changelog: log }), { ok: true, notes: "- Added a thing." });

  const refused = (args, re) => { const r = checkRelease(args); assert.equal(r.ok, false); assert.match(r.why, re); };
  refused({ tag: "v0.2.0", version: "0.2.0-pre", changelog: log }, /remove "-pre"/);
  refused({ tag: "v0.2.1", version: "0.2.0", changelog: log }, /the tag is v0\.2\.1/);
  refused({ tag: "0.2.0", version: "0.2.0", changelog: log }, /the tag is 0\.2\.0/);
  refused({ tag: "v0.3.0", version: "0.3.0", changelog: log }, /newest entry in CHANGELOG\.md is 0\.2\.0/);
  refused({ tag: "v0.2.0", version: "0.2.0", changelog: log.replace("2026-12-01", "not yet released") }, /needs its release date/);
  refused({ tag: "v0.2.0", version: "0.2.0", changelog: "# What's new\n\n## 0.2.0 — 2026-12-01\n" }, /is empty/);
  refused({ tag: "v0.2.0", version: "banana", changelog: log }, /not in the form/);
  refused({ tag: "v0.2.0", version: "0.2.0", changelog: "nothing here" }, /missing/);
});

test("today's working copy is not releasable by accident", () => {
  if (!VERSION.endsWith("-pre")) return;
  assert.equal(checkRelease({ tag: "v" + VERSION, version: VERSION, changelog }).ok, false);
  assert.equal(checkRelease({ tag: "v" + VERSION.replace("-pre", ""), version: VERSION, changelog }).ok, false);
});
