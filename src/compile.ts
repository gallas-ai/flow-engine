// YAML flows: a subset of Rasa's flow syntax, compiled to the same `Flow` objects you would write in code.
//
// The compiler takes already parsed data (YAML, JSON – parse it with any library), so the package stays
// dependency-free. Everything YAML can't express – actions, dynamic options – is looked up by name in a registry.
// Every reference is checked here, with the path to the broken spot, because YAML has no type checker.
import { parseCondition } from "./condition.ts";
import { END } from "./types.ts";
import type { Action, Flow, Option, SlotDefinition, SlotValue, Slots, Step } from "./types.ts";

/** The code that YAML flows refer to by name. */
export type FlowRegistry = {
  /** `action: <name>` steps (names starting with `utter_` are responses instead). */
  actions?: Record<string, Action>;
  /** `options: <name>` of choice slots. */
  options?: Record<string, (slots: Slots) => Option[]>;
};

type Data = Record<string, unknown>;
type SlotDeclaration = Pick<SlotDefinition, "type" | "options" | "help" | "notAvailable" | "noOptions">;

const SLOT_TYPES = ["text", "bool", "number", "choice"] as const;
const STEP_KINDS = ["collect", "action", "set_slots", "link", "noop"] as const;
const STEP_KEYS: Record<(typeof STEP_KINDS)[number], string[]> = {
  collect: ["collect", "description", "ask_before_filling", "rejections", "utter"],
  action: ["action"],
  set_slots: ["set_slots"],
  link: ["link"],
  noop: ["noop"],
};

/**
 * Compiles `{ flows, slots?, responses? }` – e.g. a parsed YAML file – to flows for `FlowEngine`.
 * Throws an error naming the path of the first problem, e.g. `flows.vraceni.steps[3].next: unknown step "ask_refnd"`.
 */
export function compileFlows(data: unknown, registry: FlowRegistry = {}): Record<string, Flow> {
  const root = object(data, "(root)", ["flows", "slots", "responses"]);
  const responses = Object.fromEntries(
    Object.entries(object(root.responses ?? {}, "responses")).map(([name, text]) => [name, string(text, `responses.${name}`)]),
  );
  const slots = Object.fromEntries(
    Object.entries(object(root.slots ?? {}, "slots")).map(([name, value]) => [name, slotDeclaration(value, `slots.${name}`, registry)]),
  );
  return Object.fromEntries(
    Object.entries(object(root.flows, "flows")).map(([name, value]) => [
      name,
      new FlowCompiler(name, `flows.${name}`, responses, slots, registry).compile(value),
    ]),
  );
}

/** A response text; `{slot}` is replaced with the slot's value (empty when it isn't set). */
function template(text: string): (slots: Slots) => string {
  return (slots) => text.replace(/\{(\w+)\}/g, (_, name: string) => (name in slots ? String(slots[name]) : ""));
}

function slotDeclaration(value: unknown, path: string, registry: FlowRegistry): SlotDeclaration {
  const data = object(value, path, ["type", "options", "help", "not_available", "no_options"]);
  const type = data.type ?? "text";
  if (!SLOT_TYPES.includes(type as never)) fail(`${path}.type`, `must be one of ${SLOT_TYPES.join(", ")}`);
  if ((type === "choice") !== ("options" in data)) fail(path, "a choice slot needs options, and only a choice slot has them");
  return {
    type: type as SlotDeclaration["type"],
    options: data.options === undefined ? undefined : options(data.options, `${path}.options`, registry),
    help: optionalString(data.help, `${path}.help`),
    notAvailable: optionalString(data.not_available, `${path}.not_available`),
    noOptions: optionalString(data.no_options, `${path}.no_options`),
  };
}

function options(value: unknown, path: string, registry: FlowRegistry): (slots: Slots) => Option[] {
  if (typeof value === "string") return registry.options?.[value] ?? fail(path, `unknown options "${value}" – add it to registry.options`);
  const list = array(value, path).map((item, i): Option => {
    if (typeof item === "string") return { value: item, label: item };
    const option = object(item, `${path}[${i}]`, ["value", "label"]);
    return { value: string(option.value, `${path}[${i}].value`), label: string(option.label, `${path}[${i}].label`) };
  });
  return () => list;
}

/** One flow; nested `then` branches are flattened into extra steps placed after the main ones and wired with `goto`. */
class FlowCompiler {
  private readonly steps: Step[] = [];
  private readonly slots = new Map<string, SlotDefinition>();
  private readonly branches: { steps: unknown; path: string; label: string }[] = [];
  private readonly targets: { to: string; path: string }[] = [];
  private readonly ids = new Set<string>();
  private carry: string[] = [];
  private generated = 0;

  constructor(
    private readonly name: string,
    private readonly path: string,
    private readonly responses: Record<string, string>,
    private readonly declarations: Record<string, SlotDeclaration>,
    private readonly registry: FlowRegistry,
  ) {}

  compile(value: unknown): Flow {
    const data = object(value, this.path, ["name", "description", "persisted_slots", "steps"]);
    this.carry = array(data.persisted_slots ?? [], `${this.path}.persisted_slots`).map((slot, i) => string(slot, `${this.path}.persisted_slots[${i}]`));
    this.compileList(data.steps, `${this.path}.steps`);
    for (let branch; (branch = this.branches.shift()); ) this.compileList(branch.steps, branch.path, branch.label);
    for (const { to, path } of this.targets) {
      if (to !== END && !this.ids.has(to)) fail(path, `unknown step "${to}"`);
    }
    return {
      name: this.name,
      title: optionalString(data.name, `${this.path}.name`) ?? this.name,
      description: optionalString(data.description, `${this.path}.description`),
      slots: [...this.slots.values()],
      steps: this.steps,
    };
  }

  /** Steps run in order; at the end of the list the flow ends (Rasa: a branch without `next` ends the flow). */
  private compileList(value: unknown, path: string, label?: string): void {
    const items = array(value, path);
    if (!items.length) fail(path, "has no steps");
    items.forEach((item, i) => this.compileStep(item, `${path}[${i}]`, i === 0 ? label : undefined, i === items.length - 1));
    this.steps.push({ kind: "end" });
  }

  private compileStep(value: unknown, path: string, label: string | undefined, last: boolean): void {
    const data = object(value, path);
    const kinds = STEP_KINDS.filter((kind) => kind in data);
    if (kinds.length !== 1) fail(path, `needs exactly one of ${STEP_KINDS.join(", ")}`);
    const kind = kinds[0]!;
    object(value, path, ["id", "next", ...STEP_KEYS[kind]]);

    const id = optionalString(data.id, `${path}.id`) ?? label;
    if (id !== undefined) {
      if (id === END) fail(`${path}.id`, `${END} is reserved`);
      if (this.ids.has(id)) fail(`${path}.id`, `step id "${id}" is used twice`);
      this.ids.add(id);
    }
    const first = this.steps.length;

    switch (kind) {
      case "collect":
        this.steps.push({ kind: "collect", slot: this.collect(data, path) });
        break;
      case "action": {
        const name = string(data.action, `${path}.action`);
        if (name.startsWith("utter_")) this.steps.push({ kind: "say", text: this.response(name, `${path}.action`) });
        else this.steps.push({ kind: "action", run: this.registry.actions?.[name] ?? fail(`${path}.action`, `unknown action "${name}" – add it to registry.actions`) });
        break;
      }
      case "set_slots": {
        const values: Record<string, SlotValue | null> = {};
        array(data.set_slots, `${path}.set_slots`).forEach((item, i) => {
          const entries = Object.entries(object(item, `${path}.set_slots[${i}]`));
          if (entries.length !== 1) fail(`${path}.set_slots[${i}]`, "must set exactly one slot, e.g. `- item: null`");
          const [slot, slotValue] = entries[0]!;
          if (slotValue !== null && !["string", "number", "boolean"].includes(typeof slotValue)) fail(`${path}.set_slots[${i}].${slot}`, "must be a string, number, boolean or null");
          values[slot] = slotValue as SlotValue | null;
        });
        this.steps.push({ kind: "set", values });
        break;
      }
      case "link":
        if (!last) fail(path, "a link must be the last step of its list");
        if ("next" in data) fail(`${path}.next`, "a link has no next – the linked flow takes over");
        this.steps.push({ kind: "link", flow: string(data.link, `${path}.link`), carry: this.carry });
        break;
      case "noop":
        if (data.noop !== true) fail(`${path}.noop`, "must be true");
        if (!("next" in data)) fail(path, "a noop step needs next");
        break;
    }

    if ("next" in data) this.compileNext(data.next, `${path}.next`);
    if (id !== undefined) this.steps[first]!.id = id;
  }

  /** Builds the slot definition from the first `collect` of the slot in this flow (description defaults to the slot name). */
  private collect(data: Data, path: string): string {
    const slot = string(data.collect, `${path}.collect`);
    if (data.ask_before_filling !== undefined && typeof data.ask_before_filling !== "boolean") fail(`${path}.ask_before_filling`, "must be true or false");
    const declaration = this.declarations[slot] ?? { type: "text" };
    const rejections = array(data.rejections ?? [], `${path}.rejections`).map((item, i) => {
      const rejection = object(item, `${path}.rejections[${i}]`, ["if", "utter"]);
      const holds = this.condition(rejection.if, `${path}.rejections[${i}].if`);
      return { holds, text: this.response(string(rejection.utter, `${path}.rejections[${i}].utter`), `${path}.rejections[${i}].utter`) };
    });
    const existing = this.slots.get(slot);
    if (existing) {
      if (data.ask_before_filling === true) existing.prefill = false;
      const validate = existing.validate;
      if (rejections.length) existing.validate = (value, slots) => validate?.(value, slots) ?? reject(rejections, slot, value, slots);
      return slot;
    }

    const utter = optionalString(data.utter, `${path}.utter`) ?? `utter_ask_${slot}`;
    this.slots.set(slot, {
      name: slot,
      description: optionalString(data.description, `${path}.description`) ?? slot,
      question: this.response(utter, data.utter === undefined ? `${path}.collect` : `${path}.utter`),
      ...declaration,
      validate: rejections.length ? (value, slots) => reject(rejections, slot, value, slots) : undefined,
      prefill: data.ask_before_filling === true ? false : undefined,
    });
    return slot;
  }

  /** `next: <step id>` or `next: [{ if, then }, …, { else }]`; `then` / `else` are a step id or a list of steps. */
  private compileNext(value: unknown, path: string): void {
    if (typeof value === "string") {
      this.goto(value, path);
      return;
    }
    const cases = array(value, path);
    cases.forEach((item, i) => {
      const casePath = `${path}[${i}]`;
      const data = object(item, casePath);
      if ("else" in data) {
        object(item, casePath, ["else"]);
        if (i !== cases.length - 1) fail(casePath, "else must be the last case");
        this.goto(this.branch(data.else, `${casePath}.else`), `${casePath}.else`);
      } else {
        object(item, casePath, ["if", "then"]);
        const when = this.condition(data.if, `${casePath}.if`);
        this.goto(this.branch(data.then, `${casePath}.then`), `${casePath}.then`, when);
      }
    });
  }

  /** The step a branch jumps to: a step id as is, or a list of steps queued for later under a label. */
  private branch(value: unknown, path: string): string {
    if (typeof value === "string") return value;
    const steps = array(value, path);
    const firstId = typeof steps[0] === "object" && steps[0] !== null ? (steps[0] as Data).id : undefined;
    const label = typeof firstId === "string" ? firstId : `#${++this.generated}`;
    this.branches.push({ steps, path, label });
    return label;
  }

  private goto(to: string, path: string, when?: (slots: Slots) => boolean): void {
    this.targets.push({ to, path });
    this.steps.push({ kind: "goto", to, when });
  }

  private condition(value: unknown, path: string): (slots: Slots) => boolean {
    try {
      return parseCondition(string(value, path));
    } catch (error) {
      return fail(path, (error as Error).message);
    }
  }

  private response(name: string, path: string): (slots: Slots) => string {
    const text = this.responses[name] ?? fail(path, `unknown response "${name}" – add it to responses`);
    return template(text);
  }
}

function reject(rejections: { holds: (slots: Slots) => boolean; text: (slots: Slots) => string }[], slot: string, value: SlotValue, slots: Slots): string | null {
  const candidate = { ...slots, [slot]: value };
  const rejection = rejections.find(({ holds }) => holds(candidate));
  return rejection ? rejection.text(candidate) : null;
}

// ───────────────────────── reading untyped data ─────────────────────────

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string, keys?: string[]): Data {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be a mapping");
  const unknown = keys && Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) fail(path, `unknown key "${unknown}" (allowed: ${keys.join(", ")})`);
  return value as Data;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be a list");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) fail(path, "must be a non-empty string");
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}
