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
| `{ kind: "collect", slot, verify, maxAttempts, onExhausted }` | `verify` is an action run as soon as the slot is filled; when it clears the slot, the value is turned down and the question asked again. After `maxAttempts` turned-down values (by `verify` or `validate`) the flow jumps to `onExhausted` (a step id, END by default). A `verify` that also returns `uncounted: true` asks again without counting the value. See [examples/verification](../examples/verification/README.md) |
| `{ kind: "say", text }` | Says `text(slots)` |
| `{ kind: "action", run }` | Runs your code (sync or async) and waits for it. It returns `{ say?, setSlots? }`: what to say and which slots to store. `null` in `setSlots` clears a slot |
| `{ kind: "set", values }` | Stores fixed values in slots; `null` clears one |
| `{ kind: "goto", to, when }` | Jumps to the step with that `id`, or to `END`, when `when(slots)` holds. Without `when` it always jumps |
| `{ kind: "link", flow, carry, message? }` | Replaces the current flow with another one and takes the slots listed in `carry` along. If that flow is parked, it resumes where it stopped instead of starting again |
| `{ kind: "call", flow }` | Runs another flow with this flow's slots, then continues with the next step. See [Calling a flow](#calling-a-flow) |
| `{ kind: "end" }` | Ends the flow. A flow parked below it resumes |

Any step can have an `id` for `goto` to jump to. The flow also ends after its last step.

When the engine is created, it checks the flows and throws on a broken reference: a step that collects an unknown slot,
a `goto` to an unknown step, a `link` or `call` to an unknown flow, a `call` that can lead back to its own flow, or a
`call` to a flow that uses a `link`.

## Calling a flow

A `call` step runs another flow in the middle of this one. When the called flow ends, this flow continues with the
step after the `call`. Use it for steps that several flows share, such as verifying the customer before anything else:

```ts
const verifyPatient: Flow = {
  name: "verify_patient",
  title: "Patient verification",
  routable: false, // only a call starts it, never the customer's message
  slots: [{ name: "phone", type: "text", description: "the patient's phone number", question: () => "What is your phone number?" }],
  steps: [
    { kind: "collect", slot: "phone", verify: verifyPhone, maxAttempts: 2 }, // verifyPhone sets patient_id
  ],
};

const bookAppointment: Flow = {
  name: "book_appointment",
  title: "Book appointment",
  slots: [{ name: "day", type: "text", description: "the day of the appointment", question: () => "Which day would you like?" }],
  steps: [
    { kind: "call", flow: "verify_patient" },
    { kind: "goto", to: "END", when: (slots) => !("patient_id" in slots) }, // check how the call went
    { kind: "collect", slot: "day" },
    { kind: "action", run: bookDay },
  ],
};
```

How a call behaves:

- **Slots are shared.** The called flow starts with all of the caller's slots. When it ends, all of its slots go back to
  the caller: what it collected, what its actions set, and what it cleared. Slots with the same name are the same
  slot, so give the slots of a flow you call from several places names that don't mean something else in a caller.
- **The caller checks the result.** An `END` in the called flow, including `onExhausted` and a choice slot without
  options, ends only the called flow, and the caller continues. The called flow reports how it went through its slots
  (`patient_id` is set or not), and the caller checks them right after the `call`.
- **One message fills all the flows.** Every message is read once for the open slots of the whole chain: the flow the
  customer started, the flows it called, and the flows it will call later. "Book me in for Friday, my number is
  555-0100" fills both `day` and `phone`, and so does "555-0100, Friday" as the answer to the phone question, even if
  the number then turns out to be wrong. A `prefill: false` step still asks, even when the value is already known.
- **A value for another flow is checked at its own step.** `validate` and `options` run for that value only when the
  flow reaches the slot's `collect` step, so the customer doesn't hear about the day during the verification. A value
  turned down there counts toward `maxAttempts`. `notAvailable` isn't said for another flow's slot.
- **No "Back to…" line.** When the called flow ends, the caller goes on with its next question as if it were its own.
- **Cancel and task switch act on the whole task.** To the customer, the called flow is part of the task they started.
  A cancel inside the called flow cancels its callers too, and `messages.flowCancelled` names the flow the customer
  started ("Book appointment", not "Patient verification"). A task switch parks the called flow together with its
  callers; `messages.flowParked` and `messages.resume` name the started flow, and afterwards the conversation resumes
  at the called flow's question. A task switch to a flow that is already running in the chain ("I want to book an
  appointment" during the booking's verification) doesn't start it again: the bot answers the message and asks the
  waiting question again.
- **Nesting.** A called flow can call another flow, but a flow can't call itself, directly or through other calls: the
  engine throws when it is created.
- **A called flow can't use a `link`.** A `link` ends the flow for good, and a `call` has to come back. The engine
  throws when it is created, even if the call would never reach that `link`. To reuse part of a flow that has a `link`,
  move the shared steps to a flow of their own, call it, and keep the `link` in the caller.

`routable: false` hides a flow from `Nlu.route`, so a customer's message never starts it, only a `call`, a `link` or
`engine.start` from your code. If the NLU returns the flow's name anyway, the engine treats it as no flow and just
answers the message. Use it for flows that make sense only inside another flow, like the verification above.

`onEvent` gets `flowStarted` with `called: true` for a called flow, and `carried` lists the slots it started with.
`engine.snapshot()` marks called frames with `called: true`; the frame below a called frame is its caller.

[examples/appointments](../examples/appointments/README.md) shows two flows calling the same verification.

## A flow runs only once

A task switch or a `link` to a flow that is parked doesn't start a second copy: that flow, with the flows it called,
resumes where it stopped and keeps its slots. On a task switch the current flow is parked in its place, and the message is
read for the resumed flow's open slots. A `link` ends the current flow, and the slots in its `carry` replace the
resumed flow's values. A `call` always runs the called flow, even when it is also parked in another chain.

## Slots for parked flows

A task switch parks the flow that was asking, and when it resumes it goes on from its waiting question. If the other
task collected the same slot, the customer would be asked for it twice. List such a slot in `persistedSlots`:

```ts
const verify: Flow = {
  name: "verify",
  title: "Patient verification",
  routable: false,
  persistedSlots: ["phone"], // a flow parked on this question doesn't ask it again
  slots: [{ name: "phone", type: "text", description: "the patient's phone number", question: () => "What is your phone number?" }],
  steps: [{ kind: "collect", slot: "phone", verify: verifyPhone }],
};
```

- The values go to all parked flows when the flow leaves: at its end, on a cancel and on a `link`. The `persistedSlots`
  of the flows it calls count too, so a task that calls `verify` hands over `phone` without listing it.
- A value replaces an older one in the parked flow. A slot without a value changes nothing.
- The parked `collect` step checks the value like any other: `validate` and `options` apply, and `verify` runs again.
  The steps after it run too, so make sure that an action can run twice and doesn't say the same thing again.
- Clear a value you finally turned down before the flow ends, or it reaches the parked flow.
- A `prefill: false` slot still asks.
- Only parked flows get the values: a flow started later starts with empty slots. A question whose slot nobody
  filled is asked again.
- `persistedSlots` doesn't affect a `link`: what it takes along is its `carry`. In YAML, `persisted_slots` sets both.

[examples/appointments](https://github.com/gallas-ai/flow-engine/tree/main/examples/appointments) shows this.
