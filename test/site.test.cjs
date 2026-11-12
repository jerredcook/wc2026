/* Checks on the shipped files themselves: the pages must parse, every button
   must call something that exists, every file the app points at must be there,
   and the committed data must be well-formed. These catch the "typo that
   breaks the page on everyone's phone" class of mistake before it deploys. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = f => fs.existsSync(path.join(ROOT, f));
const inline = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

for (const page of ["index.html", "worldcup.html"]) {
  test(`${page}: every inline script parses`, () => {
    for (const src of inline(read(page))) new Function(src);
  });
}

test("index.html: every onclick / ontoggle calls a function that exists", () => {
  const html = read("index.html"), code = inline(html).join("\n") + read("js/core.js");
  const calls = new Set();
  for (const m of html.matchAll(/on(?:click|toggle)="([^"]*)"/g))
    for (const c of m[1].matchAll(/(?:^|[;\s(])([A-Za-z_$][\w$]*)\(/g)) calls.add(c[1]);
  const builtin = new Set(["if", "function"]);
  for (const name of calls) {
    if (builtin.has(name)) continue;
    assert.ok(new RegExp(`function ${name}\\(|(?:const|let) ${name} =`).test(code), `handler calls ${name}(), which is not defined`);
  }
  assert.ok(calls.size > 8, "expected to find the app's handlers");
});

test("index.html: an element hidden with the hidden attribute is not forced visible by its class", () => {
  const html = read("index.html"), css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const m of html.matchAll(/<(\w+)[^>]*class="([^"]*)"[^>]*\shidden[\s>]/g)) {
    for (const cls of m[2].split(/\s+/)) {
      const sets = new RegExp(`\\.${cls}\\{[^}]*display:`).test(css), guarded = new RegExp(`\\.${cls}\\[hidden\\]\\{display:none`).test(css);
      assert.ok(!sets || guarded, `.${cls} sets display, so [hidden] needs its own rule`);
    }
  }
});

test("every local file the app refers to exists", () => {
  const html = read("index.html") + read("worldcup.html");
  for (const m of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|png|svg|webmanifest|html|json))"/g)) assert.ok(exists(m[1]), `missing file: ${m[1]}`);
  const man = JSON.parse(read("manifest.webmanifest"));
  for (const i of man.icons) assert.ok(exists(i.src), `manifest icon missing: ${i.src}`);
  assert.ok(man.name && man.start_url && man.icons.some(i => i.sizes === "512x512"), "manifest needs a name, a start URL and a 512px icon");
  const shell = JSON.parse(read("sw.js").match(/const SHELL = (\[[^\]]*\]);/)[1]);
  for (const f of shell) assert.ok(f === "./" || exists(f), `service worker shell lists a missing file: ${f}`);
  assert.ok(shell.includes("./js/core.js"), "the core script must be available offline");
});

for (const key of ["women", "men"]) {
  test(`data/usa/${key}.json is well-formed`, async () => {
    const { validate } = await import("../scripts/build-usa.mjs");
    const d = JSON.parse(read(`data/usa/${key}.json`));
    assert.deepEqual(validate(d, null), []);
    assert.ok(!isNaN(Date.parse(d.updated)));
    const text = read(`data/usa/${key}.ics`);
    assert.ok(text.startsWith("BEGIN:VCALENDAR") && text.trimEnd().endsWith("END:VCALENDAR"));
    assert.equal(text.split("BEGIN:VEVENT").length, text.split("END:VEVENT").length);
  });
}

test("hand-written files: editorial.json and ahead.json", () => {
  const ed = JSON.parse(read("data/usa/editorial.json"));
  for (const [k, v] of Object.entries(ed)) {
    if (k === "_note") continue;
    if (k === "comps") { for (const c of Object.values(v)) assert.ok(c.how && c.history, "each competition needs 'how' and 'history'"); continue; }
    assert.match(k, /^\d+$/, "match entries are keyed by event id");
    assert.ok(typeof v.stakes === "string" && v.stakes.length > 20);
  }
  const ah = JSON.parse(read("data/usa/ahead.json"));
  for (const x of ah.items) {
    assert.ok(["women", "men"].includes(x.team) && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.what, "bad entry: " + JSON.stringify(x));
    if (x.to) assert.ok(x.to >= x.date);
  }
});

/* ── Workflows ──
   A push made by a workflow does not start other workflows. So any job that
   commits data has to start the deploy itself, or the data is never published
   (this went unnoticed from the switch to workflow deploys until Nov 2026). */
test("every workflow that pushes also starts the deploy, and is allowed to", () => {
  const dir = path.join(ROOT, ".github", "workflows");
  let pushers = 0;
  for (const f of fs.readdirSync(dir)) {
    const y = fs.readFileSync(path.join(dir, f), "utf8");
    if (!/^\s*git push\s*$/m.test(y)) continue;
    pushers++;
    assert.match(y, /gh workflow run deploy-pages\.yml/, `${f} pushes but never starts the deploy`);
    assert.match(y, /^\s*actions: write/m, `${f} needs "actions: write" to start the deploy`);
    assert.match(y, /echo "pushed=true" >> "\$GITHUB_OUTPUT"/, `${f} should record that it pushed`);
  }
  assert.ok(pushers >= 2, "expected the data workflows to be found");
  const deploy = fs.readFileSync(path.join(dir, "deploy-pages.yml"), "utf8");
  assert.match(deploy, /workflow_dispatch/, "the deploy must be startable by other workflows");
  assert.match(deploy, /node scripts\/build-id\.mjs > build\.json/, "the deploy writes the build fingerprint");
  assert.ok(deploy.indexOf("build-id.mjs") < deploy.indexOf("upload-pages-artifact"), "the fingerprint is written before the site is uploaded");
});

test("every scheduled workflow can also be started by hand", () => {
  const dir = path.join(ROOT, ".github", "workflows");
  for (const f of fs.readdirSync(dir)) {
    const y = fs.readFileSync(path.join(dir, f), "utf8");
    if (/^\s*schedule:/m.test(y)) assert.match(y, /workflow_dispatch/, `${f} is scheduled but cannot be run manually`);
  }
});

test("data files say when the feeds were last checked, and it is not before 'updated'", () => {
  for (const t of ["men", "women"]) {
    const d = JSON.parse(read(`data/usa/${t}.json`));
    assert.ok(d.checked, `${t}.json has no 'checked' time, so the app cannot tell when its information is old`);
    assert.ok(!isNaN(Date.parse(d.checked)), `${t}.json: checked is not a time`);
    assert.ok(Date.parse(d.checked) >= Date.parse(d.updated), `${t}.json: checked is earlier than updated`);
  }
});
