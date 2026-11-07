// Plays the conversation from README.md: npm run example -- table-reservation [yaml|code]
// Two instances of the REST API sit behind a round-robin load balancer, so every message reaches the other instance.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, type Flow } from "../../src/index.ts";
import { selectVariants, transcript } from "../shared/transcript.ts";
import { reserveTable } from "./flows.ts";
import { startLoadBalancer } from "./load-balancer.ts";
import { startServer } from "./server.ts";
import { ConversationStore } from "./store.ts";

const variants: Record<"yaml" | "code", () => Promise<Record<string, Flow>>> = {
  yaml: async () => compileFlows(parse(await readFile(new URL("flows.yaml", import.meta.url), "utf8")), {}),
  code: async () => ({ reserve_table: reserveTable }),
};

/** What the customer says; the bot's lines come from whichever instance the load balancer picked. */
const conversation = ["I'd like to reserve a table", "12 of us", "4", "Friday", "19:30", "yes"];

const selected = selectVariants(["yaml", "code"] as const);
for (const variant of selected) {
  if (selected.length > 1) console.log(`--- ${variant} ---`);
  const flows = await variants[variant]();
  const store = new ConversationStore(); // the one thing the instances share
  const servers = [await startServer("a", flows, store), await startServer("b", flows, store)];
  const balancer = await startLoadBalancer(servers);

  const { customer, bot } = transcript();
  for (const message of conversation) {
    customer(message);
    const response = await fetch(`${balancer.url}/webhooks/rest/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender: `${variant}-customer`, message }),
    });
    const instance = response.headers.get("x-served-by");
    for (const { text } of (await response.json()) as { text: string }[]) bot(text, `bot (${instance})`);
  }
  console.log();

  await balancer.close();
  for (const server of servers) await server.close();
}
