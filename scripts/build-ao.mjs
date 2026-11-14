// Builds ao.html, the American Outlaws concept page, from index.html.
// The concept is the Cap Day hub with AO naming plus two cards from js/ao.js:
// "Watch with American Outlaws" and "Find your crew". Rerun after changing index.html:
//   node scripts/build-ao.mjs
// The tests fail until you do (they run it with --check).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const swap = (from, to) => {
  if (!html.includes(from)) throw new Error("build-ao: index.html no longer contains: " + from.slice(0, 80));
  html = html.split(from).join(to);
};
const swapRe = (re, to) => {
  if (!re.test(html)) throw new Error("build-ao: index.html no longer matches " + re);
  html = html.replace(re, to);
};

const TITLE = "AO Matchday (concept) — American Outlaws";
swapRe(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>\n<meta name="robots" content="noindex,nofollow">`);
swapRe(/<meta name="description" content="[^"]*">/, `<meta name="description" content="Concept app for American Outlaws: next match, how to watch, and the nearest AO watch party.">`);
swapRe(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${TITLE}">`);
swapRe(/<meta property="og:site_name" content="[^"]*">/, `<meta property="og:site_name" content="AO Matchday">`);
swapRe(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="Concept app for American Outlaws.">`);
swapRe(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="https://jerredcook.github.io/wc2026/ao.html">`);
swap(`<link rel="manifest" href="manifest.webmanifest">`, `<link rel="manifest" href="ao.webmanifest">`);
swap(`<meta name="apple-mobile-web-app-title" content="Cap Day">`, `<meta name="apple-mobile-web-app-title" content="AO Matchday">`);

swap(`</style>`, `
/* ── AO concept ── */
.aoband{background:#0b2a5b;color:#fff;border-radius:14px;padding:14px 16px;margin-bottom:14px;border-bottom:4px solid #c8102e}
.aoband .w{font-size:20px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;line-height:1.1}
.aoband .t{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ffb3bd;margin-top:3px}
.aoband p{font-size:12px;line-height:1.45;color:#d3daea;margin-top:8px}
.aocard{border-top:4px solid var(--red)}
.aohome{display:flex;gap:12px;align-items:flex-start;background:var(--chip);border-radius:12px;padding:12px;margin-top:6px}
.aor{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.aor:last-of-type{border-bottom:0}
.crest{flex:0 0 40px;width:40px;height:40px;object-fit:contain;border-radius:8px}
.aohome .crest{flex-basis:56px;width:56px;height:56px}
.crest.ph{display:flex;align-items:center;justify-content:center;background:#0b2a5b;color:#fff;font-size:12px;font-weight:900;letter-spacing:.05em}
.aot{flex:1;min-width:0;font-size:13px;line-height:1.35}
.aot b{display:block;font-weight:700}
.aot small{display:block;color:var(--ink3);font-size:12px}
.aon{font-size:13.5px;font-weight:800;margin-bottom:2px}
.aon.big{font-size:16px}
.aod{flex:0 0 auto;text-align:right;font-size:12px;font-weight:700;color:var(--ink2);display:flex;flex-direction:column;gap:4px}
.aod a,.aol a{font-weight:600;text-decoration:none}
.aol{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;font-size:12px}
.st{display:inline-block;font-size:10.5px;font-weight:800;border-radius:5px;padding:1px 6px;vertical-align:1px;white-space:nowrap}
.st.ok{background:var(--goodbg);color:var(--good)}
.st.rb{background:var(--warnbg);color:var(--warn)}
.st.un{background:var(--chip);color:var(--ink2)}
a.btn{display:inline-block;text-decoration:none;color:var(--ink)}
.aohome .chip{background:var(--card)}
.aoq{display:block;width:100%;margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:16px;background:var(--card);color:var(--ink)}
</style>`);

swapRe(/<h1>[^<]*<\/h1>\s*<p class="sub"[^>]*>[\s\S]*?<\/p>/,
  `<h1>AO Matchday</h1>
      <p class="sub" style="margin-bottom:0">American Outlaws &middot; U.S. women's &amp; men's national teams</p>`);
swap(`<div class="nextup" id="nextup"></div>`, `<div class="aoband">
    <div class="w">American Outlaws</div>
    <div class="t">Unite &amp; Strengthen</div>
    <p>A concept for an AO app, built by Jerred Cook of AO Central New Jersey on top of his Cap Day app. It is not an official American Outlaws product.</p>
  </div>
  <div class="nextup" id="nextup"></div>`);
swap(`<div id="hero"></div>`, `<div id="aoWatch"></div>\n  <div id="hero"></div>\n  <div id="aoChapters"></div>`);
swap(`<p>Scan to open Cap Day<br>jerredcook.github.io/wc2026</p>`, `<p>Scan to open AO Matchday<br>jerredcook.github.io/wc2026/ao.html</p>`);
swap(`<img src="qr.svg" alt="QR code for this page"`, `<img src="ao-qr.svg" alt="QR code for this page"`);
swap(`Unofficial and fan-made — not affiliated with or endorsed by U.S. Soccer, Concacaf or FIFA.`,
  `Concept build. Not an official American Outlaws app, and not affiliated with or endorsed by U.S. Soccer, Concacaf or FIFA. American Outlaws chapter and watch party listings are copied from theamericanoutlaws.com.`);
swapRe(/(<script data-goatcounter[^>]*><\/script>)/, `$1\n<script src="js/ao.js"></script>`);
/* Wording a visitor sees or shares: the page's own name, not Cap Day's. */
swap(`<b>Add Cap Day to your iPhone.</b>`, `<b>Add AO Matchday to your iPhone.</b>`);
swap(`<b>A newer version of Cap Day is ready.</b>`, `<b>A newer version of AO Matchday is ready.</b>`);
swap(`<dialog id="qr" aria-label="QR code for Cap Day">`, `<dialog id="qr" aria-label="QR code for AO Matchday">`);
swap(`navigator.share({ title: "Cap Day", text, url })`, `navigator.share({ title: "AO Matchday", text, url })`);
swap(`Would you use Cap Day to follow the national teams?`, `Would you use AO Matchday to follow the national teams?`);
swap(`$("ver").textContent = "Cap Day v" + VERSION;`, `$("ver").textContent = "AO Matchday concept, built on Cap Day v" + VERSION;`);

const out = "<!-- Generated from index.html by scripts/build-ao.mjs. Do not edit by hand. -->\n" + html;
/* --check writes nothing: it fails when ao.html is behind index.html (the tests run it). */
if (process.argv.includes("--check")) {
  let have = "";
  try { have = fs.readFileSync(path.join(root, "ao.html"), "utf8"); } catch (e) {}
  if (have !== out) { console.error("ao.html is behind index.html: run node scripts/build-ao.mjs"); process.exit(1); }
} else {
  fs.writeFileSync(path.join(root, "ao.html"), out);
  console.log("wrote ao.html");
}
