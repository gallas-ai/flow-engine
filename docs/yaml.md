# Flows in YAML

Flows can also be written in YAML, in a subset of [Rasa's flow syntax](https://rasa.com/docs/reference/primitives/flows/).
A YAML file contains no code – it reads as the support team's process documentation, and anything that needs data or
logic is referenced by name and written in code.

The YAML below is a refund flow: it checks that the item was delivered and is less than 30 days old,
and a broken item is handed over to a complaint.

```yaml
flows:
  refund:
    name: Refund
    description: The customer wants to return an item that is fine and get the money back.
    persisted_slots: [item] # the complaint gets the item, so it doesn't ask again
    steps:
      - id: ask_item
        collect: item
        description: the item to return, as the customer named it
      - action: action_resolve_item # code: finds the delivery, stores item_days, or clears item
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
        ask_before_filling: true # consent is always asked
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
  utter_ask_reason: Why are you returning it?
  utter_ask_confirm: "Return the {item}?"
  utter_not_delivered: I can't find that item among your deliveries.
  utter_too_late: Items can be returned within 30 days only.
  utter_switch_to_complaint: A broken item is a complaint – switching.
```

The file has three parts: `flows` with the steps, `slots` for slots that need more than free text, and `responses` with
everything the bot says.

To use it, parse the file and pass it to `compileFlows` together with the code it refers to by name. The package doesn't
depend on a YAML library – use any (`yaml`, `js-yaml`), or pass JSON:

```ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine } from "@gallas-ai/flow-engine";

const yamlFlows = compileFlows(parse(await readFile("flows.yaml", "utf8")), {
  actions: {
    // `action: action_resolve_item` in the YAML
    async action_resolve_item(slots) {
      const item = await shop.findDelivered(slots.item);
      return item ? { setSlots: { item: item.id, item_days: item.daysAgo } } : { setSlots: { item: null } };
    },
    // `action: action_create_refund`
    async action_create_refund(slots) {
      return { say: `Refund ${await shop.createRefund(slots.item)} created.` };
    },
  },
});

const engine = new FlowEngine({
  flows: { ...yamlFlows, complaint }, // `link: complaint` hands over to a flow written in code
  nlu: myNlu,
  output: (text) => console.log(text),
});
```

## Steps

| Step | What it does | Example |
|---|---|---|
| `collect` | Asks for a slot. Skipped when the slot is already known, e.g. from the first message | `collect: item` |
| `action` | A name starting with `utter_` says that text from `responses`. Any other name runs your code from `actions` | `action: action_create_refund` |
| `set_slots` | Stores values in slots without asking; `null` clears one | `set_slots: [item: null]` |
| `link` | Hands the conversation over to another flow, with the flow's `persisted_slots`. It must be the last step of its list | `link: complaint` |
| `call` | Runs another flow with this flow's slots, then continues with the next step. See [Calling a flow](#calling-a-flow) | `call: verify_patient` |
| `noop` | Does nothing; it only exists to branch with `next` | `noop: true` |

Any step can have an `id`, so that other steps can jump to it, and a `next`, which says where to go afterwards.

A `collect` step can also have:

- `description` – what the slot means; the NLU reads it. Defaults to the slot name.
- `ask_before_filling: true` – the bot always asks itself, like [`prefill: false`](flows-in-code.md#slots) in code. Use it for consent.
- `rejections` – values to turn down, each with a text that says why. The question is then asked again:
  ```yaml
  - collect: address
    rejections:
      - if: not (slots.address matches "[0-9]")
        utter: utter_address_needs_number
  ```
- `utter` – a different question than the default `utter_ask_<slot>`.
- `verify` – an action that checks the value as soon as the slot is filled, also from the first message. An action that
  clears the slot (`email: null`) turns the value down, and the question is asked again.
- `max_attempts` – how many turned-down values the step accepts: those cleared by `verify` and answers rejected by
  `rejections`. Answers the engine didn't understand don't count.
- `on_exhausted` – where the flow goes after `max_attempts` turned-down values: a step id or a list of steps, like `then`.
  Without it the flow ends.
  ```yaml
  - collect: email
    verify: action_verify_email # code: looks the customer up, or clears email
    max_attempts: 2
    on_exhausted:
      - action: utter_verification_failed
        next: END
  ```
  The whole scenario is in [examples/verification](../examples/verification/README.md).

## Calling a flow

A `call` step runs another flow in the middle of this one; when the called flow ends, this flow continues after the
`call`. Several flows can share steps this way, e.g. verifying the patient:

```yaml
flows:
  verify_patient:
    name: Patient verification
    if: False # only a call starts this flow, never the customer's message
    steps:
      - collect: phone
        verify: action_verify_phone # sets patient_id, or clears phone
        max_attempts: 2

  book_appointment:
    name: Book appointment
    steps:
      - call: verify_patient
        next:
          - if: slots.patient_id is null # the verification failed
            then: END
          - else: ask_day
      - id: ask_day
        collect: day
      - action: action_book_appointment
```

- The called flow starts with all of the caller's slots, and when it ends, all of its slots go back to the caller,
  including the ones it cleared. A slot name means the same slot in both flows.
- `END` in the called flow, including `on_exhausted`, ends only the called flow. The caller learns from the slots how
  the call went, so check them right after the `call`, as above.
- Every message is read once for the open slots of the flow the customer started, the flows it called and the flows it
  will call later. "555-0100, Friday" as the answer to the phone question also fills the booking's `day`. `rejections`
  of another flow's slot run when that flow reaches its `collect` step, as in Rasa.
- Cancelling inside a called flow cancels the flow the customer started, and a task switch parks both flows.
- A called flow can call another flow, but a flow can't lead back to itself through calls.
- A called flow can't use a `link`, as in Rasa: a `link` ends the flow for good, and a `call` has to come back. To reuse
  part of a flow that has a `link`, move the shared steps to a flow of their own, call it, and keep the `link` in the
  caller.

[Flows in code](flows-in-code.md#calling-a-flow) describes all of it in detail, and
[examples/appointments](../examples/appointments/README.md) shows it in use.

### `if: False`

`if: False` on a flow hides it from routing: `Nlu.route` never sees it, so a customer's message never starts it. Only a
`call` or a `link` does. Use it for flows that make sense only inside another flow. It is the only flow guard
supported: any other value of `if` fails when the flows compile. In code it is [`routable: false`](flows-in-code.md#calling-a-flow).

## Slots for parked flows

A task switch parks the flow that was asking, and when it resumes it goes on from its waiting question. If the other
task collected the same slot, the customer would be asked for it twice. List such a slot in `persisted_slots`:

```yaml
flows:
  verify_patient:
    if: False
    persisted_slots: [phone] # a flow parked on this question doesn't ask it again
    steps:
      - collect: phone
        verify: action_verify_phone
```

- The values go to all parked flows when the flow leaves: at its end, on a cancel and on a `link`. The `persisted_slots`
  of the flows it calls count too, so a task that calls `verify_patient` hands over `phone` without listing it.
- A value replaces an older one in the parked flow. A slot without a value changes nothing.
- The parked `collect` step checks the value like any other: `rejections` and options apply, and `verify` runs again.
  The steps after it run too, so make sure that an action can run twice and doesn't say the same thing again.
- Clear a value you finally turned down before the flow ends, or it reaches the parked flow. A `verify` that keeps a
  failed value needs a `set_slots` step clearing it.
- `ask_before_filling: true` still asks.
- Only parked flows get the values: a flow started later starts with empty slots. A question whose slot nobody
  filled is asked again.

[examples/appointments](https://github.com/gallas-ai/flow-engine/tree/main/examples/appointments) shows this. Why it
works this way: [ADR 0003](adr/0003-persisted-slots-reach-parked-flows.md). In code it is
[`persistedSlots`](flows-in-code.md#slots-for-parked-flows).

## Where the flow goes next

Without `next`, the flow continues with the step below. `next` changes that:

```yaml
next: ask_item          # jump to the step with id ask_item
next: END               # end the flow
next:                   # decide by the slots
  - if: slots.item_days > 30
    then: too_late      # jump to a step…
  - if: slots.item is null
    then:               # …or run these steps
      - action: utter_not_delivered
        next: ask_item
  - else: ask_reason    # when no condition holds
```

Steps listed under `then` or `else` run one after another. When they finish without a `next`, the flow ends.

## Conditions

Conditions in `if` and `rejections` read the slots:

| Condition | Holds when |
|---|---|
| `slots.reason = "broken"` | the slot has this value (`!=` for the opposite) |
| `slots.item_days > 30` | the number is greater (also `>=`, `<`, `<=`) |
| `slots.item is null` | the slot isn't set (`is not null` for the opposite) |
| `slots.confirm` | the slot is set and isn't `false`, `0` or empty |
| `slots.address matches "[0-9]"` | the text contains a match of the regular expression |
| `not …`, `… and …`, `… or …`, `( … )` | combine the above |

## Slots

A slot doesn't have to be declared: a slot that isn't in `slots` holds free text. Declare it when it needs more:

| Key | Meaning |
|---|---|
| `type` | `text` (the default), `bool` (yes / no), `number`, or `choice` (one of `options`) |
| `options` | What a `choice` slot can be: a list of values, a list of `{ value, label }`, or the name of a function (below) |
| `help` | Background for the answer when the customer asks why the bot needs it |
| `not_available` | Said when the customer names something that isn't among the options |
| `no_options` | Said when there is nothing to offer; the flow then ends |

When the choices aren't known in advance, such as the customer's orders, the slot names a function instead of a list.
The engine calls it every time it asks for the slot and offers what it returns. The function is synchronous, so load the
data in an action that runs before the question:

```yaml
slots:
  order_id:
    type: choice
    options: unshipped_orders
```

```ts
let orders: Order[] = [];

compileFlows(data, {
  actions: {
    async action_load_orders() {
      orders = await shop.unshippedOrders(customerId);
    },
  },
  options: {
    unshipped_orders: () => orders.map((order) => ({ value: order.id, label: `${order.id} (${order.summary})` })),
  },
});
```

## Texts

Everything the bot says lives in `responses`:

- `collect: item` asks with `utter_ask_item`.
- `action: utter_too_late` says `utter_too_late`.
- `{item}` in a text is replaced with the value of the `item` slot.

## Mistakes are caught when the flows load

YAML has no type checker, so `compileFlows` checks every name: step ids, actions, responses, options functions, conditions
and keys. A mistake throws with the exact spot, e.g. `flows.refund.steps[1].next[2].else: unknown step "ask_reasn"`.
Compile your flows in a test, and CI catches typos before a customer does.

## Differences from Rasa

- **Slots belong to a flow, not to the conversation.** In Rasa, slots are shared by all flows and `persisted_slots`
  survive the end of a flow. Here every flow starts with empty slots, and `persisted_slots` only lists the slots a `link`
  carries over to the linked flow and the slots that go to [parked flows](#slots-for-parked-flows). Once the conversation
  moves on to an unrelated flow, the values are gone. A `call` is the exception: the called flow shares the caller's
  slots while it runs, and hands them all back when it ends.
- **`persisted_slots` accepts any slot.** Rasa accepts only slots used in `collect` or `set_slots` steps, because it
  doesn't reset the ones an action set. Here a slot an action set ends with its flow unless it is listed.
- **Flow guards**: only `if: False` is supported. It hides the flow from routing, so that only a `call` or a `link`
  starts it. Guards with conditions, such as `if: slots.verified`, aren't supported.
- **Cancel inside a called flow** cancels the flow the customer started, together with the flows it called.
- **`ask_before_filling: true`** means the bot always asks itself: it never takes the value from an earlier message, and
  asks again even for a value that was carried over or answered on an earlier pass.
- **The same slot in several flows**: when a called flow and its caller collect the same slot with different
  `description`s, the NLU sees only the one from the nearest flow that may fill it early, not all of them.
- **Correcting a slot**: a slot that is already filled is not looked for again, so "actually, on Wednesday" doesn't change
  it.
- **Not supported**: flow guards other than `if: False`, `domain.yml` features beyond the slots and responses above,
  response variations and buttons, and conditions beyond the table above.
