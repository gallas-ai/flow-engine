# Writing flows with an agent

`author-flows` is an agent skill that comes with the package. It interviews the person who decides what the bot does,
writes down what they decided in a flow brief, and turns the approved brief into flows YAML that compiles. It works in
Claude Code, GitHub Copilot and other agents that read `SKILL.md`.

## Install

```bash
npm install @gallas-ai/flow-engine
npm install -D yaml
npx skills@latest add ./node_modules/@gallas-ai/flow-engine --skill author-flows
npx skills@latest add mattpocock/skills --skill grilling
```

The installer asks which agents to install for; `-a claude-code -a github-copilot` answers that in advance. The
interview runs on the [`grilling`](https://github.com/mattpocock/skills) skill, and `author-flows` stops at once when it
isn't installed. If you installed `mattpocock-skills` as a plugin, you already have it.

The installer copies the skill, so run the `author-flows` line again after upgrading the package. The skill reads the
docs and the source of the version you have installed.

## Use

Type `/author-flows`, or tell your agent you want to define or change what the bot does. The interview is in English,
and the bot can speak any language you pick. You get three files, by default in `flows/`:

| File | What it is | Who it's for |
|---|---|---|
| `<topic>.brief.md` | The flow brief: tasks, information, rules, decisions, systems, texts and example conversations. You approve it before any YAML is written, and every later change starts here | Whoever decides what the bot does |
| `<topic>.yaml` | The flows, in the [YAML syntax](yaml.md), ready for `compileFlows` | The engine |
| `<topic>.actions.md` | Every action and options function the YAML names: when it runs, which slots it reads and changes, what happens when it fails | The developers who write them |

## What is checked

The skill runs `compileFlows` on the YAML with stand-ins for the code that doesn't exist yet, which catches everything
in [Mistakes are caught when the flows load](yaml.md#mistakes-are-caught-when-the-flows-load) except typos in action and
options names. It compares those names with the action list. It then traces every example conversation from the brief
through the YAML by reading it: the conversations aren't run, because the actions don't exist yet. Run them once they do.
