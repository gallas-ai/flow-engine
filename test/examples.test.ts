import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Flow, type Nlu } from "../src/index.ts";
import * as appointments from "../examples/appointments/actions.ts";
import { createFlows as createAppointmentFlows } from "../examples/appointments/flows.ts";
import { nlu as appointmentsNlu } from "../examples/appointments/nlu.ts";
import appointmentsSource from "../examples/appointments/flows.yaml?raw";
import { registry } from "../examples/verification/actions.ts";
import { verifyCustomer } from "../examples/verification/flows.ts";
import { nlu } from "../examples/verification/nlu.ts";
import source from "../examples/verification/flows.yaml?raw";

function createEngine(flows: Record<string, Flow>, engineNlu: Nlu = nlu) {
  const said: string[] = [];
  const engine = new FlowEngine({ flows, nlu: engineNlu, output: (text) => said.push(text) });
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

describe.each([
  ["YAML", (actions: appointments.Actions) => compileFlows(parse(appointmentsSource), appointments.registry(actions))],
  ["code", createAppointmentFlows],
])("examples/appointments in %s", (_, flows) => {
  const create = () => createEngine(flows(appointments.createActions()), appointmentsNlu);
  const NOT_FOUND = "I couldn't find a patient with this phone number.";

  it("books after the called verification and gives the caller the patient", async () => {
    const { engine, send } = create();
    expect(await send("book me in")).toEqual(["What is your phone number?"]);
    expect(engine.snapshot().map(({ flow, called }) => ({ flow, called }))).toEqual([
      { flow: "book_appointment", called: false },
      { flow: "verify_patient", called: true },
    ]);
    expect(await send("555-0100")).toEqual(["Thank you, Jane, you are verified.", "Which day would you like?"]);
    expect(engine.snapshot()[0]!.slots).toMatchObject({ patient_id: "P-17", patient_name: "Jane" });
  });

  it("takes the day from the answer that ends the verification", async () => {
    const { send } = create();
    await send("book me in");
    expect(await send("555-0100, Friday please")).toEqual(["Thank you, Jane, you are verified.", "Done: you're booked for Friday."]);
  });

  it("keeps the day when the verification turns the number down", async () => {
    const { send } = create();
    await send("book me in");
    expect(await send("555-0199, Friday please")).toEqual([NOT_FOUND, "What is your phone number?"]);
    expect(await send("555-0100")).toEqual(["Thank you, Jane, you are verified.", "Done: you're booked for Friday."]);
  });

  it("ends the caller when the verification gives up", async () => {
    const { engine, send } = create();
    await send("book me in");
    expect(await send("555-0199")).toEqual([NOT_FOUND, "What is your phone number?"]);
    expect(await send("555-0198")).toEqual([NOT_FOUND, "Sorry, I couldn't verify you. Please call the front desk."]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("doesn't verify again later in the same conversation", async () => {
    const { send } = create();
    await send("book me in, 555-0100, Tuesday");
    expect(await send("cancel my appointment")).toEqual(["Your appointment on Tuesday is cancelled."]);
  });
});

describe("call and if: False", () => {
  const compileWith = (change: (flows: any) => void) => () => {
    const data = parse(appointmentsSource);
    change(data.flows);
    return new FlowEngine({ flows: compileFlows(data, appointments.registry(appointments.createActions())), nlu: appointmentsNlu, output: () => {} });
  };

  it("are checked when the YAML compiles and the engine is created", () => {
    expect(compileWith((flows) => (flows.verify_patient.if = "slots.phone is null"))).toThrow(
      "flows.verify_patient.if: only `if: False` is supported (the flow is started only by call or link)",
    );
    expect(compileWith((flows) => (flows.book_appointment.steps[0].call = ""))).toThrow("flows.book_appointment.steps[0].call: must be a non-empty string");
    expect(compileWith((flows) => (flows.book_appointment.steps[0].call = "verify"))).toThrow("Flow book_appointment: calls unknown flow verify");
    expect(compileWith((flows) => flows.verify_patient.steps.push({ link: "cancel_appointment" }))).toThrow(
      "Flow book_appointment: calls verify_patient, which uses a link",
    );
    expect(compileWith((flows) => flows.verify_patient.steps.push({ call: "cancel_appointment" }))).toThrow(
      "Flow verify_patient: calls cancel_appointment, which leads back to verify_patient",
    );
  });

  it("hides a flow with if: False from routing", () => {
    expect(compileFlows(parse(appointmentsSource), appointments.registry(appointments.createActions())).verify_patient!.routable).toBe(false);
  });
});
