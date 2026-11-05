# Customer verification with limited attempts

The bot asks for an e-mail address, verifies it in the CRM, and ends the flow when that fails twice.

## Run it

From the repository root:

```bash
npm run example -- verification        # both versions
npm run example -- verification yaml   # or: code
```

On Node 22.18 or newer, `node examples/verification/main.ts yaml` works too.

To see each message as a trace in MLflow, start the local OpenTelemetry Collector and MLflow, then run the example with
`OTEL_EXPORTER_OTLP_ENDPOINT` set:

```bash
docker compose -f observability/compose.yaml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run example -- verification
```

Then open <http://localhost:5050>, the **Default** experiment and its **Traces** tab. More in
[Tracing](../../docs/tracing.md#try-it-locally-with-mlflow).

## What it does

```transcript
customer: I want to verify myself
bot:      What is your e-mail address?
customer: peter@example.com
bot:      I couldn't verify this e-mail address.     ← verify cleared email = 1st failed attempt
          What is your e-mail address?
customer: paul@example.com
bot:      I couldn't verify this e-mail address.     ← 2nd failed attempt = max_attempts
          Sorry, I couldn't verify you. Please contact our support.   ← on_exhausted

customer: I want to verify myself
bot:      What is your e-mail address?
customer: office@example.com
bot:      Several customers share this e-mail address. Please give me your own.   ← uncounted: not an attempt
          What is your e-mail address?
customer: peter@example.com
bot:      I couldn't verify this e-mail address.     ← only the 1st failed attempt
          What is your e-mail address?
customer: jane@example.com
bot:      Thank you, Jane, you are verified.
```

The example comes in two versions that behave the same:

| File | What it is |
|---|---|
| [flows.yaml](flows.yaml) | The flow in YAML |
| [flows.ts](flows.ts) | The same flow written in code |
| [actions.ts](actions.ts) | The e-mail check both versions use, and the registry `flows.yaml` refers to by name |
| [nlu.ts](nlu.ts) | A fake keyword NLU, so the example runs without an LLM |
| [main.ts](main.ts) | Plays the conversation above |

All of it is one `collect` step with three keys:

| Key | What it does |
|---|---|
| `verify` | An action run as soon as the slot is filled, also when the value came in the first message. When the action clears the slot (`email: null`), the attempt failed and the question is asked again |
| `max_attempts` | How many failed attempts the step accepts. Both values cleared by `verify` and answers rejected by `rejections` count |
| `on_exhausted` | Where the flow goes after the last attempt: a step id or a list of steps, like `then`. Without it the flow ends |

An answer the engine didn't understand doesn't count as an attempt; the `notUnderstood` and `stillNotUnderstood`
messages still handle that. Neither do digressions or questions about the step.

The action decides about one more case: a value it turns down with `uncounted: true` doesn't count either. Use it when
the customer only has to be more precise, like the shared mailbox here.

## YAML

[flows.yaml](flows.yaml):

```yaml
flows:
  verify_customer:
    name: Customer verification
    description: The customer needs to verify themselves by e-mail, e.g. before we tell them the status of an order.
    steps:
      - collect: email
        description: the customer's e-mail address
        rejections: # a malformed address counts as an attempt, just like an unknown one
          - if: not (slots.email matches "@")
            utter: utter_email_invalid
        verify: action_verify_email # code: finds the customer in the CRM, or clears email
        max_attempts: 2
        on_exhausted:
          - action: utter_verification_failed
            next: END
      - action: utter_verified

responses:
  utter_ask_email: What is your e-mail address?
  utter_email_invalid: That doesn't look like an e-mail address.
  utter_verification_failed: Sorry, I couldn't verify you. Please contact our support.
  utter_verified: Thank you, {customer_name}, you are verified.
```

The action ([actions.ts](actions.ts)) only verifies. It doesn't count attempts or decide where the flow goes:

```ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Action, type ActionResult } from "@gallas-ai/flow-engine";

const verifyEmail: Action = async (slots): Promise<ActionResult> => {
  if (await crm.isSharedEmail(slots.email)) {
    // cleared and uncounted = ask again, not a failed attempt
    return { say: "Several customers share this e-mail address. Please give me your own.", setSlots: { email: null }, uncounted: true };
  }
  const name = await crm.findCustomerName(slots.email);
  return name
    ? { setSlots: { customer_name: name } } // email stays set = verified
    : { say: "I couldn't verify this e-mail address.", setSlots: { email: null } }; // cleared = failed attempt
};

const flows = compileFlows(parse(await readFile("flows.yaml", "utf8")), {
  actions: { action_verify_email: verifyEmail },
});
const engine = new FlowEngine({ flows, nlu: myNlu, output: (text) => console.log(text) });
```

`compileFlows` checks the new keys too. An unknown action in `verify`, `max_attempts: 0`, `on_exhausted` without
`max_attempts`, or a jump to a step that doesn't exist fails the load with the exact path, e.g.
`flows.verify_customer.steps[0].on_exhausted: unknown step "fail"`.

## Code

[flows.ts](flows.ts) is the same flow in TypeScript, with the same `verifyEmail` action:

```ts
import { FlowEngine, type Flow } from "@gallas-ai/flow-engine";
import { verifyEmail } from "./actions.ts";

const verifyCustomer: Flow = {
  name: "verify_customer",
  title: "Customer verification",
  description: "The customer needs to verify themselves by e-mail, e.g. before we tell them the status of an order.",
  slots: [
    {
      name: "email",
      type: "text",
      description: "the customer's e-mail address",
      question: () => "What is your e-mail address?",
      validate: (value) => (String(value).includes("@") ? null : "That doesn't look like an e-mail address."),
    },
  ],
  steps: [
    { kind: "collect", slot: "email", verify: verifyEmail, maxAttempts: 2, onExhausted: "failed" },
    { kind: "say", text: (slots) => `Thank you, ${slots.customer_name}, you are verified.` },
    { kind: "end" },
    { id: "failed", kind: "say", text: () => "Sorry, I couldn't verify you. Please contact our support." },
  ],
};

const engine = new FlowEngine({ flows: { verify_customer: verifyCustomer }, nlu: myNlu, output: (text) => console.log(text) });
```

How the YAML keys map to code:

| YAML | Code |
|---|---|
| `verify: action_verify_email` | `verify: verifyEmail`, the function itself instead of its name |
| `max_attempts: 2` | `maxAttempts: 2` |
| `on_exhausted:` with a list of steps | `onExhausted: "failed"`, the id of a step placed after an `{ kind: "end" }` |
| `rejections` on the collect step | `validate` on the slot |
| `responses` (`utter_ask_email`, …) | `question` on the slot and `say` steps |

`new FlowEngine` checks the code version when it is created: `maxAttempts` must be a whole number of at least 1,
`onExhausted` needs `maxAttempts` and must name an existing step.

## Compared with a flow without `verify`

Without the new keys, the same scenario is a hand-written loop. The action has to count attempts and clear the slot
itself, the limit hides in a condition, and the jump back is manual:

```yaml
steps:
  - id: ask_email
    collect: email
  - action: action_verify_email # verifies, increments email_attempts, clears email
    next:
      - if: slots.verified
        then: verified
      - if: slots.email_attempts >= 2 # a typo in the name isn't caught → endless loop
        then:
          - action: utter_verification_failed
            next: END
      - else:
          - action: utter_email_not_found
            next: ask_email # without email: null in the action, collect is skipped → endless loop
  - id: verified
    action: utter_verified
```

| | Hand-written loop | `verify` + `max_attempts` |
|---|---|---|
| Where the "at most 2×" rule lives | A counter in code, the limit in a YAML condition | One key on the question it belongs to |
| What the action does | Verifies, counts, clears the slot, sets `verified` | Verifies. On failure it clears the slot and says why |
| Checks when the flows load | A typo in the counter's name passes | `max_attempts` and `on_exhausted` targets are checked |
| Order of conditions | Must be "verified → limit → again" | No conditions |
| Reuse (OTP, PIN, …) | The whole loop again | The same three keys |

The hand-written loop still works. Use it when you need something the new keys can't do, such as a different text on
each attempt.

[test/examples.test.ts](../../test/examples.test.ts) tests both versions of this example.
