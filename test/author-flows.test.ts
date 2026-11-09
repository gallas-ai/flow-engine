import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const installedPackage = "node_modules/@gallas-ai/flow-engine";

const validFlows = `
flows:
  refund:
    name: Refund
    description: The customer wants their money back.
    steps:
      - collect: order_id
        verify: action_verify_order
      - action: action_create_refund
slots:
  order_id:
    type: choice
    options: open_orders
responses:
  utter_ask_order_id: Which order?
`;

let sandbox: string;
let builtDist: string;

/** A project with the package installed the way npm installs it, optionally with the `yaml` parser next to it. */
function createProject(name: string, { withYaml }: { withYaml: boolean }) {
  const project = join(sandbox, name);
  const packageDir = join(project, installedPackage);
  mkdirSync(packageDir, { recursive: true });
  cpSync(builtDist, join(packageDir, "dist"), { recursive: true });
  cpSync(join(root, "skills"), join(packageDir, "skills"), { recursive: true });
  cpSync(join(root, "package.json"), join(packageDir, "package.json"));
  if (withYaml) symlinkSync(join(root, "node_modules/yaml"), join(project, "node_modules/yaml"));
  return project;
}

async function checkFlows(project: string, source: string) {
  writeFileSync(join(project, "flows.yaml"), source);
  const script = `${installedPackage}/skills/author-flows/scripts/check-flows.mjs`;
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [script, "flows.yaml"], { cwd: project });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), "author-flows-"));
  builtDist = join(sandbox, "dist");
  await promisify(execFile)(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.build.json", "--outDir", builtDist], { cwd: root });
}, 60_000);

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("check-flows", () => {
  it("accepts flows whose actions aren't written yet and lists the code they need", async () => {
    const project = createProject("valid", { withYaml: true });

    const result = await checkFlows(project, validFlows);

    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("flows.yaml compiles: refund");
    expect(result.stdout).toContain("actions: action_verify_order, action_create_refund");
    expect(result.stdout).toContain("options: open_orders");
  });

  it("reports a mistake on one line, with the exact spot", async () => {
    const project = createProject("broken", { withYaml: true });

    const result = await checkFlows(project, validFlows.replace("      - action: action_create_refund", "      - action: utter_missing"));

    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe('flows.refund.steps[1].action: unknown response "utter_missing" – add it to responses');
  });

  it("says how to get the YAML parser when the project doesn't have one", async () => {
    const project = createProject("no-parser", { withYaml: false });

    const result = await checkFlows(project, validFlows);

    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe('This project has no "yaml" package. Install it with: npm i -D yaml');
  });
});

describe("the npm package", () => {
  it("ships the skill and the docs it reads", async () => {
    const { stdout } = await promisify(execFile)("npm", ["pack", "--dry-run", "--json"], { cwd: root });
    const packed = (JSON.parse(stdout) as { files: { path: string }[] }[])[0]!.files.map((file) => file.path);

    expect(packed).toEqual(
      expect.arrayContaining([
        "skills/author-flows/SKILL.md",
        "skills/author-flows/brief-template.md",
        "skills/author-flows/brief-to-yaml.md",
        "skills/author-flows/scripts/check-flows.mjs",
        "docs/yaml.md",
      ]),
    );
  });
});

describe("the skill", () => {
  const read = (file: string) => readFileSync(join(root, "skills/author-flows", file), "utf8");

  it("has the frontmatter agents need to find it", () => {
    const frontmatter = parse(read("SKILL.md").match(/^---\n([\s\S]*?)\n---/)![1]!) as Record<string, unknown>;

    expect(frontmatter.name).toBe("author-flows");
    expect(frontmatter.description).toEqual(expect.any(String));
    expect((frontmatter.description as string).length).toBeLessThanOrEqual(1024);
    expect(frontmatter).not.toHaveProperty("disable-model-invocation");
  });

  it.each(["SKILL.md", "brief-to-yaml.md"])("%s only points at files the package has", (file) => {
    const paths = [...read(file).matchAll(/node_modules\/@gallas-ai\/flow-engine\/([\w./-]*\w)/g)].map(([, path]) => path!);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(existsSync(join(root, path)), path).toBe(true);
  });
});
