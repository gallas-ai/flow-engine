# Persisted slots reach the parked flows

Status: accepted

A customer waiting on "Which e-mail?" can switch to another task that verifies them with the same called flow. When
that task is over, the parked flow asks the same question again, because its earlier steps don't run again and the
answer ended with the other flow. So the slots a flow lists in `persisted_slots` now go to the parked flows when it
leaves the conversation, and a parked `collect` whose slot got a value doesn't ask. This is Rasa's way: a pending
`collect` checks its slot again on resume, and `persisted_slots` keeps the value from being reset. It needs no new YAML
syntax. Without `persisted_slots`, Rasa asks again too.

## Considered options

- **A new key that runs a check action on resume.** It would avoid running the rest of the flow again, but Rasa has
  nothing like it, and it runs actions the author wrote to run once.
- **Slots shared by the whole conversation, as in Rasa.** The most faithful, but it ends "every flow starts with empty
  slots", which existing flows rely on.
- **Skipping `verify` for a value handed over.** The slots `verify` sets would then be missing in the parked flow. They
  would have to be persisted too, and Rasa accepts only slots used in `collect` or `set_slots` steps in `persisted_slots`.

## Consequences

- The parked flow's `verify` and the steps after it run again, so they must tolerate a second run. A flow must clear a
  value it finally turned down before it ends, or the value reaches the parked flow.
- Slots go over however the flow leaves: at its end, on a `cancel` and on a `link`. A flow counts the `persisted_slots`
  of the flows it calls too, as in Rasa.
- All parked flows get a value, and it replaces an older one. A slot without a value changes nothing, unlike in Rasa:
  the flow started with empty slots, so an empty slot says it didn't touch that slot, not that it cleared it.
- The parked flow's `collect` step checks the value like one read for another flow, because it may have other rules for
  the same slot name. A `prefill: false` slot still asks.
- Only parked flows get the values; a flow started later still starts empty.
- A question whose slot nobody filled is asked again. A task that makes the question pointless in another way has to set
  that slot.
- `persisted_slots` in YAML now means two things: what a `link` carries and what the parked flows get. In code they stay
  separate: `link.carry` and `Flow.persistedSlots`. Names aren't checked as in Rasa, because a `link` may carry a slot an
  action set.
