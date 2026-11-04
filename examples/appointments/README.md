# Appointments with a shared patient verification

Booking and cancelling an appointment both start by verifying the patient. The verification is one flow, and both
flows `call` it.

## Run it

From the repository root:

```bash
npm run example -- appointments        # both versions
npm run example -- appointments yaml   # or: code
```

On Node 22.18 or newer, `node examples/appointments/main.ts yaml` works too.

## What it does

```transcript
customer: I'd like to book an appointment
bot:      What is your phone number?                 ← book_appointment called verify_patient
customer: 555-0100
bot:      Thank you, Jane, you are verified.
          Which day would you like?                  ← back in book_appointment, without a "Back to…" line
customer: Tuesday
bot:      Done: you're booked for Tuesday.
customer: Please cancel my appointment
bot:      Your appointment on Tuesday is cancelled.  ← verify_patient found the patient verified already

customer: Book me in for Friday, my number is 555-0199   ← fills day in the booking and phone in the verification
bot:      I couldn't find a patient with this phone number.
          What is your phone number?
customer: forget it
bot:      Understood, "Book appointment" is cancelled.   ← cancels the booking, not only the verification

customer: Book me in
bot:      What is your phone number?
customer: 555-0199, Friday please                    ← one answer, read for both flows
bot:      I couldn't find a patient with this phone number.
          What is your phone number?
customer: 555-0100
bot:      Thank you, Jane, you are verified.
          Done: you're booked for Friday.            ← the day survived the turned-down number
```

The example comes in two versions that behave the same:

| File | What it is |
|---|---|
| [flows.yaml](flows.yaml) | The three flows in YAML |
| [flows.ts](flows.ts) | The same flows written in code |
| [actions.ts](actions.ts) | The patient lookup, the calendar, and the registry `flows.yaml` refers to by name |
| [nlu.ts](nlu.ts) | A fake keyword NLU, so the example runs without an LLM |
| [main.ts](main.ts) | Plays the conversations above |

What the example uses:

| Feature | What it does |
|---|---|
| `call: verify_patient` | Runs the verification, then continues with the next step of the calling flow |
| Shared slots | The verification starts with the caller's slots, and all its slots go back to the caller when it ends: here `patient_id` and `patient_name`, which its action set |
| One read of a message | An answer during the verification also fills the booking's `day`, even when the verification turns the number down |
| Checking after the call | An `END` in the verification ends only the verification. The caller checks `patient_id` and ends itself when it isn't set |
| `if: False` | Hides `verify_patient` from routing: "verify me" never starts it on its own, only a `call` does |
| Cancel | "forget it" during the verification cancels the booking: the customer started the booking, not the verification |

## YAML

[flows.yaml](flows.yaml):

```yaml
flows:
  verify_patient:
    name: Patient verification
    description: Finds the patient by phone number before anything is done with their appointments.
    if: False # hidden from routing: only a `call` starts it
    steps:
      - action: action_recall_patient # code: sets patient_id when this conversation verified the patient already
        next:
          - if: slots.patient_id is not null
            then: END
          - else: ask_phone
      - id: ask_phone
        collect: phone
        description: the patient's phone number
        verify: action_verify_phone # code: finds the patient, or clears phone
        max_attempts: 2
        on_exhausted:
          - action: utter_verification_failed
            next: END
      - action: utter_verified

  book_appointment:
    name: Book appointment
    description: The patient wants to book an appointment.
    steps:
      - call: verify_patient # comes back with the verification's slots: patient_id, patient_name
        next:
          - if: slots.patient_id is null # verification failed – END in the called flow ends only the called flow
            then: END
          - else: ask_day
      - id: ask_day
        collect: day
        description: the day of the appointment, Monday to Friday
      - action: action_book_appointment

  cancel_appointment:
    name: Cancel appointment
    description: The patient wants to cancel an appointment they booked.
    steps:
      - call: verify_patient
        next:
          - if: slots.patient_id is null
            then: END
          - else: cancel
      - id: cancel
        action: action_cancel_appointment

responses:
  utter_ask_phone: What is your phone number?
  utter_verified: Thank you, {patient_name}, you are verified.
  utter_verification_failed: Sorry, I couldn't verify you. Please call the front desk.
  utter_ask_day: Which day would you like?
```

`compileFlows` and `new FlowEngine` check the calls when the flows load. Any `if` other than `if: False` fails, and so
do a call to an unknown flow and a call that can lead back to its own flow, e.g.
`Flow verify_patient: calls cancel_appointment, which leads back to verify_patient`.

### Remembering the verified patient

Slots end with their flow, so after the booking ends, `cancel_appointment` starts without `patient_id`. The
conversation remembers the verified patient in code instead: [actions.ts](actions.ts) keeps it in the actions of one
conversation, and `action_recall_patient`, the first step of the verification, sets `patient_id` from it. The
verification then ends at once, and the cancel goes ahead without a question:

```ts
export function createActions(): Actions {
  let verified: Patient | undefined; // kept for the whole conversation, outside the slots of any flow
  const patientSlots = (patient: Patient) => ({ setSlots: { patient_id: patient.id, patient_name: patient.name } });
  return {
    recallPatient: () => (verified ? patientSlots(verified) : undefined),
    verifyPhone: (slots) => {
      const patient = patients[String(slots.phone)];
      if (!patient) return { say: "I couldn't find a patient with this phone number.", setSlots: { phone: null } };
      verified = patient;
      return patientSlots(patient);
    },
    // …
  };
}
```

Create the actions, the flows and the engine once per conversation, as [main.ts](main.ts) does.

## Code

[flows.ts](flows.ts) is the same three flows in TypeScript, with the same actions:

```ts
const verifyPatient: Flow = {
  name: "verify_patient",
  title: "Patient verification",
  description: "Finds the patient by phone number before anything is done with their appointments.",
  routable: false, // like `if: False`: only a `call` starts it
  slots: [{ name: "phone", type: "text", description: "the patient's phone number", question: () => "What is your phone number?" }],
  steps: [
    { kind: "action", run: actions.recallPatient },
    { kind: "goto", to: END, when: (slots) => "patient_id" in slots },
    { kind: "collect", slot: "phone", verify: actions.verifyPhone, maxAttempts: 2, onExhausted: "failed" },
    { kind: "say", text: (slots) => `Thank you, ${slots.patient_name}, you are verified.` },
    { kind: "end" },
    { id: "failed", kind: "say", text: () => "Sorry, I couldn't verify you. Please call the front desk." },
  ],
};

const bookAppointment: Flow = {
  name: "book_appointment",
  title: "Book appointment",
  description: "The patient wants to book an appointment.",
  slots: [{ name: "day", type: "text", description: "the day of the appointment, Monday to Friday", question: () => "Which day would you like?" }],
  steps: [
    { kind: "call", flow: "verify_patient" }, // comes back with the verification's slots: patient_id, patient_name
    { kind: "goto", to: END, when: (slots) => !("patient_id" in slots) }, // verification failed
    { kind: "collect", slot: "day" },
    { kind: "action", run: actions.bookAppointment },
  ],
};
```

How the YAML keys map to code:

| YAML | Code |
|---|---|
| `call: verify_patient` | `{ kind: "call", flow: "verify_patient" }` |
| `if: False` on a flow | `routable: false` on the flow |
| `next:` with `if: slots.patient_id is null` after the call | `{ kind: "goto", to: END, when: (slots) => !("patient_id" in slots) }` |

## Compared with writing the verification into each flow

Without `call`, both flows start with their own copy of the verification steps: the same `collect`, `verify`,
`max_attempts` and `on_exhausted`, and the same responses. A change to the verification, such as three attempts
instead of two, has to be made in every copy. With `call`, the verification is one flow, and each caller only decides
what to do with the result.

[test/examples.test.ts](../../test/examples.test.ts) tests both versions of this example.
