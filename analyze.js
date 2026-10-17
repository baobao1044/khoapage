#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = process.argv[2] || "StealAnEggs_deobfuscated.luau";
const text = fs.readFileSync(path, "utf8");

const findAll = (re) => {
  const out = [];
  let m;
  const re2 = new RegExp(re.source, "g");
  while ((m = re2.exec(text))) out.push(m[1]);
  return out;
};

const lines = text.split("\n").length;

const report = [];
report.push("== Night Hub / Steal An Egg Luau analysis ==");
report.push(`file: ${path}`);
report.push(`lines: ${lines}`);
report.push("");

const servers = [...new Set(text.match(/https?:\/\/[^\s"']+/g) || [])];
report.push("[+] Network servers/URLs seen:");
for (const s of servers) report.push(`    ${s}`);
report.push("");

const authCount = (text.match(/"\/auth"/g) || []).length;
report.push(`[+] Auth endpoint references: ${authCount}`);
report.push("");

const game = findAll(/Game\s*=\s*"([^"]+)"/, text);
const build = findAll(/Build\s*=\s*"([^"]+)"/, text);
const name = findAll(/Name\s*=\s*"([^"]+)"/, text);
report.push(`[+] Target: name=${JSON.stringify(name)} game=${JSON.stringify(game)} build=${JSON.stringify(build)}`);
report.push("");

const globals = [...new Set(text.match(/genv\.([A-Za-z0-9_]+)\s*=/g))].map(
  (m) => m.match(/genv\.([A-Za-z0-9_]+)/)[1]
).sort();
report.push(`[+] Globals written: ${JSON.stringify(globals)}`);
report.push("");

const featureKeywords = [
  "farm", "fly", "hop", "hatch", "sell", "carry", "drop", "plant",
  "wearegg", "doffegg", "beginhatch", "finishhatch", "teleport",
  "blink", "weave", "pace", "walkspeed", "speedpower", "autohop",
  "autosell", "claim", "ripe",
];
const low = text.toLowerCase();
const found = featureKeywords.filter((kw) => low.includes(kw));
report.push(`[+] Cheat feature keywords present: ${JSON.stringify(found.sort())}`);
report.push("");

const deps = [];
for (const kw of ["gethwid", "crypt.hash", "crypt.hmac", "httpservice", "request_",
                  "syn.request", "teleportservice", "game:httpget"]) {
  if (low.includes(kw)) deps.push(kw);
}
report.push(`[+] Dependencies/APIs used: ${JSON.stringify(deps)}`);
report.push("");

report.push("[+] Key format validation (validateLicenseKey):");
report.push("    32 chars alnum  OR  44 chars 'NightHubPro-...'  OR  21 chars 'NightHub_...'");
report.push("");

console.log(report.join("\n"));
