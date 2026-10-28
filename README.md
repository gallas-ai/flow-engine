# @gallas-ai/flow-engine

A small declarative flow engine for task-oriented conversations. **The LLM understands, the code decides.**

You describe each multi-step task (a return, a complaint, an address change) as a **flow**: the slots it needs and the steps
to walk. The engine walks the steps deterministically. Language understanding is injected through the `Nlu` interface,
so the engine never imports an LLM. It runs just as well with a fake keyword NLU in unit tests.

What it handles for you:

- **Prefill**: slots mentioned in the opening message are filled at once and their questions skipped.
- **Validation**: business rules live in code (`validate`), never in a prompt, and apply to prefilled values too.
- **Actions**: sync or async code that says something and sets slots the following steps decide on.
- **Options**: choice slots offer only valid values. A single option is picked without asking.
- **Turn types**: an answer, a question about the step, a digression, a task switch, or a cancel.
- **Flow stack**: a task switch parks the current flow and resumes it afterwards.
- **Links**: one flow can hand over to another and carry slot values along.

The engine is language-neutral. Every text it says on its own can be replaced through `messages`.

## Installation

```bash
npm install @gallas-ai/flow-engine
```

The package is ESM-only and requires Node `^22.12.0 || ^24.0.0 || >=26.0.0`.

## Usage

```ts
import { FlowEngine, type Flow, type Nlu } from "@gallas-ai/flow-engine";

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
      options: () => [{ value: "mug", label: "Mug" }],
    },
    { name: "confirm", type: "bool", description: "consent", question: () => "Submit?", prefill: false },
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { kind: "collect", slot: "confirm" },
    { kind: "goto", to: "cancelled", when: (slots) => slots.confirm === false },
    {
      kind: "action",
      run: async (slots) => {
        const number = await shop.createRefund(slots.item); // your code
        return { say: `Refund ${number} created.`, setSlots: { refundNumber: number } };
      },
    },
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
| `action` | Runs (possibly async) code; it returns `{ say?, setSlots? }`, and `null` in `setSlots` deletes a slot |
| `set` | Sets slots to fixed values (`null` deletes) |
| `goto` | Jumps to the step with the given `id`, or to `END`, when `when` holds; without `when` it always jumps |
| `link` | Replaces the current flow with another one and carries the listed slots over |
| `end` | Ends the flow; a parked flow below it resumes |

Slots hold strings (`text`, `choice`), booleans (`bool`) or numbers (`number`). A slot with `prefill: false` is always asked
by the engine itself: it is never taken from an earlier message, and a value it already holds (carried over, set by an
action, or answered on an earlier pass through a loop) is asked again. Use it for consent.

The engine checks the flows when it is created and throws on broken references: an unknown slot, step id or linked flow.

## The `Nlu` interface

```ts
interface Nlu {
  route(text, flows): Promise<string | null>; // which flow does this message start? flows = [{ name, title, description }]
  classifyTurn(flowTitle, question, text): Promise<TurnType>; // "answer" | "step_question" | "digression" | "task_switch" | "cancel"
  extract(flow, wanted, slots, text, question?): Promise<Extraction>; // { values, notAmongOptions }
  choose(question, text, options): Promise<string | null>; // value of the picked option
  answer(text, step?): Promise<string>; // free Q&A
}
```

`extract` returns typed values: `true` / `false` for bool slots, numbers for number slots. `notAmongOptions` lists the choice slots for which the user named something
that isn't offered. The engine then says the slot's `notAvailable` text and won't auto-select the only option.

## Development

Requires Node `^22.12.0 || ^24.0.0 || >=26.0.0` (the versions vitest supports).

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build         # compiles src/ to dist/
npm run check:package # publint + attw on the packed package
```

## Releasing

Releases are published to npm from GitHub Actions when a `v*` tag is pushed:

```bash
npm version minor # or patch; commits and tags
git push --follow-tags
```

The release workflow checks that the tag matches `package.json`, runs the checks, publishes with npm trusted publishing
and creates a GitHub Release. A version that is already on npm is not published again, so a tag for the manually
published `0.1.0`, or a re-run, only creates the GitHub Release. The trusted publisher (`gallas-ai/flow-engine`,
workflow `release.yml`) must be set up on npmjs.com before the first tag push.
