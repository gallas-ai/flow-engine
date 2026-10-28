# @gallas-ai/flow-engine

A small declarative flow engine for task-oriented conversations. **The LLM understands, the code decides.**

You describe each multi-step task (a return, a complaint, an address change) as a **flow**: the information it needs
and the steps to walk. The engine walks the steps deterministically. The LLM is only asked what the customer said – it
never decides what happens next. Language understanding is injected through the `Nlu` interface, so the engine never
imports an LLM, and it runs just as well with a fake keyword NLU in unit tests.

What it handles for you:

- **Prefill**: what the customer mentions in the first message is used at once, and those questions are skipped.
- **Validation**: business rules live in code, never in a prompt, and apply to prefilled values too.
- **Actions**: your code (sync or async) looks things up, says something and stores results the next steps decide on.
- **Options**: choice questions offer only valid values. A single option is picked without asking.
- **Turn types**: an answer, a question about the step, a digression, a task switch, or a cancel.
- **Flow stack**: a task switch parks the current flow and resumes it afterwards.
- **Links**: one flow can hand over to another and carry values along.
- **YAML**: flows can be written as YAML that reads like the support team's process documentation.

The engine is language-neutral. Every text it says on its own can be replaced.

## Installation

```bash
npm install @gallas-ai/flow-engine
```

The package is ESM-only and requires Node `^22.12.0 || ^24.0.0 || >=26.0.0`.

## How it works

A **flow** is one task. It has **slots** – the pieces of information it needs, like the item to return or the customer's
consent – and **steps**: ask for a slot, run some code, branch, hand over to another flow.

For every customer message the engine asks the NLU (usually an LLM) narrow questions: which flow does this message start?
Is it an answer to the question we asked, or something else? Which slot values does it contain? Then the engine decides
what to do next by following the steps.

```
customer: I want to return the mug         ← NLU: starts "refund", item = "mug"
bot:      Return the mug?                   ← the item question is skipped, the engine asks for consent
customer: wait, what is your return policy?  ← NLU: a digression
bot:      You can return items within 30 days.
          Back to Refund: Return the mug?   ← the engine returns to the waiting question
customer: yes
bot:      Refund R-1042 created.            ← your code ran
```

## Flows in code

```ts
import { FlowEngine, type Flow } from "@gallas-ai/flow-engine";

const refund: Flow = {
  name: "refund",
  title: "Refund",
  description: "The customer wants to return an item that is fine and get the money back.",
  slots: [
    { name: "item", type: "text", description: "the item to return", question: () => "What do you want to return?" },
    { name: "confirm", type: "bool", description: "consent", question: (slots) => `Return the ${slots.item}?`, prefill: false },
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { kind: "collect", slot: "confirm" },
    { kind: "goto", to: "END", when: (slots) => slots.confirm === false },
    { kind: "action", run: async (slots) => ({ say: `Refund ${await shop.createRefund(slots.item)} created.` }) },
  ],
};

const engine = new FlowEngine({ flows: { refund }, nlu: myNlu, output: (text) => console.log(text) });
await engine.handle("I want to return the mug");
```

`shop` is your code, `myNlu` your [NLU implementation](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md).

## Flows in YAML

The same flow as process documentation, in a subset of Rasa's flow syntax. Code is referenced by name:

```yaml
flows:
  refund:
    name: Refund
    description: The customer wants to return an item that is fine and get the money back.
    steps:
      - collect: item
        description: the item to return
      - collect: confirm
        ask_before_filling: true
        next:
          - if: not slots.confirm
            then: END
          - else: create
      - id: create
        action: action_create_refund

slots:
  confirm: { type: bool }

responses:
  utter_ask_item: What do you want to return?
  utter_ask_confirm: "Return the {item}?"
```

```ts
const flows = compileFlows(parse(await readFile("flows.yaml", "utf8")), {
  actions: { 
    action_create_refund: async (slots) => ({ say: `Refund ${await shop.createRefund(slots.item)} created.` }) 
  },
});
```

YAML and code flows produce the same `Flow` objects and can be mixed.

## Documentation

- [Flows in code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md) – slots, steps, actions
- [Flows in YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md) – steps, branching, conditions, responses, differences from Rasa
- [Connecting an LLM](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md) – the `Nlu` interface and engine options

## Development

```bash
npm install
npm test              # vitest
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
