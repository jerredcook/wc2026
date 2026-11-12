/* Writes the fingerprint the live app uses to notice a newer build.

     node scripts/build-id.mjs > build.json     (run by the deploy workflow)

   The fingerprint covers the app's code only. A data refresh publishes the site
   again but leaves the fingerprint alone, so open copies of the app are offered
   a refresh only when the code itself has changed. build.json is generated at
   deploy time and is not kept in the repository. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The files that make up the Cap Day app itself. */
export const CODE = ["index.html", "js/core.js", "sw.js", "manifest.webmanifest"];

export function fingerprint(read = f => readFileSync(path.join(ROOT, f))) {
  const h = createHash("sha256");
  for (const f of CODE) { h.update(f + "\n"); h.update(read(f)); h.update("\n"); }
  return h.digest("hex").slice(0, 16);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { VERSION } = createRequire(import.meta.url)(path.join(ROOT, "js", "core.js"));
  console.log(JSON.stringify({ code: fingerprint(), version: VERSION, built: new Date().toISOString() }));
}
