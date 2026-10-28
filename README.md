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
        return { say: `Refund ${number} created.` };
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

## Flows in YAML

Flows can also be written in YAML, in a subset of [Rasa's flow syntax](https://rasa.com/docs/reference/primitives/flows/).
The file then reads as the support team's process documentation. `compileFlows` turns the parsed data into the same
`Flow` objects you would write in code, so YAML and TS flows can be mixed and linked. The package has no YAML dependency;
parse the file with any library (`yaml`, `js-yaml`), or pass JSON.

```yaml
flows:
  refund:
    name: Refund
    description: The customer wants to return an item that is fine and get the money back.
    persisted_slots: [item] # carried over by the link below
    steps:
      - id: ask_item
        collect: item
        description: the item to return, as the customer named it
      - action: action_resolve_item # your code: sets item_days, or deletes item
        next:
          - if: slots.item is null
            then:
              - action: utter_not_delivered
                next: ask_item
          - if: slots.item_days > 30
            then: too_late
          - else: ask_reason
      - id: ask_reason
        collect: reason
        next:
          - if: slots.reason = "broken"
            then: switch
          - else: confirm
      - id: confirm
        collect: confirm
        ask_before_filling: true # consent is always asked (prefill: false)
        next:
          - if: not slots.confirm
            then: END
          - else: create
      - id: create
        action: action_create_refund
        next: END
      - id: too_late
        action: utter_too_late
        next: END
      - id: switch
        action: utter_switch_to_complaint
      - link: complaint

slots:
  reason:
    type: choice
    options:
      - { value: unwanted, label: I don't want it }
      - { value: broken, label: it's broken }
  confirm: { type: bool }

responses:
  utter_ask_item: What do you want to return?
  utter_ask_confirm: "Returning {item}. Submit?"
  utter_ask_reason: Why are you returning it?
  utter_not_delivered: I can't find that item among your deliveries.
  utter_too_late: Items can be returned within 30 days only.
  utter_switch_to_complaint: A broken item is a complaint – switching.
```

```ts
import { parse } from "yaml";
import { compileFlows, FlowEngine } from "@gallas-ai/flow-engine";

const flows = compileFlows(parse(await readFile("flows.yaml", "utf8")), {
  actions: {
    async action_resolve_item(slots) {
      const item = await shop.findDelivered(slots.item);
      return item ? { setSlots: { item: item.id, item_days: item.daysAgo } } : { setSlots: { item: null } };
    },
    action_create_refund: async (slots) => ({ say: `Refund ${await shop.createRefund(slots.item)} created.` }),
  },
});
const engine = new FlowEngine({ flows: { ...flows, ...codeFlows }, nlu, output });
```

**Steps**: `collect` (with `description`, `ask_before_filling`, `rejections`, `utter`), `action`, `set_slots`, `link` and
`noop`, each with an optional `id` and `next`. `next` is a step id, `END`, or a list of `if` / `then` cases with a final
`else`; `then` / `else` hold a step id or a list of steps. A step without `next` continues with the following step;
the end of a nested list ends the flow.

**Slots** (optional, the default type is `text`): `type` (`text`, `bool`, `number`, `choice`), `options` (a list of values,
a list of `{ value, label }`, or the name of a function in `registry.options`), `help`, `not_available`, `no_options`.

When the choices aren't known in advance (the customer's orders), the slot names a function and the code supplies it.
The engine calls it every time it asks for the slot and offers what it returns:

```yaml
slots:
  order_id:
    type: choice
    options: unshipped_orders # the name of the function below
```

```ts
compileFlows(data, {
  actions: {
    // runs before the order is asked for; options are synchronous, so the data is loaded here
    async action_load_orders(slots) {
      orders = await shop.unshippedOrders(customerId);
    },
  },
  options: {
    unshipped_orders: (slots) => orders.map((order) => ({ value: order.id, label: `${order.id} (${order.summary})` })),
  },
});
```

**Responses**: everything the bot says. `collect: x` asks with `utter_ask_x` (or the step's `utter`), an
`action: utter_*` step says the response, and `{slot}` in a text is replaced with the slot's value. Other `action` names
are looked up in `registry.actions`.

**Conditions**: `slots.<name>`, strings, numbers, `true`, `false`, `null`, `=` `!=` `>` `>=` `<` `<=`, `is null`,
`is not null`, `matches "<regex>"` (searches the value), `not`, `and`, `or` and parentheses. A slot that isn't set is `null`.

`compileFlows` checks every reference and throws with the path to the problem, for example
`flows.refund.steps[1].next[2].else: unknown step "ask_reasn"`. Unknown keys are errors too. Compile your flows in a
test so CI catches typos.

### Differences from Rasa

- **Slots belong to a flow, not to the conversation.** In Rasa, slots are global and `persisted_slots` survive the end of
  a flow. Here every flow starts with empty slots; `persisted_slots` only lists the slots a `link` carries over to the
  linked flow. Once the conversation moves on to an unrelated flow, the values are gone.
- **`ask_before_filling: true`** means the engine always asks for the slot itself: it never takes the value from an
  earlier message, and asks again even for a value that was carried over or answered on an earlier pass.
- **Not supported**: `call`, flow guards (`if` on a flow), `domain.yml` features beyond the slots and responses above,
  response variations and buttons, and conditions beyond the list above.

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
