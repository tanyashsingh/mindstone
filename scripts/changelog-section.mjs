// Prints the CHANGELOG.md section for a version (used as GitHub release notes).
// Usage: node scripts/changelog-section.mjs 0.4.0
import fs from "node:fs";

const version = process.argv[2];
if (!version) { console.error("usage: changelog-section.mjs <version>"); process.exit(2); }
const lines = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
if (start < 0) { console.error(`CHANGELOG.md has no "## ${version}" section`); process.exit(1); }
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end < 0) end = lines.length;
process.stdout.write(lines.slice(start + 1, end).join("\n").trim() + "\n");
