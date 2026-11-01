// node scripts/changelog.ts release: turns `## [Unreleased]` in CHANGELOG.md into the version in package.json (npm's
// `version` lifecycle runs it after the bump). node scripts/changelog.ts notes <tag>: prints that version's section.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../CHANGELOG.md", import.meta.url);
const lines = readFileSync(file, "utf8").split("\n");

function fail(message: string): never {
  console.error(`CHANGELOG.md: ${message}`);
  process.exit(1);
}

/** The lines of the section under the heading at `start`, up to the next heading or the link definitions. */
function section(start: number): string[] {
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("## ") && !/^\[[^\]]+\]: /.test(lines[end]!)) end++;
  return lines.slice(start + 1, end);
}

const heading = (version: string) => lines.findIndex((line) => line.startsWith(`## [${version}]`));

const [command, arg] = process.argv.slice(2);

if (command === "release") {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  if (heading(version) !== -1) fail(`${version} already has a section`);
  const unreleased = heading("Unreleased");
  if (unreleased === -1) fail("no `## [Unreleased]` section");
  if (section(unreleased).join("").trim() === "") fail(`\`## [Unreleased]\` is empty – add the changes in ${version} first`);

  const link = lines.findIndex((line) => /^\[Unreleased\]: .+\/compare\/\S+\.\.\.HEAD$/.test(line));
  if (link === -1) fail("no `[Unreleased]: …/compare/<previous tag>...HEAD` link");
  const [, base, previous] = /^\[Unreleased\]: (.+)\/compare\/(\S+)\.\.\.HEAD$/.exec(lines[link]!)!;

  const date = new Date().toISOString().slice(0, 10);
  lines.splice(link, 1, `[Unreleased]: ${base}/compare/v${version}...HEAD`, `[${version}]: ${base}/compare/${previous}...v${version}`);
  lines.splice(unreleased, 1, "## [Unreleased]", "", `## [${version}] - ${date}`);
  writeFileSync(file, lines.join("\n"));
} else if (command === "notes" && arg) {
  const version = arg.replace(/^v/, "");
  const start = heading(version);
  if (start === -1) fail(`no section for ${version}`);
  const notes = section(start).join("\n").trim();
  if (notes === "") fail(`the section for ${version} is empty`);
  console.log(notes);
} else {
  fail("usage: node scripts/changelog.ts release | notes <tag>");
}
