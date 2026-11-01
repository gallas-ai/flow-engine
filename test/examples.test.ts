import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Flow, type Nlu, type Slots } from "../src/index.ts";
import { registry } from "../examples/verification/actions.ts";
import { verifyCustomer } from "../examples/verification/flows.ts";
import source from "../examples/verification/flows.yaml?raw";

// a fake NLU: the answer to the question is the e-mail, in an opening message only something with an @ is
const nlu: Nlu = {
  async route(text) {
    return /verify/i.test(text) ? "verify_customer" : null;
  },
  async classifyTurn() {
    return "answer";
  },
  async extract(_flow, wanted, _slots, text, question) {
    const values: Slots = {};
    if (wanted.some(({ name }) => name === "email")) {
      const email = question ? text.trim() : /\S+@\S+/.exec(text)?.[0];
      if (email) values.email = email;
    }
    return { values, notAmongOptions: [] };
  },
  async choose() {
    return null;
  },
  async answer(text) {
    return text;
  },
};

function createEngine(flows: Record<string, Flow>) {
  const said: string[] = [];
  const engine = new FlowEngine({ flows, nlu, output: (text) => said.push(text) });
  const send = async (text: string) => {
    const before = said.length;
    await engine.handle(text);
    return said.slice(before);
  };
  return { engine, send };
}

const ASK = "What is your e-mail address?";
const NOT_FOUND = "I couldn't verify this e-mail address.";
const FAILED = "Sorry, I couldn't verify you. Please contact our support.";
const VERIFIED = "Thank you, Jane, you are verified.";

describe.each([
  ["YAML", () => compileFlows(parse(source), registry)],
  ["code", () => ({ verify_customer: verifyCustomer })],
])("examples/verification in %s", (_, flows) => {
  it("verifies a known e-mail", async () => {
    const { engine, send } = createEngine(flows());
    expect(await send("I want to verify myself")).toEqual([ASK]);
    expect(await send("jane@example.com")).toEqual([VERIFIED]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("asks again after a failed attempt", async () => {
    const { send } = createEngine(flows());
    await send("I want to verify myself");
    expect(await send("peter@example.com")).toEqual([NOT_FOUND, ASK]);
    expect(await send("jane@example.com")).toEqual([VERIFIED]);
  });

  it("gives up after the second failed attempt", async () => {
    const { engine, send } = createEngine(flows());
    await send("I want to verify myself");
    await send("peter@example.com");
    expect(await send("paul@example.com")).toEqual([NOT_FOUND, FAILED]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("counts a rejected value as an attempt", async () => {
    const { send } = createEngine(flows());
    await send("I want to verify myself");
    expect(await send("no idea")).toEqual(["That doesn't look like an e-mail address.", ASK]);
    expect(await send("peter@example.com")).toEqual([NOT_FOUND, FAILED]);
  });

  it("verifies an e-mail from the opening message, and counts it", async () => {
    expect(await createEngine(flows()).send("verify me, jane@example.com")).toEqual([VERIFIED]);
    const { send } = createEngine(flows());
    expect(await send("verify me, peter@example.com")).toEqual([NOT_FOUND, ASK]);
    expect(await send("paul@example.com")).toEqual([NOT_FOUND, FAILED]);
  });
});

describe("verify, max_attempts and on_exhausted", () => {
  /** Compiles the example after `change` broke its collect step. */
  const compileBroken = (change: (step: any) => void) => () => {
    const data = parse(source);
    change(data.flows.verify_customer.steps[0]);
    return new FlowEngine({ flows: compileFlows(data, registry), nlu, output: () => {} });
  };

  it("are checked when the YAML compiles", () => {
    const path = "flows.verify_customer.steps[0]";
    expect(compileBroken((step) => (step.verify = "action_verify_mail"))).toThrow(`${path}.verify: unknown action "action_verify_mail"`);
    expect(compileBroken((step) => (step.verify = "utter_verified"))).toThrow(`${path}.verify: must be an action, not a response`);
    expect(compileBroken((step) => (step.max_attempts = 0))).toThrow(`${path}.max_attempts: must be a whole number of at least 1`);
    expect(compileBroken((step) => delete step.max_attempts)).toThrow(`${path}.on_exhausted: needs max_attempts`);
    expect(compileBroken((step) => (step.on_exhausted = "fail"))).toThrow(`${path}.on_exhausted: unknown step "fail"`);
  });

  it("are checked when the engine is created", () => {
    const withCollect = (patch: object) => () =>
      createEngine({ verify_customer: { ...verifyCustomer, steps: [{ kind: "collect", slot: "email", ...patch }] } });
    expect(withCollect({ maxAttempts: 1.5 })).toThrow("maxAttempts of email must be a whole number of at least 1");
    expect(withCollect({ onExhausted: "failed" })).toThrow("onExhausted of email needs maxAttempts");
    expect(withCollect({ maxAttempts: 2, onExhausted: "failed" })).toThrow("onExhausted to unknown step failed");
  });

  it("doesn't pick a single option again after it failed verification", async () => {
    const flow: Flow = {
      name: "verify_customer",
      title: "Verification",
      slots: [{ name: "email", type: "choice", description: "e-mail", question: () => ASK, options: () => [{ value: "a@b.com", label: "a@b.com" }] }],
      steps: [{ kind: "collect", slot: "email", verify: () => ({ setSlots: { email: null } }) }],
    };
    expect(await createEngine({ verify_customer: flow }).send("verify me")).toEqual(["(a@b.com)", `${ASK}\n   1) a@b.com`]);
  });
});
