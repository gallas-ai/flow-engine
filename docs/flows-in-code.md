# Flows in code

A flow written in TypeScript: the slots it needs and the steps to walk.

```ts
import { FlowEngine, type Flow } from "@gallas-ai/flow-engine";

const refund: Flow = {
  name: "refund",
  title: "Refund",
  description: "The customer wants to return an item that is fine and get the money back.",
  slots: [
    {
      name: "item",
      type: "choice",
      description: "the item to return",
      question: () => "What do you want to return?",
      options: () => [
        { value: "mug", label: "Mug" },
        { value: "teapot", label: "Teapot" },
      ],
    },
    {
      name: "confirm",
      type: "bool",
      description: "consent to submit the refund",
      question: (slots) => `Return the ${slots.item}?`,
      prefill: false, // consent is always asked
    },
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { kind: "collect", slot: "confirm" },
    { kind: "goto", to: "cancelled", when: (slots) => slots.confirm === false },
    {
      kind: "action",
      run: async (slots) => {
        const number = await shop.createRefund(slots.item); // your code
        return { say: `Refund ${number} created.` };
      },
    },
    { kind: "end" },
    { id: "cancelled", kind: "say", text: () => "Nothing submitted." },
  ],
};

const engine = new FlowEngine({
  flows: { refund },
  nlu: myNlu, // your implementation of Nlu, see below
  output: (text) => console.log(text), // everything the bot says
});

await engine.handle("I want to return the mug");
```

## Slots

| Field | Meaning |
|---|---|
| `name` | How steps and conditions refer to the slot |
| `type` | `text` (a string), `bool` (`true` / `false`), `number`, or `choice` (the `value` of one of `options`) |
| `description` | What the value means. The NLU reads it to find the value in a message, so write it as you would explain it to a new colleague |
| `question(slots)` | What the bot asks. It gets the slots collected so far, so it can mention them |
| `options(slots)` | For `choice` slots: what the customer can pick from, as `{ value, label }`. Called every time the question is asked |
| `validate(value, slots)` | A business rule. Returns `null` when the value is fine, or a text saying why it isn't; the question is then asked again |
| `help` | Background for the answer when the customer asks why the bot needs this |
| `notAvailable` | Said when the customer names something that isn't among the options |
| `noOptions` | Said when there is nothing to offer; the flow then ends |
| `prefill` | `false` = the bot always asks itself. The value is never taken from an earlier message, and asked again even when it is already known. Use it for consent |

## Steps

| Step | What it does |
|---|---|
| `{ kind: "collect", slot }` | Asks for the slot. Skipped when the slot is already known, e.g. from the first message |
| `{ kind: "say", text }` | Says `text(slots)` |
| `{ kind: "action", run }` | Runs your code (sync or async) and waits for it. It returns `{ say?, setSlots? }`: what to say and which slots to store. `null` in `setSlots` clears a slot |
| `{ kind: "set", values }` | Stores fixed values in slots; `null` clears one |
| `{ kind: "goto", to, when }` | Jumps to the step with that `id`, or to `END`, when `when(slots)` holds. Without `when` it always jumps |
| `{ kind: "link", flow, carry, message? }` | Replaces the current flow with another one and takes the slots listed in `carry` along |
| `{ kind: "end" }` | Ends the flow. A flow parked below it resumes |

Any step can have an `id` for `goto` to jump to. The flow also ends after its last step.

When the engine is created, it checks the flows and throws on a broken reference: a step that collects an unknown slot,
a `goto` to an unknown step, or a `link` to an unknown flow.
