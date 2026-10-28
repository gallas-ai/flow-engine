import { beforeEach, describe, expect, it } from "vitest";
import { FlowEngine, NO, YES, type Flow, type FlowEngineEvent, type Messages, type Nlu, type Option, type Slots } from "../src/index.ts";

// ───────────────────────── test flows: a small shop ─────────────────────────

const MUG: Option = { value: "mug", label: "Mug" };
const OLD_MUG: Option = { value: "old-mug", label: "Old mug" };

let deliveredItems: Option[] = [];

const confirmSlot = (summary: (slots: Slots) => string) => ({
  name: "confirm",
  type: "yesno" as const,
  description: "consent to submit",
  question: (slots: Slots) => `${summary(slots)} Submit?`,
  prefill: false,
});

const refund: Flow = {
  name: "refund",
  title: "Refund",
  slots: [
    {
      name: "item",
      type: "choice",
      description: "the item to return",
      question: () => "What do you want to return?",
      options: () => deliveredItems,
      notAvailable: "That item can't be returned.",
      noOptions: "Nothing to return.",
      validate: (value) => (value === OLD_MUG.value ? "Too old to return." : null),
    },
    {
      name: "reason",
      type: "choice",
      description: "why",
      question: () => "Why are you returning it?",
      help: "Broken items are complaints.",
      options: () => [
        { value: "unwanted", label: "don't want it" },
        { value: "broken", label: "it's broken" },
      ],
    },
    confirmSlot((slots) => `Returning ${slots.item}.`),
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { kind: "collect", slot: "reason" },
    { kind: "goto", to: "complaint", when: (slots) => slots.reason === "broken" },
    { kind: "collect", slot: "confirm" },
    { kind: "goto", to: "cancelled", when: (slots) => slots.confirm === NO },
    { kind: "action", run: (slots) => `Refund created for ${slots.item}.` },
    { kind: "end" },
    { id: "complaint", kind: "link", flow: "complaint", carry: ["item"], message: "Switching to a complaint." },
    { id: "cancelled", kind: "say", text: () => "Nothing submitted." },
  ],
};

const complaint: Flow = {
  name: "complaint",
  title: "Complaint",
  slots: [
    { name: "item", type: "choice", description: "the broken item", question: () => "Which item?", options: () => deliveredItems },
    { name: "defect", type: "text", description: "what is wrong", question: (slots) => `What is wrong with the ${slots.item}?` },
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { kind: "collect", slot: "defect" },
    { kind: "action", run: (slots) => `Complaint filed: ${slots.item} – ${slots.defect}.` },
  ],
};

const address: Flow = {
  name: "address",
  title: "Address change",
  slots: [{ name: "address", type: "text", description: "new address", question: () => "What is the new address?" }],
  steps: [
    { kind: "collect", slot: "address" },
    { kind: "action", run: (slots) => `Address changed to ${slots.address}.` },
  ],
};

// ───────────────────────── a fake keyword NLU ─────────────────────────

const has = (text: string, ...words: string[]) => words.some((word) => text.toLowerCase().includes(word));

const keywordNlu: Nlu = {
  async route(text) {
    if (has(text, "refund", "return")) return "refund";
    if (has(text, "address")) return "address";
    return null;
  },
  async classifyTurn(_flowTitle, _question, text) {
    if (has(text, "cancel")) return "cancel";
    if (has(text, "address")) return "task_switch";
    if (text.trim().endsWith("?")) return has(text, "why") ? "step_question" : "digression";
    return "answer";
  },
  async extract(_flow, wanted, _slots, text) {
    const values: Slots = {};
    const notAmongOptions: string[] = [];
    for (const definition of wanted) {
      if (definition.name === "item") {
        if (has(text, "old mug")) values.item = OLD_MUG.value;
        else if (has(text, "mug")) values.item = MUG.value;
        else if (has(text, "teapot")) notAmongOptions.push("item");
      }
      if (definition.name === "reason" && has(text, "broken")) values.reason = "broken";
      if (definition.name === "reason" && has(text, "unwanted")) values.reason = "unwanted";
      if (definition.name === "confirm" && has(text, "yes")) values.confirm = YES;
      if (definition.name === "confirm" && has(text, "nope")) values.confirm = NO;
      if (definition.name === "confirm" && has(text, "ano")) values.confirm = "ano";
      if (definition.name === "defect" && has(text, "leaks")) values.defect = "leaks";
      if (definition.name === "address" && /\d/.test(text)) values.address = text;
    }
    return { values, notAmongOptions };
  },
  async choose() {
    return null;
  },
  async answer(text, step) {
    return step ? `Help: ${step.help}` : `Answer: ${text}`;
  },
};

// ───────────────────────── harness ─────────────────────────

function createEngine(messages?: Partial<Messages>) {
  const said: string[] = [];
  const events: FlowEngineEvent[] = [];
  const engine = new FlowEngine({
    flows: { refund, complaint, address },
    nlu: keywordNlu,
    output: (text) => said.push(text),
    onEvent: (event) => events.push(event),
    messages,
  });
  /** Sends a message and returns what the engine said in reply. */
  const send = async (text: string) => {
    const before = said.length;
    await engine.handle(text);
    return said.slice(before);
  };
  return { engine, send, events };
}

beforeEach(() => {
  deliveredItems = [MUG, OLD_MUG];
});

// ───────────────────────── tests ─────────────────────────

describe("collecting slots", () => {
  it("walks a flow step by step and runs its action", async () => {
    const { engine, send } = createEngine();
    expect(await send("I want a refund")).toEqual(["What do you want to return?\n   1) Mug\n   2) Old mug"]);
    expect(await send("the mug")).toEqual(["Why are you returning it?\n   1) don't want it\n   2) it's broken"]);
    expect(await send("unwanted")).toEqual(["Returning mug. Submit?"]);
    expect(await send("yes")).toEqual(["Refund created for mug."]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("answers messages that start no flow", async () => {
    const { send, events } = createEngine();
    expect(await send("hello")).toEqual(["Answer: hello"]);
    expect(events).toEqual([{ type: "routed", flow: null }]);
  });

  it("follows a goto when its condition holds", async () => {
    const { send } = createEngine();
    await send("return the mug, unwanted");
    expect(await send("nope")).toEqual(["Nothing submitted."]);
  });
});

describe("prefill", () => {
  it("skips steps answered in the opening message", async () => {
    const { send, events } = createEngine();
    expect(await send("refund the mug, unwanted")).toEqual(["Returning mug. Submit?"]);
    expect(events).toContainEqual({ type: "slotsPrefilled", values: { item: "mug", reason: "unwanted" }, notAmongOptions: [] });
  });

  it("never prefills a slot with prefill: false", async () => {
    const { engine, send } = createEngine();
    expect(await send("refund the mug, unwanted, yes")).toEqual(["Returning mug. Submit?"]);
    expect(engine.snapshot()[0]!.slots).not.toHaveProperty("confirm");
  });

  it("validates prefilled values too", async () => {
    const { send } = createEngine();
    expect(await send("refund the old mug")).toEqual(["Too old to return.", "What do you want to return?\n   1) Mug\n   2) Old mug"]);
  });
});

describe("options", () => {
  it("picks the only option without asking", async () => {
    deliveredItems = [MUG];
    const { send } = createEngine();
    expect(await send("I want a refund")).toEqual(["(Mug)", "Why are you returning it?\n   1) don't want it\n   2) it's broken"]);
  });

  it("asks instead of auto-selecting after the user named something not among the options", async () => {
    deliveredItems = [MUG];
    const { send } = createEngine();
    expect(await send("refund the teapot")).toEqual(["That item can't be returned.", "What do you want to return?\n   1) Mug"]);
  });

  it("ends the flow when there are no options", async () => {
    deliveredItems = [];
    const { engine, send } = createEngine();
    expect(await send("I want a refund")).toEqual(["Nothing to return."]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("rejects yes/no values other than YES and NO", async () => {
    const { send } = createEngine();
    await send("refund the mug, unwanted");
    expect(await send("ano")).toEqual(["Sorry, I didn't quite get that.", "Returning mug. Submit?"]);
  });
});

describe("turns", () => {
  it("answers a digression and returns to the waiting question", async () => {
    const { send } = createEngine();
    await send("refund the mug");
    expect(await send("what are your opening hours?")).toEqual([
      "Answer: what are your opening hours?",
      "Back to Refund: Why are you returning it?\n   1) don't want it\n   2) it's broken",
    ]);
  });

  it("answers a question about the step with the step's help", async () => {
    const { send } = createEngine();
    await send("refund the mug");
    expect((await send("why do you need it?"))[0]).toBe("Help: Broken items are complaints.");
  });

  it("parks the flow on a task switch and resumes it afterwards", async () => {
    const { engine, send } = createEngine();
    await send("refund the mug");
    expect(await send("wait, change my address")).toEqual([`OK, I'll put "Refund" aside for now.`, "What is the new address?"]);
    expect(engine.snapshot().map((frame) => frame.flow)).toEqual(["refund", "address"]);
    expect(await send("Main Street 8")).toEqual([
      "Address changed to Main Street 8.",
      "Back to Refund: Why are you returning it?\n   1) don't want it\n   2) it's broken",
    ]);
  });

  it("cancels the current flow", async () => {
    const { engine, send } = createEngine();
    await send("refund the mug");
    expect(await send("cancel it")).toEqual([`Understood, "Refund" is cancelled.`]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("escalates after the second answer it can't use", async () => {
    const { send } = createEngine();
    await send("refund the mug");
    expect((await send("hmm"))[0]).toBe("Sorry, I didn't quite get that.");
    expect((await send("whatever"))[0]).toBe("We still don't understand each other. Try a simple answer, or ask for a human.");
  });
});

describe("link", () => {
  it("replaces the flow and carries the listed slots over", async () => {
    const { engine, send, events } = createEngine();
    expect(await send("return the mug, it's broken")).toEqual(["Switching to a complaint.", "What is wrong with the mug?"]);
    expect(events).toContainEqual({ type: "flowStarted", flow: "complaint", title: "Complaint", carried: ["item"] });
    expect(engine.snapshot()).toEqual([{ flow: "complaint", title: "Complaint", step: 1, waitingFor: "defect", slots: { item: "mug" } }]);
    expect(await send("it leaks")).toEqual(["Complaint filed: mug – leaks."]);
  });
});

describe("messages", () => {
  it("lets the caller override the engine's own texts", async () => {
    const { send } = createEngine({ flowCancelled: (flowTitle) => `${flowTitle} zrušeno.` });
    await send("refund the mug");
    expect(await send("cancel")).toEqual(["Refund zrušeno."]);
  });
});
