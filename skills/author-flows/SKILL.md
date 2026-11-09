---
name: author-flows
description: Author conversation flows for @gallas-ai/flow-engine by grilling the flow author into an approved flow brief, then writing validated flows YAML. Use when someone wants to define or change what a bot built on the flow engine does.
---

# Author flows

Lead the **flow author** (the person who decides what the bot does) from a business idea to validated flows YAML. The
**customer** is whoever later chats with the bot. Hold the whole conversation in English, whatever language the flow
author writes in.

All paths starting with `node_modules/` are relative to the project root and match the engine version the project has
installed.

## 1. Check the prerequisites

1. Look for a skill named `grilling` among your available skills, also under a plugin prefix such as
   `mattpocock-skills:grilling`. When it is missing, stop here, create nothing, and tell the flow author:
   > This skill needs the `grilling` skill. Install it with `npx skills@latest add mattpocock/skills --skill grilling`
   > and start again.
2. Check that `node_modules/@gallas-ai/flow-engine/docs/yaml.md` exists. When it is missing, stop here and ask for
   `npm i @gallas-ai/flow-engine` first.
3. Read that file, including "Differences from Rasa": it is the full list of what the engine can and can't do.

Done when `grilling` is available and you have read the file.

## 2. Grill the flow author

Load the `grilling` skill and follow it, with `node_modules/@gallas-ai/flow-engine/skills/author-flows/brief-template.md`
as the map of what has to be decided.

- The first round settles the topic (a short kebab-case name), the folder (default `flows/`) and the language the bot
  speaks to customers (default English). When `<folder>/<topic>.brief.md` already exists, read it and the YAML beside
  it, and grill only the requested change and what it touches.
- Ask in business terms: "May we take this from the customer's first message, or must the bot always ask?". Keep YAML
  keys for step 4.
- Stress-test every flow with scenarios: the customer says no, gives a wrong value, gives it three times, asks something
  else midway, switches to another task and comes back; a system is down or finds nothing.
- When the flow author wants something the engine can't do, say so in that round and offer the closest thing it can.
- A request that belongs to no flow never starts one, so a flow has no text for it: the bot's general answering
  (`Nlu.answer`) replies. Promise a fixed sentence for such a request only as a small flow of its own.

Done when every section of the template is answered for every flow, with no open or "TBD" item.

## 3. Write the flow brief and get it approved

Fill the template into `<folder>/<topic>.brief.md`, show it, and revise it until the flow author explicitly approves it.

Done when the flow author has said the brief is approved. An approved brief is the source of truth: every later change
starts here.

## 4. Write the YAML and the action list

1. Read `node_modules/@gallas-ai/flow-engine/skills/author-flows/brief-to-yaml.md` and write `<folder>/<topic>.yaml` from
   the brief. When the docs leave a doubt, `node_modules/@gallas-ai/flow-engine/src/compile.ts` decides. Texts in
   `responses` are in the bot's language; keys, ids and every `description` are in English.
2. Write `<folder>/<topic>.actions.md` for the developers. One heading per action and per options function, named as in
   the YAML, each with: when it runs, the slots it reads, the slots it sets or clears, what it says, and what happens
   when it fails.

Done when every item of the brief is in the YAML or the action list.

## 5. Verify

1. Run `node node_modules/@gallas-ai/flow-engine/skills/author-flows/scripts/check-flows.mjs <folder>/<topic>.yaml` and
   fix what it reports. It needs the `yaml` package in the project; ask before installing it.
2. Compare the `actions:` and `options:` lines it prints with the headings of the action list: the same names on both
   sides.
3. Trace every example conversation of the brief through the YAML, message by message, naming the step reached and the
   slots filled. Where the path differs from the brief, fix the YAML. When the brief itself is wrong, return to step 3.

Done when the script passes, the names match and every conversation reaches the outcome the brief states.

## 6. Hand over

Tell the flow author which three files exist and which actions developers still have to write. Say that the example
conversations were traced by reading the YAML, not run, because the actions don't exist yet.
