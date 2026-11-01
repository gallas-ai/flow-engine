// npm run example -- <example> [yaml|code]: plays examples/<example>/main.ts.
import { existsSync, readdirSync } from "node:fs";

const examples = readdirSync(new URL("..", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "shared")
  .map((entry) => entry.name);

const [name] = process.argv.splice(2, 1);
const main = new URL(`../${name}/main.ts`, import.meta.url);
if (!name || !examples.includes(name) || !existsSync(main)) {
  console.error(`Usage: npm run example -- <example> [yaml|code]\nExamples: ${examples.join(", ")}`);
  process.exit(1);
}
await import(main.href);
