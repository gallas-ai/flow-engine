// Plays the conversation from README.md: npm run example -- verification [yaml|code]
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Flow } from "../../src/index.ts";
import { selectVariants, transcript } from "../shared/transcript.ts";
import { registry } from "./actions.ts";
import { verifyCustomer } from "./flows.ts";
import { nlu } from "./nlu.ts";

const variants: Record<"yaml" | "code", () => Promise<Record<string, Flow>>> = {
  yaml: async () => compileFlows(parse(await readFile(new URL("flows.yaml", import.meta.url), "utf8")), registry),
  code: async () => ({ verify_customer: verifyCustomer }),
};

/** What the customer says; the bot's lines come from the engine. */
const conversations = [
  ["I want to verify myself", "peter@example.com", "paul@example.com"],
  ["I want to verify myself", "office@example.com", "peter@example.com", "jane@example.com"],
];

const selected = selectVariants(["yaml", "code"] as const);
for (const variant of selected) {
  if (selected.length > 1) console.log(`--- ${variant} ---`);
  for (const conversation of conversations) {
    const { customer, bot } = transcript();
    const engine = new FlowEngine({ flows: await variants[variant](), nlu, output: bot });
    for (const text of conversation) {
      customer(text);
      await engine.handle(text);
    }
    console.log();
  }
}
