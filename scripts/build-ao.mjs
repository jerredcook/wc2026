// Builds ao.html, AO Central New Jersey's matchday app, from index.html.
// It is the Cap Day hub with AO naming plus two cards from js/ao.js:
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

// Search engines may list this page. It is nearly the same file as index.html, so it
// names its own address (canonical) and spells the chapter out in the title and description.
const TITLE = "AO Matchday — American Outlaws Central New Jersey";
swapRe(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`);
// Cap Day is retired for now: index.html sends its visitors here. This page must not send them on again.
swapRe(/<script>\/\* Cap Day is retired for now[^\n]*<\/script>\n/, "");
swap(`https://jerredcook.github.io/wc2026/og-image.png`, `https://jerredcook.github.io/wc2026/ao-og.png`);
swapRe(/<meta name="description" content="[^"]*">/, `<meta name="description" content="American Outlaws Central New Jersey's matchday app: when the USA plays next, how to watch, and the watch party at every AO chapter in the country.">`);
swapRe(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${TITLE}">`);
swapRe(/<meta property="og:site_name" content="[^"]*">/, `<meta property="og:site_name" content="AO Matchday">`);
swapRe(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="The matchday app of AO Central New Jersey.">`);
swapRe(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="https://jerredcook.github.io/wc2026/ao.html">`);
swap(`<link rel="manifest" href="manifest.webmanifest">`, `<link rel="manifest" href="ao.webmanifest">`);
// The app's picture is the chapter's own crest (the harp), not Cap Day's cap.
swap(`<link rel="icon" href="icon-192.png">`, `<link rel="icon" href="ao-icon-192.png">`);
swap(`<link rel="apple-touch-icon" href="apple-touch-icon.png">`, `<link rel="apple-touch-icon" href="ao-touch-icon.png">`);
swap(`<meta name="apple-mobile-web-app-title" content="Cap Day">`, `<meta name="apple-mobile-web-app-title" content="AO Matchday">`);

swap(`</style>`, `
/* ── AO Matchday ── */
.aoband{background:#0b2a5b;color:#fff;border-radius:14px;padding:14px 16px;margin-bottom:14px;border-bottom:4px solid #c8102e}
.aoband .w{font-size:20px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;line-height:1.1}
.aoband .t{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ffb3bd;margin-top:3px}
.aoband p{font-size:12px;line-height:1.45;color:#d3daea;margin-top:8px}
.aocard{border-top:4px solid var(--red)}
.aohome{display:flex;gap:12px;align-items:flex-start;background:var(--chip);border-radius:12px;padding:12px;margin-top:10px;flex-wrap:wrap}
.aoacts{display:flex;gap:8px;flex:1 0 100%}
.aoacts .btn{background:var(--card);flex:1 1 0;text-align:center;padding:9px 10px}
.aonear{font-size:12.5px;font-weight:700;color:var(--good);margin-top:4px}
.aonotes{flex:1 0 100%;background:var(--card);border-left:3px solid var(--red);border-radius:8px;padding:8px 10px}
.aonote{font-size:13.5px;line-height:1.4;margin-top:3px;overflow-wrap:anywhere}
.aosong{border-bottom:1px solid var(--line)}
.aosong:last-child{border-bottom:0}
.aosong>summary{margin:0;min-height:44px;display:flex;align-items:center;font-size:14px;font-weight:700;color:var(--ink)}
.aosong>summary::before{margin-right:6px}
.aowords{white-space:pre-line;font-size:14px;line-height:1.55;padding:0 0 12px 18px;overflow-wrap:anywhere}
.aocard>details>summary{min-height:32px;display:flex;align-items:center}
.aocard>details>summary::before{margin-right:5px}
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
.aost{display:inline-block;font-size:10.5px;font-weight:800;border-radius:5px;padding:1px 6px;vertical-align:1px;white-space:nowrap}
.aost.ok{background:var(--goodbg);color:var(--good)}
.aost.rb{background:var(--warnbg);color:var(--warn)}
.aost.un{background:var(--chip);color:var(--ink2)}
a.btn{display:inline-block;text-decoration:none;color:var(--ink)}
.aohome .chip{background:var(--card)}
.aoq{display:block;width:100%;margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:16px;background:var(--card);color:var(--ink)}
</style>`);

swapRe(/<h1>[^<]*<\/h1>\s*<p class="sub"[^>]*>[\s\S]*?<\/p>/,
  `<h1>AO Matchday</h1>
      <p class="sub" style="margin-bottom:0">American Outlaws &middot; U.S. women's &amp; men's national teams</p>`);
swap(`<div class="nextup" id="nextup"></div>`, `<div class="aoband">
    <div class="w" id="aoBandW">AO Central New Jersey</div>
    <div class="t">American Outlaws &middot; Unite &amp; Strengthen</div>
    <p id="aoBandP">The matchday app of AO Central New Jersey. Built by a chapter member; not a product of American Outlaws national.</p>
  </div>
  <div class="nextup" id="nextup"></div>`);
/* The watch party sits inside the match zone, above the match card: picking a team scrolls to the top of that zone. */
swap(`<div id="match"><div id="hero"></div></div>`, `<div id="match"><div id="aoWatch"></div><div id="hero"></div></div>\n  <div id="aoChapters"></div>`);
swap(`<span class="appname">Cap Day</span>`, `<span class="appname">AO Matchday</span>`);
swap(`<p>Scan to open Cap Day<br>jerredcook.github.io/wc2026</p>`, `<p>Scan to open AO Matchday<br>jerredcook.github.io/wc2026/ao.html</p>\n  <p style="margin-top:8px"><a href="ao-sign.html">Print a sign for the bar</a></p>`);
swap(`<img src="qr.svg" alt="QR code for this page"`, `<img src="ao-qr.svg" alt="QR code for this page"`);
swap(`Unofficial and fan-made — not affiliated with or endorsed by U.S. Soccer, Concacaf or FIFA.`,
  `The matchday app of AO Central New Jersey, built by a chapter member. Not a product of American Outlaws national, and not affiliated with or endorsed by U.S. Soccer, Concacaf or FIFA. American Outlaws chapter and watch party listings are copied from theamericanoutlaws.com.`);
swapRe(/(<script data-goatcounter[^>]*><\/script>)/, `$1\n<script src="js/ao.js"></script>`);
/* Wording a visitor sees or shares: the page's own name, not Cap Day's. */
swap(`<b>Add Cap Day to your iPhone.</b>`, `<b>Add AO Matchday to your iPhone.</b>`);
swap(`<b>A newer version of Cap Day is ready.</b>`, `<b>A newer version of AO Matchday is ready.</b>`);
swap(`<dialog id="qr" aria-label="QR code for Cap Day">`, `<dialog id="qr" aria-label="QR code for AO Matchday">`);
swap(`navigator.share({ title: "Cap Day", text, url })`, `navigator.share({ title: "AO Matchday", text, url })`);
swap(`Would you use Cap Day to follow the national teams?`, `Would you use AO Matchday to follow the national teams?`);
swap(`$("ver").textContent = "Cap Day v" + VERSION;`, `$("ver").textContent = "AO Matchday v" + VERSION;`);
/* Anything left that names Cap Day (the footer link before the script fills it, the share-link note, the calendar file's maker). */
html = html.split("Cap Day").join("AO Matchday");

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
