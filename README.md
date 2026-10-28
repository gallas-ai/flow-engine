# @gallas-ai/flow-engine

A small declarative flow engine for task-oriented conversations. **The LLM understands, the code decides.**

You describe each multi-step task (a return, a complaint, an address change) as a **flow**: the slots it needs and the steps
to walk. The engine walks the steps deterministically. Language understanding is injected through the `Nlu` interface,
so the engine never imports an LLM. It runs just as well with a fake keyword NLU in unit tests.

What it handles for you:

- **Prefill**: slots mentioned in the opening message are filled at once and their questions skipped.
- **Validation**: business rules live in code (`validate`), never in a prompt, and apply to prefilled values too.
- **Options**: choice slots offer only valid values. A single option is picked without asking.
- **Turn types**: an answer, a question about the step, a digression, a task switch, or a cancel.
- **Flow stack**: a task switch parks the current flow and resumes it afterwards.
- **Links**: one flow can hand over to another and carry slot values along.

The engine is language-neutral. Every text it says on its own can be replaced through `messages`.

## Usage

```ts
import { FlowEngine, NO, type Flow, type Nlu } from "@gallas-ai/flow-engine";

const refund: Flow = {
  name: "refund",
  title: "Refund",
  slots: [
    {
      name: "item",
      type: "choice",
      description: "the item to return",
      question: () => "What do you want to return?",
      options: () => [{ value: "mug", label: "Mug" }],
    },
    { name: "confirm", type: "yesno", description: "consent", question: () => "Submit?", prefill: false },
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { kind: "collect", slot: "confirm" },
    { kind: "goto", to: "cancelled", when: (slots) => slots.confirm === NO },
    { kind: "action", run: (slots) => `Refund created for ${slots.item}.` },
    { kind: "end" },
    { id: "cancelled", kind: "say", text: () => "Nothing submitted." },
  ],
};

const engine = new FlowEngine({
  flows: { refund },
  nlu: myNlu, // your implementation of Nlu, usually LLM-backed
  output: (text) => console.log(text),
  onEvent: (event) => console.debug(event), // optional
  messages: { flowCancelled: (title) => `${title} cancelled.` }, // optional overrides
});

await engine.handle("I want to return the mug");
console.log(engine.snapshot()); // the flow stack as data
```

## Steps

| Step | What it does |
|---|---|
| `collect` | Asks for a slot, or skips the step when the slot is already filled |
| `say` | Says a text |
| `action` | Runs code and says its result |
| `goto` | Jumps to the step with the given `id` when the condition holds |
| `link` | Replaces the current flow with another one and carries the listed slots over |
| `end` | Ends the flow; a parked flow below it resumes |

## The `Nlu` interface

```ts
interface Nlu {
  route(text): Promise<string | null>; // which flow does this message start?
  classifyTurn(flowTitle, question, text): Promise<TurnType>; // "answer" | "step_question" | "digression" | "task_switch" | "cancel"
  extract(flow, wanted, slots, text, question?): Promise<Extraction>; // { values, notAmongOptions }
  choose(question, text, options): Promise<string | null>; // value of the picked option
  answer(text, step?): Promise<string>; // free Q&A
}
```

Yes/no slots hold the exported constants `YES` and `NO`. `notAmongOptions` lists the choice slots for which the user named something
that isn't offered. The engine then says the slot's `notAvailable` text and won't auto-select the only option.

## Development

```bash
npm test          # vitest
npm run typecheck
```
