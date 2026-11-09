# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@gallas-ai/flow-engine`: a small, dependency-free TypeScript library (ESM-only, Node `^22.12.0 || ^24.0.0 || >=26.0.0`)
for task-oriented conversations. Core principle: **the LLM understands, the code decides.** The LLM is only asked narrow
questions through the injected `Nlu` interface; what happens next is decided deterministically by walking flow steps.
The engine never imports LLM code.

## How to work

- **Rasa compatibility (important).** Every proposal follows Rasa in both YAML syntax and conversation behaviour: where
  Rasa has a counterpart, take its name and its behaviour. Before proposing, look the counterpart up in the
  [Rasa docs](https://rasa.com/docs/reference/primitives/flows/) and state in the proposal what you found. Where Rasa has
  no counterpart (e.g. the `Nlu` interface, engine options), the proposal says so. A deviation needs a clear reason:
  state it in the proposal and, once approved, add it to "Differences from Rasa" in `docs/yaml.md`. A deviation that is
  hard to reverse also gets an ADR.
- **Design.** Run `/mattpocock-skills:grill-with-docs` before creating or proposing anything with a decision in it: a
  new feature, a behaviour change, the public API, the YAML syntax, a new example or docs. Changes with nothing to decide
  (a typo, a fix to an already agreed spec) go straight to the work.
- **Implementation.** Run `/mattpocock-skills:tdd` for new features, behaviour changes and bug fixes: failing tests
  first, red for the right reason, then the implementation, then green. A refactoring keeps the existing tests green;
  a docs-only change needs no tests.

## Language

Write everything in this repository in English: code, identifiers, comments, docs, examples, test fixtures, test data,
flow names, bot texts and commit messages. This applies even when the user writes to you in another language. When you
touch existing non-English content, translate it to English.

## Commands

```bash
npm test                                   # vitest run (all tests)
npx vitest run test/engine.test.ts         # one file
npx vitest run -t "verifies a known"       # tests matching a name
npm run typecheck                          # tsc --noEmit over src, test, examples, scripts
npm run build                              # rm -rf dist && tsc -p tsconfig.build.json (src only)
npm run check:package                      # publint + attw on the packed package
```

CI (`.github/workflows/ci.yml`) runs typecheck → test → build → check:package on Node 22, 24 and 26. There is no linter.

Releasing: `npm version minor|patch` then `git push --follow-tags`. npm's `version` script runs
`scripts/changelog.ts release`, which turns `## [Unreleased]` in `CHANGELOG.md` into the new version (and fails when it
is empty). The `v*` tag triggers `release.yml`, which checks the tag against `package.json`, takes the release notes
from that version's `CHANGELOG.md` section, reruns the checks and publishes via npm trusted publishing.

## TypeScript setup

- TypeScript 7, `module: NodeNext`, `verbatimModuleSyntax`: relative imports use the **`.ts` extension**
  (`./types.ts`), and type-only imports must use `import type`. The build rewrites the extensions to `.js`
  (`rewriteRelativeImportExtensions`).
- `tsconfig.json` (no emit) covers `src`, `test` and `examples`; `tsconfig.build.json` emits only `src` to `dist/`.
- No runtime dependencies. `yaml` is a dev dependency only: the YAML compiler takes already-parsed data, so users parse
  with any library.

## Architecture

- `src/types.ts` – the public contract: `Flow`, `SlotDefinition`, `Step` (a discriminated union on `kind`: `collect`,
  `say`, `goto`, `set`, `link`, `call`, `action`, `end`), `Nlu`, `Messages`, `FlowEngineEvent`, and the reserved step id `END`.
- `src/engine.ts` – `FlowEngine`, the state machine. It keeps a **stack of frames** (one per active flow: step index,
  slots, the slot it is waiting for, attempt counters).
  - `handle(text)`: with nothing waiting, `nlu.route` picks a flow (or `nlu.answer` replies). While waiting on a question,
    `nlu.classifyTurn` decides between `answer`, `step_question`, `digression`, `task_switch` (parks the current frame and
    pushes a new one) and `cancel`.
  - `fill()` runs `nlu.extract` once for **all** open slots of the call chain and the flows it calls, not just the asked
    one, then type-checks and runs `validate`; a value for another flow is checked at its `collect` step
    (`docs/adr/0002-one-read-across-the-call-chain.md`). The same path does prefill from the opening message.
  - `advance()` walks the steps until it must ask a question. A `collect` whose slot is already filled is skipped. A
    choice slot with exactly one option is auto-selected. When the frame's steps run out, it pops and the frame below
    resumes with a `messages.resume` line. A `link` replaces the frame and carries the listed slots along. A `call`
    pushes a frame marked `called` with all the caller's slots; when it ends, its slots replace the caller's and the
    caller continues without a resume line.
  - Tracing (`docs/tracing.md`): with `options.tracer`, `handle()` and `start()` are root spans, and `inSpan()` wraps
    the NLU calls, `fill`, each step and actions. `output` and `emit` add span events to the innermost span. Content
    goes on spans only through `record()`, which checks `recordContent`. `Tracer` is our own subset of OpenTelemetry's,
    not a dependency (`docs/adr/0004-own-tracer-interface.md`).
  - `state()` returns the conversation state as JSON and the `state` option restores it, rejecting what doesn't fit the
    flows (`docs/adr/0005-conversation-state-is-a-snapshot.md`). A called frame shares `unchecked` with the frame below,
    also after a restore.
  - `validateFlows()` checks references (step ids, slots, linked flows) and rejects a `call` to a flow that uses a
    `link`, in the constructor, so broken flows fail at construction rather than mid-conversation.
- `src/compile.ts` – `compileFlows(data, registry)`: compiles a subset of Rasa's YAML flow syntax into the same `Flow`
  objects as hand-written flows. Actions and dynamic options are looked up by name in a `FlowRegistry`. `action: utter_*`
  becomes a `say` step from `responses`. Nested `then`/`else` branches are flattened into extra step lists appended after
  the main steps, each ending with an `end` step and wired with `goto`. Every error names the path to the broken spot
  (`flows.x.steps[3].next: …`), because YAML has no type checker.
- `src/condition.ts` – a hand-written parser for the condition language (a pypred subset: `slots.x is null`,
  `not slots.confirm`, `matches`, comparisons, `and`/`or`). The grammar is in the file header. It never uses `eval`.
- `src/messages.ts` – `defaultMessages`, every text the engine says on its own; overridable via `options.messages`.
- `src/index.ts` – the public exports. Anything new that users need must be exported here.

Semantics that are easy to break:
- `prefill: false` (YAML `ask_before_filling: true`) means the slot is taken only from an answer to its own question.
  A carried value, a value set by an action, or one answered on an earlier pass is asked again (used for consent).
- A called frame and its callers form a **call chain** (see `GLOSSARY.md`): `cancel` removes the whole chain, a
  `task_switch` parks it, and the messages name the flow the customer started. `routable: false` (YAML `if: False`)
  hides a flow from `nlu.route`. Why called flows share slots: `docs/adr/0001-called-flows-share-slots.md`.
- `persistedSlots` (YAML `persisted_slots`, which also sets a `link`'s `carry`) go to all parked flows when a flow the
  customer started leaves, at its end, on a cancel or on a `link`, including those of the flows it calls. The parked
  `collect` checks the value and runs `verify` again; a slot without a value changes nothing
  (`docs/adr/0003-persisted-slots-reach-parked-flows.md`).
- A flow runs only once: a `task_switch` or `link` to a parked flow moves its whole call chain to the top of the stack
  instead of starting a copy. A `call` always pushes a frame, because several chains may call the same flow.
- `verify` on a collect step is an action. It turns a value down by **clearing the slot** (`setSlots: { x: null }`).
  Turned-down values from `verify` or `validate` count toward `maxAttempts`, after which the flow jumps to `onExhausted`
  (default `END`), unless the `verify` action also returns `uncounted: true`.
- Every `Frame` field that outlives a message must go through `state()` and the `state` option, with a test in the
  "conversation state" block of `test/engine.test.ts` that plays a conversation in one engine and with a new engine per
  message. `answered` is the exception: the collect step uses it up in the message that filled it.
- Actions receive a copy of the slots and change them only through `ActionResult.setSlots` (`null` deletes a slot).

## Tests

- Tests use a **fake keyword NLU** (an object implementing `Nlu`), never a real LLM. They collect output through the
  `output` callback and assert on the lines said per turn and on `engine.snapshot()`.
- Tracing tests: `test/tracing.test.ts` records spans with a fake `Tracer`; `test/opentelemetry.test.ts` runs the
  engine against the real OpenTelemetry SDK (dev dependencies only) and checks that its `Span` fits `TracerSpan`.
- YAML sources are imported with Vite's `?raw` suffix (typed by `test/raw.d.ts`). The shop fixture is
  `test/fixtures/eshop.yaml`.
- `test/examples.test.ts` runs scenarios from `examples/verification/` and `examples/appointments/` against both the
  YAML version and the code version of the same flows (`describe.each`). The two versions must behave the same.

## Examples

Each directory in `examples/` (except `shared/`) is one use case, named after it (`verification`), never after the
feature it shows. It holds `README.md`, `flows.yaml`, `flows.ts` (the same flow in code), `nlu.ts` (keywords for the
shared `keywordNlu` from `examples/shared/nlu.ts`), `main.ts` and, if needed, `actions.ts` with the `FlowRegistry`.
`main.ts` plays the customer's lines with `yaml`, `code` or both variants (`npm run example -- <example> [yaml|code]`).
`src` must stay runnable by Node's type stripping, hence `erasableSyntaxOnly`.

How to run the example is the most important information in its README: the first section, right after the title and
the one-line intro, is `## Run it` with the `npm run example -- <example>` command. Never move it further down. The section also shows the same command with
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` for tracing it in MLflow.

`test/examples-layout.test.ts` enforces this. For every example it checks that the files exist, that the README starts
with the `## Run it` section, that the main README
links to it, and that `main.ts` prints exactly the ` ```transcript ` blocks of its README in both variants. `← …`
notes are ignored, so put explanations there.

Every change to the public API or the YAML syntax ends with this decision, made before you report the work done:

- **New example**: a new capability a user would look for by name, e.g. a new step kind or new collect-step
  behaviour like `verify` + `max_attempts`.
- **Extend an existing example**: a new option of a capability an example already shows.
- **No example**: bug fixes, refactoring, message texts, error messages, internal changes.
- **Ask the user**: anything in between, especially new engine options and changes to the `Nlu` interface, and any
  feature that can't be expressed in YAML. Every example has both variants.

A new or changed example updates the `## Examples` table in the main README (absolute GitHub URL, a "what it shows"
column naming the features) and its README's ` ```transcript ` block.

## Docs

User-facing documentation is `README.md` plus `docs/flows-in-code.md`, `docs/yaml.md` (including the "Differences from
Rasa" section), `docs/nlu.md` (the `Nlu` interface and engine options), `docs/conversation-state.md` (saving and
restoring a conversation), `docs/tracing.md` and `docs/author-flows.md`. The README links to the docs with absolute
GitHub URLs, because it is also rendered on npm.

## The `author-flows` skill

`skills/author-flows/` ships in the npm package and is installed with `npx skills add` from `node_modules`, so it works
in any agent that reads `SKILL.md`. It reads `docs/yaml.md` and `src/compile.ts` of the installed version, so it only
holds what those don't say. Every change to the YAML syntax also updates `skills/author-flows/brief-to-yaml.md`, and
`brief-template.md` when the change gives the flow author something new to decide. `scripts/check-flows.mjs` is plain
JavaScript because Node doesn't strip types under `node_modules`. `test/author-flows.test.ts` runs it in a project laid
out like a real install.

## Changelog

`CHANGELOG.md` is for developers using the package, not for contributors. Every change ends with this decision, next to
the example decision above:

- **Add an entry under `## [Unreleased]`** for anything a user of the package notices: the public API, the YAML
  syntax, behaviour (events, `snapshot()`, message texts), user-facing docs and new examples. Use the Keep a Changelog
  sections (`Added`, `Changed`, `Fixed`, `Removed`, plus `Docs & examples`), write to "you", the developer, and keep
  "customer" for the person chatting with the bot (`GLOSSARY.md`). Link the docs section with an absolute GitHub URL.
  Mark changes that can break existing code with ⚠️ and say whose code breaks.
- **No entry**: refactoring, tests, CLAUDE.md, the example runner, dev dependencies, CI.

Never edit a released version's section, and never write a version heading yourself: `npm version` does that.
