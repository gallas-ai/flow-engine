# Changelog

All notable changes for users of `@gallas-ai/flow-engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/)
(before 1.0, a minor version can break things; such changes are marked ⚠️).

## [Unreleased]

### Changed

- ⚠️ **`Nlu.extract` during a `call`**: `flow` is now the flow the customer started, not the called flow, and `wanted`
  also holds the open slots of the other flows in the call. It breaks your NLU if it decides by `flow` or expects `wanted`
  to belong to `flow`. Each message now makes one `extract` call, also at the start of a flow that calls another.
  A choice slot in `wanted` can have no options yet, so don't send an empty `enum`.
  [Docs](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md#which-method-is-called-when)
- **"Sorry, I didn't quite get that" only when nothing was understood.** An answer that fills another slot, but not the
  one the bot asked about, no longer gets this line: the bot just asks again, and it doesn't count as a failed attempt.
  This applies to all flows.

### Fixed

- **Values lost during a `call`.** When the customer answered a called flow's question and added something for the
  caller ("555-0100, Friday"), the bot forgot it and asked again. Now every message is read for the whole call, also for
  flows that start later, and the value survives even when the called flow turns the answer down. `validate` and
  `rejections` of another flow's slot run when that flow reaches its `collect` step.
  [Code](https://github.com/gallas-ai/flow-engine/blob/main/docs/flows-in-code.md#calling-a-flow) ·
  [YAML](https://github.com/gallas-ai/flow-engine/blob/main/docs/yaml.md#calling-a-flow)

### Docs & examples

- [examples/appointments](https://github.com/gallas-ai/flow-engine/tree/main/examples/appointments) shows one answer
  filling both the verification and the booking.

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

[Unreleased]: https://github.com/gallas-ai/flow-engine/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/gallas-ai/flow-engine/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gallas-ai/flow-engine/releases/tag/v0.2.0
