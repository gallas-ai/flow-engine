# From flow brief to YAML

The syntax is in `node_modules/@gallas-ai/flow-engine/docs/yaml.md`. This file holds what that page doesn't make obvious.

## Where each part of the brief goes

| Brief | YAML |
|---|---|
| 1. Task | Flow `description`, which routing reads: name what the customer wants and how it differs from similar flows. Started only by another flow: `if: False` |
| 2. Information | `collect` steps with a concrete `description`, which the NLU reads. Kind and values: `slots`. A list from a system: `options` with a function name. Always asked: `ask_before_filling: true` |
| 3. Rules | A rule on the value itself: `rejections`. Checked against a system: `verify`. Attempts: `max_attempts`, then `on_exhausted` |
| 4. Decisions | `next` with `if` / `then` / `else` |
| 5. Systems | `action` steps, listed in the action list |
| 6. Other flows | For good: `link`. In the middle: `call`. What goes along or must not be asked twice: `persisted_slots` |
| 7. What the bot says | `responses`: `utter_ask_<slot>` for each question, `{slot}` for values. Slot keys `help`, `not_available`, `no_options` |

## Traps

- **Consent** always gets `ask_before_filling: true`, otherwise "yes" from an earlier message can count as consent.
- **A branch ends the flow** when its `then` or `else` steps finish without a `next`. A branch that should rejoin needs
  `next: <id>` on its last step.
- **Going back to a question** only works with an empty slot, because a `collect` with a value is skipped. Clear the slot
  first, with `set_slots` or from the action.
- **A check turns a value down by clearing the slot.** A `verify` action returns the slot as `null`. `max_attempts` counts
  those; the action list has to say so.
- **A `verify` re-asks only its own question**, even when it clears other slots. When a wrong combination has to be asked
  for again in full, use an `action` step after the questions: it clears them and counts the tries in a slot, and its
  `next` goes back to the first question. `max_attempts` can't count across that loop.
- **`on_exhausted`** needs `max_attempts`, and without `on_exhausted` the flow simply ends.
- **After a `call`**, branch on the slots right away: `END` and `on_exhausted` in the called flow end only that flow, and
  the caller continues.
- **A called flow can't contain a `link`.** Keep the `link` in the caller.
- **`link`** is the last step of its list and has no `next`.
- **Slots end with their flow.** Only a `call`, a `link` with `persisted_slots`, and parked flows receive values.
- **`persisted_slots` re-runs steps**: a parked flow checks the value again, runs `verify` again and continues, so its
  actions can run twice and have to say so in the action list. Clear a finally rejected value before the flow ends.
- **An options function is synchronous.** Data from a system is loaded by an action before the question.
- **A choice with exactly one option** is picked without asking, so a question the brief expects may not appear.
