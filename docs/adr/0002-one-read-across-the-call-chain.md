# A message is read once, for the whole call chain

Status: accepted

A customer answering a called flow's question often adds what the caller needs too: "I'm Jane Doe, on Tuesday at 10".
The engine reads each message once, looking for the open slots of the whole call chain and of the flows those flows
call, even the ones that haven't started. Values for another flow's slots wait in the shared slots until that flow gets
to them. This is how Rasa treats a `call`: its command generator gets one list of slots with the calls resolved, and
its docs say the slots of a child flow can be filled upfront.

## Considered options

- **Read the message again when the called flow ends.** Smaller change, but a value is lost whenever the called flow
  doesn't end on that message (verification turns the name down, and the time said with it is gone). It also costs a
  second NLU call, and that call looks for the caller's slots without seeing the called flow's, so a name like "April"
  is more easily taken for a date.
- **Check a value as soon as it is read.** The customer would hear "we're closed on Tuesdays" in the middle of the
  verification, and options can depend on slots the called flow hasn't set yet (`patient_id`). So only the flow that
  is asking checks at once; a value for another flow is checked when that flow's `collect` step is reached, like Rasa's
  `rejections`.

## Consequences

- `Nlu.extract` receives slots of several flows, and `flow` is the flow the customer started: a prompt saying "Task:
  Patient verification" would make no sense next to the booking's slots.
- A slot is looked for when any flow in reach may take it early, even if another flow has `prefill: false` for it. That
  is safe, because a `prefill: false` step clears the value and asks. With the same slot in several flows, the NLU sees
  the description from the nearest flow that may take it; Rasa shows them all.
- For a slot of another flow, "the customer named something not among the options" is not reported: no `notAvailable`
  line and no `noAutoSelect`. The question comes when its step is reached.
- A `link` is not followed when looking for slots, as in Rasa: a linked flow takes only the carried slots.
