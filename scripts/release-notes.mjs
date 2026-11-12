/* Checks that a release tag is honest, and prints that version's notes.

     node scripts/release-notes.mjs v0.1.0

   A tag may only be released when three things agree: the tag, the VERSION
   line in js/core.js, and a dated entry at the top of CHANGELOG.md. If they do,
   the entry's text is printed (the release workflow uses it as the release
   notes). If not, this exits non-zero and says which one is out of step. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* "0.1.0" or "0.1.0-pre" (on the way to 0.1.0, not released). */
export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(-pre)?$/;

/* The changelog's entries, newest first: [{ version, when, body }].
   An entry starts at a heading like "## 0.1.0 — 2026-11-15". */
export function entries(changelog) {
  const out = [];
  const parts = String(changelog).split(/^## +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const head = (nl < 0 ? part : part.slice(0, nl)).trim();
    const m = /^v?(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.+))?$/.exec(head);
    if (!m) continue;
    out.push({ version: m[1], when: (m[2] || "").trim(), body: nl < 0 ? "" : part.slice(nl + 1).trim() });
  }
  return out;
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Returns { ok: true, notes } or { ok: false, why }. */
export function checkRelease({ tag, version, changelog }) {
  const m = VERSION_RE.exec(version || "");
  if (!m) return { ok: false, why: `VERSION "${version}" is not in the form 1.2.3` };
  if (m[4]) return { ok: false, why: `VERSION is still "${version}": remove "-pre" from the line in js/core.js before tagging` };
  if (tag !== "v" + version) return { ok: false, why: `the tag is ${tag} but the app says it is v${version}` };
  const top = entries(changelog)[0];
  if (!top || top.version !== version) return { ok: false, why: `the newest entry in CHANGELOG.md is ${top ? top.version : "missing"}, not ${version}` };
  if (!isDate(top.when)) return { ok: false, why: `the CHANGELOG.md entry for ${version} needs its release date (it says "${top.when || "nothing"}")` };
  if (!top.body) return { ok: false, why: `the CHANGELOG.md entry for ${version} is empty` };
  return { ok: true, notes: top.body };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2];
  if (!tag) { console.error("usage: node scripts/release-notes.mjs v1.2.3"); process.exit(2); }
  const { VERSION } = createRequire(import.meta.url)(path.join(ROOT, "js", "core.js"));
  const r = checkRelease({ tag, version: VERSION, changelog: readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8") });
  if (!r.ok) { console.error("Not releasing: " + r.why + "."); process.exit(1); }
  console.log(r.notes);
}
