# Called flows share the caller's slots

Status: accepted

Every flow normally starts with empty slots, and a `link` carries over only the slots listed in `persisted_slots`. A
`call` is different on purpose: the called flow starts with all of the caller's slots, and when it ends, all its slots
go back to the caller, including the ones it set or cleared. This is what makes a reusable flow such as patient
verification useful: it hands back a slot (`patient_id`) that an action set, which a list of declared slots couldn't
express, because a YAML flow declares only the slots it collects. It also matches Rasa's `call`, so YAML needs no extra
syntax.

## Considered options

- **Explicit lists of slots passed in and taken back.** Precise, but Rasa has no such syntax, and every call would
  repeat the called flow's interface.
- **Only take back the slots the caller doesn't hold yet.** Hides a called flow clearing a slot, e.g. verification
  turning down an e-mail address the caller already had.

## Consequences

- Two flows that use the same slot name for different things clash when one calls the other. Slot names in reusable
  flows must be chosen with that in mind.
- `END` inside a called flow ends only the called flow; the caller learns how it went from the slots (e.g. `patient_id`
  is not set) and must check them.
