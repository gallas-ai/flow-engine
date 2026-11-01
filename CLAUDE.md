# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@gallas-ai/flow-engine`: a small, dependency-free TypeScript library (ESM-only, Node `^22.12.0 || ^24.0.0 || >=26.0.0`)
for task-oriented conversations. Core principle: **the LLM understands, the code decides.** The LLM is only asked narrow
questions through the injected `Nlu` interface; what happens next is decided deterministically by walking flow steps.
The engine never imports LLM code.

## Language

Write everything in this repository in English: code, identifiers, comments, docs, examples, test fixtures, test data,
flow names, bot texts and commit messages. This applies even when the user writes to you in another language. When you
touch existing non-English content, translate it to English.

## Commands

```bash
npm test                                   # vitest run (all tests)
npx vitest run test/engine.test.ts         # one file
npx vitest run -t "verifies a known"       # tests matching a name
npm run typecheck                          # tsc --noEmit over src, test, examples
npm run build                              # rm -rf dist && tsc -p tsconfig.build.json (src only)
npm run check:package                      # publint + attw on the packed package
```

CI (`.github/workflows/ci.yml`) runs typecheck → test → build → check:package on Node 22, 24 and 26. There is no linter.

Releasing: `npm version minor|patch` then `git push --follow-tags`; the `v*` tag triggers `release.yml`, which checks the
tag against `package.json`, reruns the checks and publishes via npm trusted publishing.

## TypeScript setup

- TypeScript 7, `module: NodeNext`, `verbatimModuleSyntax`: relative imports use the **`.ts` extension**
  (`./types.ts`), and type-only imports must use `import type`. The build rewrites the extensions to `.js`
  (`rewriteRelativeImportExtensions`).
- `tsconfig.json` (no emit) covers `src`, `test` and `examples`; `tsconfig.build.json` emits only `src` to `dist/`.
- No runtime dependencies. `yaml` is a dev dependency only: the YAML compiler takes already-parsed data, so users parse
  with any library.

## Architecture

- `src/types.ts` – the public contract: `Flow`, `SlotDefinition`, `Step` (a discriminated union on `kind`: `collect`,
  `say`, `goto`, `set`, `link`, `action`, `end`), `Nlu`, `Messages`, `FlowEngineEvent`, and the reserved step id `END`.
- `src/engine.ts` – `FlowEngine`, the state machine. It keeps a **stack of frames** (one per active flow: step index,
  slots, the slot it is waiting for, attempt counters).
  - `handle(text)`: with nothing waiting, `nlu.route` picks a flow (or `nlu.answer` replies). While waiting on a question,
    `nlu.classifyTurn` decides between `answer`, `step_question`, `digression`, `task_switch` (parks the current frame and
    pushes a new one) and `cancel`.
  - `fill()` runs `nlu.extract` for **all** open slots, not just the asked one, then type-checks and runs `validate`.
    The same path does prefill from the opening message.
  - `advance()` walks the steps until it must ask a question. A `collect` whose slot is already filled is skipped. A
    choice slot with exactly one option is auto-selected. When the frame's steps run out, it pops and the frame below
    resumes with a `messages.resume` line. A `link` replaces the frame and carries the listed slots along.
  - `validateFlows()` checks references (step ids, slots, linked flows) in the constructor, so broken flows fail at
    construction rather than mid-conversation.
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
- `verify` on a collect step is an action. It turns a value down by **clearing the slot** (`setSlots: { x: null }`).
  Turned-down values from `verify` or `validate` count toward `maxAttempts`, after which the flow jumps to `onExhausted`
  (default `END`).
- Actions receive a copy of the slots and change them only through `ActionResult.setSlots` (`null` deletes a slot).

## Tests

- Tests use a **fake keyword NLU** (an object implementing `Nlu`), never a real LLM. They collect output through the
  `output` callback and assert on the lines said per turn and on `engine.snapshot()`.
- YAML sources are imported with Vite's `?raw` suffix (typed by `test/raw.d.ts`). The shop fixture is
  `test/fixtures/eshop.yaml`.
- `test/examples.test.ts` runs each scenario from `examples/verification/` against both the YAML version and the
  code version of the same flow (`describe.each`). The two versions must behave the same.

## Examples

Each directory in `examples/` (except `shared/`) is one use case, named after it (`verification`), never after the
feature it shows. It holds `README.md`, `flows.yaml`, `flows.ts` (the same flow in code), `nlu.ts` (keywords for the
shared `keywordNlu` from `examples/shared/nlu.ts`), `main.ts` and, if needed, `actions.ts` with the `FlowRegistry`.
`main.ts` plays the customer's lines with `yaml`, `code` or both variants (`npm run example -- <example> [yaml|code]`).
`src` must stay runnable by Node's type stripping, hence `erasableSyntaxOnly`.

`test/examples-layout.test.ts` enforces this. For every example it checks that the files exist, that the main README
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
Rasa" section) and `docs/nlu.md` (the `Nlu` interface and engine options). The README links to the docs with absolute
GitHub URLs, because it is also rendered on npm.
