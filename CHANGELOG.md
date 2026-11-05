# Changelog

All notable changes for users of `@gallas-ai/flow-engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/)
(before 1.0, a minor version can break things; such changes are marked ⚠️).

## [Unreleased]

### Docs & examples

- [Few-shot examples in `route`](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md#few-shot-examples-in-route):
  how to steer your NLU's choice of flow with a few example messages, also in several languages and for messages that
  start no flow. It needs no change to your flows or to the engine. The
  [YAML docs](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#differences-from-rasa) now also say that
  Rasa's `nlu_trigger` isn't supported.
- [examples/returns-and-complaints](https://github.com/gallas-ai/flow-engine/tree/main/examples/returns-and-complaints)
  shows few-shot examples in English, Czech and Spanish telling two similar flows and a plain question apart.

## [0.4.0] - 2026-11-04

### Added

- **`uncounted` in `ActionResult`**: a `verify` action that clears the slot and returns `uncounted: true` asks again without
  counting the value toward `maxAttempts`, e.g. for a name several customers share. You can drop your own attempt counter
  if you kept one for this reason.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#steps) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#steps)
- **`persistedSlots` on a flow** (YAML: `persisted_slots`): the listed slots go to the parked flows when the flow leaves,
  at its end, on a cancel or on a `link`. A parked question whose slot got a value this way isn't asked again, so a
  customer who verifies during another task isn't asked to verify again when the first task resumes. The parked `collect`
  step checks the value, and its `verify` and the steps after it run again.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#slots-for-parked-flows) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#slots-for-parked-flows)

### Changed

- ⚠️ **`persisted_slots` in YAML also reaches parked flows.** It used to list only what a `link` carries. If your YAML
  flows use it, a parked flow now gets these values when the flow leaves, and replaces its own value of the same name.
  Flows written in code don't change: `link.carry` stays what it was.
  [Docs](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#slots-for-parked-flows)
- ⚠️ **A called flow can't use a `link`.** `new FlowEngine` now throws when a flow calls a flow that has a `link` step,
  even in a branch the call would never reach. This breaks your flows if they combine the two; they lost the caller's
  slots before. Move the shared steps to a flow of their own, call it, and keep the `link` in the caller. Rasa has the
  same rule.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#calling-a-flow) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#calling-a-flow)
- ⚠️ **`Nlu.extract` during a `call`**: `flow` is now the flow the customer started, not the called flow, and `wanted`
  also holds the open slots of the other flows in the call. It breaks your NLU if it decides by `flow` or expects `wanted`
  to belong to `flow`. Each message now makes one `extract` call, also at the start of a flow that calls another.
  A choice slot in `wanted` can have no options yet, so don't send an empty `enum`.
  [Docs](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md#which-method-is-called-when)
- **"Sorry, I didn't quite get that" only when nothing was understood.** An answer that fills another slot, but not the
  one the bot asked about, no longer gets this line: the bot just asks again, and it doesn't count as a failed attempt.
  This applies to all flows.

### Fixed

- **The same flow twice on the stack.** A task switch or a `link` to a parked flow started a second copy of it, so after
  finishing it the customer was asked to go through the parked copy too. Now the parked flow resumes where it stopped and
  keeps its slots; on a task switch the current flow is parked instead.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#a-flow-runs-only-once)
- **Values lost during a `call`.** When the customer answered a called flow's question and added something for the
  caller ("555-0100, Friday"), the bot forgot it and asked again. Now every message is read for the whole call, also for
  flows that start later, and the value survives even when the called flow turns the answer down. `validate` and
  `rejections` of another flow's slot run when that flow reaches its `collect` step.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#calling-a-flow) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#calling-a-flow)

### Docs & examples

- [examples/verification](https://github.com/gallas-ai/flow-engine/tree/main/examples/verification) shows a value that
  doesn't count as an attempt.
- [examples/appointments](https://github.com/gallas-ai/flow-engine/tree/main/examples/appointments) shows one answer
  filling both the verification and the booking, and a parked booking that isn't asked again for the phone number.

## [0.3.0] - 2026-11-01

### Added

- **Checking a collected value: `verify`, `maxAttempts`, `onExhausted`** on a `collect` step (YAML: `verify`,
  `max_attempts`, `on_exhausted`). `verify` is an action run as soon as the slot is filled, also from the first message;
  when it clears the slot, the value is turned down and the question is asked again. After `maxAttempts` turned-down
  values (by `verify` or `validate`) the flow goes to `onExhausted`, a step id or `END` (the default). Answers the engine
  didn't understand don't count.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#steps) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#steps)
- **`call` step** (YAML: `call: <flow>`): runs another flow in the middle of the current one and continues with the
  next step when it ends. The called flow shares the caller's slots: it starts with all of them, and all of its slots
  (set or cleared) come back. An `END` in the called flow ends only that flow, so check its slots right after the
  `call`. It takes values from the customer's message that led to the call. Cancelling inside a called flow cancels the
  flow the customer started, and a task switch parks both; the messages name the flow the customer started. The engine
  throws at construction when a flow can lead back to itself through calls and links.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#calling-a-flow) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#calling-a-flow)
- **`routable: false` on a flow** (YAML: `if: False`) hides it from `Nlu.route`, so only a `call`, a `link` or
  `engine.start` starts it. Other values of YAML `if` are rejected when the flows load.
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#if-false)

### Changed

- ⚠️ The `flowStarted` event and each `FrameSnapshot` from `engine.snapshot()` have a new `called: boolean` field
  (`true` for a flow started by a `call`). Code that only reads them is unaffected; code that builds these objects
  (e.g. test fakes) or compares them with deep equality (`toEqual`) needs the new field.

### Docs & examples

- [Multiple languages](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md#multiple-languages): how to run
  the engine in the customer's language with translated `messages`, responses and one `Nlu` per language.
- New runnable examples (`npm run example -- <example>` in a clone of the repository), each in YAML and in code:
  - [verification](https://github.com/gallas-ai/flow-engine/tree/main/examples/verification) – `verify`,
    `max_attempts`, `on_exhausted`
  - [appointments](https://github.com/gallas-ai/flow-engine/tree/main/examples/appointments) – two flows sharing one
    verification with `call`, `if: False`
  - [delivery-reschedule](https://github.com/gallas-ai/flow-engine/tree/main/examples/delivery-reschedule) – one flow in
    English, Czech and Spanish

## [0.2.0] - 2026-10-28

See the [0.2.0 release](https://github.com/gallas-ai/flow-engine/releases/tag/v0.2.0) for 0.2.0 and older versions.

[Unreleased]: https://github.com/gallas-ai/flow-engine/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/gallas-ai/flow-engine/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/gallas-ai/flow-engine/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gallas-ai/flow-engine/releases/tag/v0.2.0
