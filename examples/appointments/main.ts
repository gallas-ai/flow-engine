// Plays the conversations from README.md: npm run example -- appointments [yaml|code]
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Flow } from "../../src/index.ts";
import { selectVariants, transcript } from "../shared/transcript.ts";
import { createActions, registry, type Actions } from "./actions.ts";
import { createFlows } from "./flows.ts";
import { nlu } from "./nlu.ts";

const variants: Record<"yaml" | "code", (actions: Actions) => Promise<Record<string, Flow>>> = {
  yaml: async (actions) => compileFlows(parse(await readFile(new URL("flows.yaml", import.meta.url), "utf8")), registry(actions)),
  code: async (actions) => createFlows(actions),
};

/** What the customer says; the bot's lines come from the engine. */
const conversations = [
  ["I'd like to book an appointment", "555-0100", "Tuesday", "Please cancel my appointment"],
  ["Book me in for Friday, my number is 555-0199", "forget it"],
  ["Book me in", "555-0199, Friday please", "555-0100"],
];

const selected = selectVariants(["yaml", "code"] as const);
for (const variant of selected) {
  if (selected.length > 1) console.log(`--- ${variant} ---`);
  for (const conversation of conversations) {
    const { customer, bot } = transcript();
    // fresh actions for every conversation: they remember who was verified in it
    const engine = new FlowEngine({ flows: await variants[variant](createActions()), nlu, output: bot });
    for (const text of conversation) {
      customer(text);
      await engine.handle(text);
    }
    console.log();
  }
}
