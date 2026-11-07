// Reserving a table, written in code: the same flow as flows.yaml.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Flow } from "../../src/index.ts";

const TIMES = ["18:00", "19:30", "21:00"];

export const reserveTable: Flow = {
  name: "reserve_table",
  title: "Table reservation",
  description: "The customer wants to reserve a table in the restaurant.",
  slots: [
    {
      name: "guests",
      type: "number",
      description: "how many people are coming",
      question: () => "For how many people?",
      validate: (value) => (Number(value) > 8 ? "We seat at most 8 people at one table." : null), // like `rejections`
    },
    { name: "day", type: "text", description: "the day of the reservation", question: () => "Which day?" },
    {
      name: "time",
      type: "choice",
      description: "the time of the reservation",
      question: () => "What time?",
      options: () => TIMES.map((time) => ({ value: time, label: time })),
    },
    {
      name: "confirm",
      type: "bool",
      description: "whether the customer confirms the reservation",
      question: (slots) => `A table for ${slots.guests} on ${slots.day} at ${slots.time}. Shall I reserve it?`,
      prefill: false, // like `ask_before_filling: true`
    },
  ],
  steps: [
    { kind: "collect", slot: "guests" },
    { kind: "collect", slot: "day" },
    { kind: "collect", slot: "time" },
    { kind: "collect", slot: "confirm" },
    { kind: "goto", to: "not_reserved", when: (slots) => !slots.confirm },
    { kind: "say", text: (slots) => `Reserved. See you on ${slots.day} at ${slots.time}!` },
    { kind: "end" },
    { id: "not_reserved", kind: "say", text: () => "All right, nothing is reserved." },
  ],
};
