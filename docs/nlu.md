# Connecting an LLM

The engine asks the NLU five narrow questions. Implement them with your LLM of choice (or with keywords in tests):

```ts
interface Nlu {
  route(text, flows): Promise<string | null>;
  classifyTurn(flowTitle, question, text): Promise<TurnType>;
  extract(flow, wanted, slots, text, question?): Promise<Extraction>;
  choose(question, text, options): Promise<string | null>;
  answer(text, step?): Promise<string>;
}
```

| Method | Question | Returns |
|---|---|---|
| `route` | Which flow does this message start? `flows` lists each flow's `name`, `title` and `description` | The flow's `name`, or `null` to just answer the message |
| `classifyTurn` | While the bot waits for an answer to `question`: what is this message? | `answer`, `step_question` ("why do you need it?"), `digression` (an unrelated question), `task_switch` (wants something else) or `cancel` |
| `extract` | Which of the `wanted` slots does the message contain? | `{ values, notAmongOptions }`: typed values (`true` / `false` for bool slots, numbers for number slots), and the choice slots for which the customer named something that isn't offered |
| `choose` | Which of the offered `options` did the customer pick ("the second one", "the cheaper one")? | The option's `value`, or `null` |
| `answer` | Answer a free question. `step` holds the waiting question and its `help` when the customer asks about the step | The answer text |

The engine checks everything the NLU returns: values of the wrong type, choices that aren't offered and values that fail
`validate` are not used.

## Which method is called when

The conversation from the README, with the NLU calls behind each message:

| Customer | NLU calls | Result |
|---|---|---|
| I want to return the mug | `route` → `"refund"`, then `extract` (prefill) → `{ item: "mug" }` | The item question is skipped, the bot asks "Return the mug?" |
| wait, what is your return policy? | `classifyTurn` → `digression`, `extract` → nothing, `answer` → the policy | The bot answers, then asks "Return the mug?" again |
| yes | `classifyTurn` → `answer`, `extract` → `{ confirm: true }` | The action runs |

`route` is called only when no flow waits for an answer. `choose` is called on top of `extract` when the waiting slot is
a choice with more than one option.

## Example: an NLU with Claude

Each method is one LLM call. Forcing the model to reply through a tool with a JSON schema makes the result structured,
and the schema's `enum`s keep it to flow names, turn types and option values:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { TURN_TYPES, type Extraction, type Nlu, type SlotDefinition, type Slots } from "@gallas-ai/flow-engine";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const MODEL = "claude-haiku-5-5"; // the questions are narrow, a small model is enough

const FAQ = `
- Items can be returned within 30 days of delivery.
- A refund reaches the account within 5 working days.
- Broken items are handled as complaints, not returns.`;

/** One LLM call that must reply through the `reply` tool, so the result always has the shape of `schema`. */
async function ask<T>(prompt: string, schema: Anthropic.Tool.InputSchema): Promise<T> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{ name: "reply", description: "Your reply", input_schema: schema }],
    tool_choice: { type: "tool", name: "reply" },
    messages: [{ role: "user", content: prompt }],
  });
  const reply = response.content.find((block) => block.type === "tool_use");
  return reply!.input as T;
}

/** The slot as the LLM sees it: name, meaning and, for a choice, the values it may use. */
function describeSlot(definition: SlotDefinition, slots: Slots): string {
  const options = definition.options?.(slots).map((option) => `"${option.value}" (${option.label})`);
  return `- ${definition.name} (${definition.type}): ${definition.description}${options ? `. Options: ${options.join(", ")}` : ""}`;
}

/** The JSON type of a slot value; a choice may only be one of the offered values. */
function slotSchema(definition: SlotDefinition, slots: Slots) {
  if (definition.type === "bool") return { type: "boolean" };
  if (definition.type === "number") return { type: "number" };
  if (definition.type === "choice") return { type: "string", enum: definition.options!(slots).map((option) => option.value) };
  return { type: "string" };
}

export const claudeNlu: Nlu = {
  async route(text, flows) {
    const { flow } = await ask<{ flow: string | null }>(
      `A customer wrote to a shop's support. Which task does the message start?
Answer null if it only asks a question or makes small talk.

Tasks:
${flows.map((flow) => `- ${flow.name}: ${flow.title}. ${flow.description ?? ""}`).join("\n")}

Message: ${text}`,
      {
        type: "object",
        properties: { flow: { enum: [...flows.map((flow) => flow.name), null] } },
        required: ["flow"],
      },
    );
    return flow;
  },

  async classifyTurn(flowTitle, question, text) {
    const { turnType } = await ask<{ turnType: (typeof TURN_TYPES)[number] }>(
      `The customer is in the middle of "${flowTitle}". We asked: "${question}"
The customer replied: "${text}"

What is the reply?
- answer: answers the question (also "yes", "no", a bare value)
- step_question: asks about our question ("why do you need it?", "where do I find it?")
- digression: an unrelated question; the customer still wants to finish "${flowTitle}"
- task_switch: wants to do a different task now
- cancel: no longer wants "${flowTitle}"`,
      { type: "object", properties: { turnType: { enum: [...TURN_TYPES] } }, required: ["turnType"] },
    );
    return turnType;
  },

  async extract(flow, wanted, slots, text, question) {
    const choices = wanted.filter((definition) => definition.type === "choice").map((definition) => definition.name);
    return ask<Extraction>(
      `Task: ${flow.title}. ${flow.description ?? ""}
Already known: ${JSON.stringify(slots)}
${question ? `We asked: "${question}"\n` : ""}Customer: "${text}"

Fill only the values the customer actually states, leave the rest out:
${wanted.map((definition) => describeSlot(definition, slots)).join("\n")}

In notAmongOptions list the choice slots for which the customer names something that isn't among the options.`,
      {
        type: "object",
        properties: {
          values: {
            type: "object",
            properties: Object.fromEntries(wanted.map((definition) => [definition.name, slotSchema(definition, slots)])),
          },
          notAmongOptions: { type: "array", items: { enum: choices } },
        },
        required: ["values", "notAmongOptions"],
      },
    );
  },

  async choose(question, text, options) {
    const { value } = await ask<{ value: string | null }>(
      `We asked: "${question}"
Options: ${options.map((option, index) => `${index + 1}. "${option.value}" (${option.label})`).join(", ")}
Customer: "${text}"

Which option did the customer pick ("the second one", "the cheaper one")? null if none.`,
      {
        type: "object",
        properties: { value: { enum: [...options.map((option) => option.value), null] } },
        required: ["value"],
      },
    );
    return value;
  },

  async answer(text, step) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: `You are a shop's support. Answer briefly, only from these facts; say so if they don't cover the question.
${FAQ}${step ? `\n\nWe asked the customer: "${step.question}". Why we need it: ${step.help ?? "not stated"}` : ""}`,
      messages: [{ role: "user", content: text }],
    });
    return response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  },
};
```

What makes the NLU work well lives in the flows: a `description` for each flow tells `route` when it applies, a
`description` for each slot tells `extract` what to look for, and `help` gives `answer` the reason behind a question.
Business rules stay out of the prompts – the engine applies `validate` to whatever the LLM returns.

## Example: a keyword NLU for tests

Flows are tested without an LLM: a fake NLU that reacts to keywords makes every test fast and deterministic.

```ts
const has = (text: string, ...words: string[]) => words.some((word) => text.toLowerCase().includes(word));

const keywordNlu: Nlu = {
  async route(text) {
    return has(text, "return", "refund") ? "refund" : null;
  },
  async classifyTurn(_flowTitle, _question, text) {
    if (has(text, "cancel")) return "cancel";
    if (text.trim().endsWith("?")) return has(text, "why") ? "step_question" : "digression";
    return "answer";
  },
  async extract(_flow, wanted, _slots, text) {
    const values: Slots = {};
    for (const definition of wanted) {
      if (definition.name === "item" && has(text, "mug")) values.item = "mug";
      if (definition.name === "confirm" && has(text, "yes")) values.confirm = true;
      if (definition.name === "confirm" && has(text, "no")) values.confirm = false;
    }
    return { values, notAmongOptions: [] };
  },
  async choose() {
    return null;
  },
  async answer() {
    return "You can return items within 30 days.";
  },
};

test("a refund prefilled from the first message", async () => {
  const said: string[] = [];
  const engine = new FlowEngine({ flows: { refund }, nlu: keywordNlu, output: (text) => said.push(text) });

  await engine.handle("I want to return the mug");
  expect(said).toEqual(["Return the mug?"]);
});
```

## Engine options

```ts
const engine = new FlowEngine({
  flows,
  nlu,
  output: (text) => send(text), // everything the bot says
  onEvent: (event) => log(event), // optional: routing, turn types, extracted values, flows started and ended
  messages: { flowCancelled: (title) => `${title} zrušeno.` }, // optional: the engine's own texts, e.g. translated
});

await engine.handle(text); // one customer message
engine.snapshot(); // the flow stack as data: flow, step, the question it waits for, slots
```

The engine's own texts (not understood, flow parked, flow cancelled, back to…, the option list format) are in
`defaultMessages`; `messages` replaces any of them.

## Example: a chat in the terminal

The engine keeps the state of one conversation, so each conversation gets its own engine. A complete bot to try the
flows with the Claude NLU above:

```ts
import { createInterface } from "node:readline/promises";
import { FlowEngine } from "@gallas-ai/flow-engine";
import { claudeNlu } from "./nlu.ts";
import { refund } from "./flows.ts";

const engine = new FlowEngine({
  flows: { refund },
  nlu: claudeNlu,
  output: (text) => console.log(`bot: ${text}`),
  onEvent: (event) => console.debug(event), // shows what the NLU understood
});

const terminal = createInterface({ input: process.stdin, output: process.stdout });
while (true) {
  await engine.handle(await terminal.question("you: "));
}
```
