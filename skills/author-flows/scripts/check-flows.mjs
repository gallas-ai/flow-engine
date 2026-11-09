#!/usr/bin/env node
// Compiles a flows YAML file before any action is written: every action and options name resolves to a stub,
// and the names used are listed so they can be compared with the list for developers.
// Plain JavaScript, because Node doesn't strip types under node_modules.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compileFlows } from "../../../dist/index.js";

const file = process.argv[2];

const recording = (names, stub) =>
  new Proxy({}, { get: (_, name) => (typeof name === "string" ? (names.add(name), stub) : undefined) });

function yamlParser() {
  try {
    return createRequire(join(process.cwd(), "package.json"))("yaml").parse;
  } catch {
    throw new Error('This project has no "yaml" package. Install it with: npm i -D yaml');
  }
}

try {
  const parse = yamlParser();
  const actions = new Set();
  const options = new Set();
  const flows = compileFlows(parse(readFileSync(file, "utf8")), {
    actions: recording(actions, async () => ({})),
    options: recording(options, () => []),
  });

  console.log(`${file} compiles: ${Object.keys(flows).join(", ")}`);
  console.log(`actions: ${[...actions].join(", ")}`);
  console.log(`options: ${[...options].join(", ")}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
