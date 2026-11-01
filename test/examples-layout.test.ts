import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const examples = readdirSync(new URL("examples/", root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "shared")
  .map((entry) => entry.name);

/** `npm run example`, run with this Node directly so the test doesn't depend on npm. */
const [node, ...args] = JSON.parse(read("package.json")).scripts.example.split(" ");

async function play(example: string, variant: string) {
  const { stdout } = await promisify(execFile)(node === "node" ? process.execPath : node, [...args, example, variant], {
    cwd: root,
  });
  return stdout;
}

/** The ```transcript blocks of a README, without the `← …` notes, separated by an empty line like main.ts prints them. */
function transcripts(readme: string) {
  const blocks = [...readme.matchAll(/^```transcript\n([\s\S]*?)^```/gm)].map(([, block]) =>
    block!.split("\n").map((line) => line.replace(/\s*←.*$/, "").trimEnd()).join("\n"),
  );
  return blocks.join("\n");
}

it("finds the examples", () => {
  expect(examples).toContain("verification");
});

describe.each(examples)("examples/%s", (example) => {
  it("has a README, both versions of the flow and a main.ts", () => {
    for (const file of ["README.md", "flows.ts", "flows.yaml", "main.ts"]) {
      expect(existsSync(new URL(`examples/${example}/${file}`, root)), file).toBe(true);
    }
  });

  it("shows how to run it first, in a `## Run it` section right after the intro", () => {
    const readme = read(`examples/${example}/README.md`);
    const firstSection = readme.match(/^## .*$/m)?.[0];
    expect(firstSection).toBe("## Run it");
    const runSection = readme.split(/^## /m)[1]!;
    expect(runSection).toContain(`npm run example -- ${example}`);
  });

  it("is linked from the main README", () => {
    expect(read("README.md")).toContain(`https://github.com/gallas-ai/flow-engine/tree/main/examples/${example}`);
  });

  it.each(["yaml", "code"])("plays the transcript from its README in %s", async (variant) => {
    const expected = transcripts(read(`examples/${example}/README.md`));
    expect(expected, "README.md needs a ```transcript block").not.toBe("");
    expect(await play(example, variant)).toBe(`${expected}\n`);
  });
});
