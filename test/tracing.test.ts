import { describe, expect, it } from "vitest";
import { FlowEngine, type Flow, type FlowEngineOptions, type Nlu, type Slots, type Tracer, type TracerSpan } from "../src/index.ts";

// ───────────────────────── a small shop ─────────────────────────

async function placeOrder(slots: Slots) {
  return { say: `Ordered ${slots.item}.` };
}

const order: Flow = {
  name: "order",
  title: "Order",
  slots: [
    { name: "item", type: "text", description: "what to order", question: () => "What would you like?" },
    { name: "confirm", type: "bool", description: "consent to order", question: (slots) => `Order ${slots.item}?`, prefill: false },
  ],
  steps: [
    { kind: "collect", slot: "item" },
    { id: "ask_confirm", kind: "collect", slot: "confirm" },
    { kind: "action", run: placeOrder },
  ],
};

const gift: Flow = {
  name: "gift",
  title: "Gift",
  slots: [],
  steps: [{ kind: "call", flow: "order" }],
};

const reorder: Flow = {
  name: "reorder",
  title: "Reorder",
  slots: [],
  steps: [{ kind: "link", flow: "order", carry: [] }],
};

async function checkEmail(slots: Slots) {
  return slots.email === "jane@example.com" ? {} : { setSlots: { email: null }, say: "We don't know that e-mail." };
}

const account: Flow = {
  name: "account",
  title: "Account",
  slots: [{ name: "email", type: "text", description: "the customer's e-mail", question: () => "What is your e-mail?" }],
  steps: [{ kind: "collect", slot: "email", verify: checkEmail }],
};

const has = (text: string, ...words: string[]) => words.some((word) => text.toLowerCase().includes(word));

const nlu: Nlu = {
  async route(text) {
    if (has(text, "gift")) return "gift";
    if (has(text, "again")) return "reorder";
    if (has(text, "account")) return "account";
    return has(text, "order") ? "order" : null;
  },
  async classifyTurn(_flowTitle, _question, text) {
    return has(text, "cancel") ? "cancel" : "answer";
  },
  async extract(_flow, wanted, _slots, text) {
    const values: Slots = {};
    for (const { name } of wanted) {
      if (name === "item" && has(text, "tea")) values.item = "tea";
      if (name === "confirm" && has(text, "yes")) values.confirm = true;
      if (name === "email" && text.includes("@")) values.email = text;
    }
    return { values, notAmongOptions: [] };
  },
  async choose() {
    return null;
  },
  async answer(text) {
    return `Answer: ${text}`;
  },
};

// ───────────────────────── a tracer that records spans ─────────────────────────

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes?: Record<string, unknown> }[];
  status?: { code: number; message?: string };
  exceptions: unknown[];
  children: RecordedSpan[];
  ended: boolean;
};

/** The parent of a new span is the innermost span not ended yet, like the active span in OpenTelemetry. */
function recordingTracer() {
  const roots: RecordedSpan[] = [];
  const open: RecordedSpan[] = [];
  const tracer: Tracer = {
    startActiveSpan(name, fn) {
      const recorded: RecordedSpan = { name, attributes: {}, events: [], exceptions: [], children: [], ended: false };
      (open.at(-1)?.children ?? roots).push(recorded);
      open.push(recorded);
      const span: TracerSpan = {
        setAttribute(key, value) {
          recorded.attributes[key] = value;
        },
        addEvent(name, attributes) {
          recorded.events.push({ name, attributes });
        },
        recordException(exception) {
          recorded.exceptions.push(exception);
        },
        setStatus(status) {
          recorded.status = status;
        },
        end() {
          recorded.ended = true;
          open.splice(open.indexOf(recorded), 1);
        },
      };
      return fn(span) as ReturnType<typeof fn>;
    },
  };
  return { tracer, roots };
}

/** The span tree as indented lines; a step span shows its kind. */
function outline(spans: RecordedSpan[], depth = 0): string[] {
  return spans.flatMap((span) => [
    `${"  ".repeat(depth)}${span.name}${span.attributes["flow_engine.step_kind"] ? ` ${span.attributes["flow_engine.step_kind"]}` : ""}`,
    ...outline(span.children, depth + 1),
  ]);
}

function allSpans(spans: RecordedSpan[]): RecordedSpan[] {
  return spans.flatMap((span) => [span, ...allSpans(span.children)]);
}

function createEngine(options: Partial<FlowEngineOptions> = {}) {
  const { tracer, roots } = recordingTracer();
  const said: string[] = [];
  const engine = new FlowEngine({ flows: { order, gift, reorder, account }, nlu, output: (text) => said.push(text), tracer, ...options });
  /** Sends a message and returns the span it was traced in. */
  const send = async (text: string) => {
    await engine.handle(text);
    return roots.at(-1)!;
  };
  return { engine, send, roots, said };
}

// ───────────────────────── tests ─────────────────────────

describe("tracing", () => {
  it("traces each message as one span with the NLU calls and the steps under it", async () => {
    const { send } = createEngine();
    expect(outline([await send("I want to order tea")])).toEqual([
      "FlowEngine.handle",
      "  Nlu.route",
      "  FlowEngine.fill",
      "    Nlu.extract",
      "  FlowEngine.run_step collect",
      "  FlowEngine.run_step collect",
    ]);
    expect(outline([await send("yes")])).toEqual([
      "FlowEngine.handle",
      "  Nlu.classifyTurn",
      "  FlowEngine.fill",
      "    Nlu.extract",
      "  FlowEngine.run_step collect",
      "  FlowEngine.run_step action",
      "    action",
      "  FlowEngine.run_step end",
    ]);
  });

  it("names the flow, the slot it waits for, the turn type and each step", async () => {
    const { send } = createEngine();
    const opening = await send("I want to order tea");
    expect(opening.attributes).toEqual({ "flow_engine.stack_depth": 0, "flow_engine.routed_flow": "order" });
    const [route, , skipped, asked] = opening.children;
    expect(route!.attributes).toEqual({ "flow_engine.flow_count": 4 });
    expect(skipped!.attributes).toEqual({
      "flow_engine.step_kind": "collect",
      "flow_engine.current_flow_id": "order",
      "flow_engine.step_index": 0,
      "flow_engine.slot": "item",
      "flow_engine.skipped": true,
    });
    expect(asked!.attributes).toEqual({
      "flow_engine.step_kind": "collect",
      "flow_engine.current_flow_id": "order",
      "flow_engine.step_index": 1,
      "flow_engine.step_custom_id": "ask_confirm",
      "flow_engine.slot": "confirm",
      "flow_engine.skipped": false,
    });

    const answer = await send("yes");
    expect(answer.attributes).toEqual({
      "flow_engine.current_flow_id": "order",
      "flow_engine.waiting_for": "confirm",
      "flow_engine.stack_depth": 1,
      "flow_engine.turn_type": "answer",
    });
    const [classify, fill, , action, end] = answer.children;
    expect(classify!.attributes).toEqual({ "flow_engine.current_flow_id": "order" });
    expect(fill!.attributes).toEqual({ "flow_engine.current_flow_id": "order", "flow_engine.prefill": false, "flow_engine.filled": ["confirm"] });
    expect(fill!.children[0]!.attributes).toEqual({ "flow_engine.current_flow_id": "order", "flow_engine.wanted": ["confirm"] });
    expect(action!.children[0]!.attributes).toEqual({ "flow_engine.action_name": "placeOrder" });
    expect(end!.attributes).toEqual({ "flow_engine.step_kind": "end", "flow_engine.current_flow_id": "order", "flow_engine.step_index": 3 });
  });

  it("names the flow a call or a link goes to", async () => {
    const { send } = createEngine();
    const call = (await send("a gift")).children.find((span) => span.attributes["flow_engine.step_kind"] === "call");
    expect(call!.attributes).toMatchObject({ "flow_engine.current_flow_id": "gift", "flow_engine.target_flow": "order" });

    const { send: sendAgain } = createEngine();
    const link = (await sendAgain("the same again")).children.find((span) => span.attributes["flow_engine.step_kind"] === "link");
    expect(link!.attributes).toMatchObject({ "flow_engine.current_flow_id": "reorder", "flow_engine.target_flow": "order" });
  });

  it("records no customer text, bot lines or slot values by default", async () => {
    const { send, roots } = createEngine();
    await send("I want to order tea");
    const answer = await send("yes");
    for (const span of allSpans(roots)) {
      expect(Object.keys(span.attributes).filter((key) => key === "flow_engine.input" || key === "flow_engine.output")).toEqual([]);
    }
    expect(answer.children[3]!.children[0]!.events).toEqual([{ name: "output", attributes: undefined }]);
  });

  it("records them with recordContent", async () => {
    const { send } = createEngine({ recordContent: true });
    await send("I want to order tea");
    const answer = await send("yes");
    expect(answer.attributes).toMatchObject({ "flow_engine.input": '"yes"', "flow_engine.output": '["Ordered tea."]' });
    const [, fill, , step] = answer.children;
    expect(fill!.attributes).toMatchObject({ "flow_engine.output": '{"confirm":true}' });
    expect(fill!.children[0]!.attributes).toMatchObject({
      "flow_engine.input": '{"flow":"order","wanted":["confirm"],"slots":{"item":"tea"},"text":"yes","question":"Order tea?"}',
      "flow_engine.output": '{"values":{"confirm":true},"notAmongOptions":[]}',
    });
    const action = step!.children[0]!;
    expect(action.attributes).toMatchObject({ "flow_engine.input": '{"item":"tea","confirm":true}', "flow_engine.output": '{"say":"Ordered tea."}' });
    expect(action.events).toEqual([{ name: "output", attributes: { "flow_engine.text": "Ordered tea." } }]);
  });

  it("puts traceAttributes on the span of each message, not on the spans under it", async () => {
    const { send } = createEngine({ traceAttributes: { "session.id": "c-42" } });
    const opening = await send("I want to order tea");
    expect(opening.attributes).toMatchObject({ "session.id": "c-42" });
    for (const span of allSpans(opening.children)) expect(span.attributes).not.toHaveProperty("session.id");
  });

  it("traces a flow started from code as a span of its own", async () => {
    const { engine, roots } = createEngine({ recordContent: true, traceAttributes: { "session.id": "c-42" } });
    await engine.start("order", undefined, { item: "tea" });
    expect(outline(roots)).toEqual(["FlowEngine.start", "  FlowEngine.run_step collect", "  FlowEngine.run_step collect"]);
    expect(roots[0]!.attributes).toEqual({
      "session.id": "c-42",
      "flow_engine.current_flow_id": "order",
      "flow_engine.input": '{"carried":{"item":"tea"}}',
      "flow_engine.output": '["Order tea?"]',
    });
  });

  it("adds the engine's events to the span they happen in, with slot values only with recordContent", async () => {
    const { send } = createEngine();
    const opening = await send("I want to order tea");
    expect(opening.events).toEqual([
      { name: "routed", attributes: { "flow_engine.flow": "order" } },
      { name: "flowStarted", attributes: { "flow_engine.flow": "order", "flow_engine.title": "Order", "flow_engine.carried": [], "flow_engine.called": false } },
    ]);
    expect(opening.children[1]!.events).toEqual([{ name: "slotsPrefilled", attributes: { "flow_engine.slots": ["item"], "flow_engine.not_among_options": [] } }]);
    const answer = await send("yes");
    expect(answer.events).toEqual([{ name: "turnClassified", attributes: { "flow_engine.turn_type": "answer" } }]);
    expect(answer.children.at(-1)!.events).toEqual([{ name: "flowEnded", attributes: { "flow_engine.flow": "order", "flow_engine.title": "Order" } }]);

    const { send: sendWithContent } = createEngine({ recordContent: true });
    const [, fill] = (await sendWithContent("I want to order tea")).children;
    expect(fill!.events[0]!.attributes).toMatchObject({ "flow_engine.values": '{"item":"tea"}' });
  });

  it("still passes every event to onEvent", async () => {
    const events: string[] = [];
    const { send } = createEngine({ onEvent: (event) => events.push(event.type) });
    await send("I want to order tea");
    expect(events).toEqual(["routed", "flowStarted", "slotsPrefilled"]);
  });

  it("marks the spans an error passes through and lets the error go on", async () => {
    const failure = new Error("LLM down");
    const { send, roots } = createEngine({ nlu: { ...nlu, extract: () => Promise.reject(failure) } });
    await expect(send("I want to order tea")).rejects.toBe(failure);
    const [root] = roots;
    const fill = root!.children[1]!;
    for (const span of [root!, fill, fill.children[0]!]) {
      expect(span.status).toEqual({ code: 2, message: "LLM down" });
      expect(span.exceptions).toEqual([failure]);
    }
    expect(root!.children[0]!.status).toBeUndefined();
    for (const span of allSpans(roots)) expect(span.ended).toBe(true);
  });

  it("traces a collect step's verify and whether it accepted the value", async () => {
    const { send } = createEngine({ recordContent: true });
    await send("my account");
    const turnedDown = await send("joe@example.com");
    expect(outline([turnedDown])).toEqual([
      "FlowEngine.handle",
      "  Nlu.classifyTurn",
      "  FlowEngine.fill",
      "    Nlu.extract",
      "  FlowEngine.run_step collect",
      "    verify",
    ]);
    const verify = turnedDown.children[2]!.children[0]!;
    expect(verify.attributes).toEqual({
      "flow_engine.action_name": "checkEmail",
      "flow_engine.slot": "email",
      "flow_engine.accepted": false,
      "flow_engine.input": '{"email":"joe@example.com"}',
      "flow_engine.output": '{"setSlots":{"email":null},"say":"We don\'t know that e-mail."}',
    });
    const accepted = await send("jane@example.com");
    expect(accepted.children[2]!.children[0]!.attributes).toMatchObject({ "flow_engine.accepted": true });
  });
});
