# Changelog

All notable changes for users of `@gallas-ai/flow-engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/)
(before 1.0, a minor version can break things; such changes are marked ⚠️).

## [Unreleased]

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
