// Returns and complaints, written in code: the same flows as flows.yaml, built for one language.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Flow, SlotDefinition } from "../../src/index.ts";
import type { Language } from "./languages.ts";
import { texts } from "./texts.ts";

export function createFlows(language: Language): Record<string, Flow> {
  const t = texts[language];
  const orderNumber: SlotDefinition = {
    name: "order_number",
    type: "text",
    description: "the order number, e.g. 10234",
    question: () => t.askOrderNumber,
  };
  const refund: Flow = {
    name: "refund",
    title: "Refund",
    description: "The customer wants to return an item that is fine and get the money back.",
    slots: [orderNumber],
    steps: [
      { kind: "collect", slot: "order_number" },
      { kind: "say", text: t.refundStarted },
    ],
  };
  const complaint: Flow = {
    name: "complaint",
    title: "Complaint",
    description: "The customer reports a broken or damaged item.",
    slots: [orderNumber],
    steps: [
      { kind: "collect", slot: "order_number" },
      { kind: "say", text: t.complaintOpened },
    ],
  };
  return { refund, complaint };
}
