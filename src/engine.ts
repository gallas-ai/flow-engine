// A small declarative flow engine.
//
// Key idea: the LLM is only the NLU ("what did the user say?"). WHAT HAPPENS NEXT is decided by
// this deterministic code following the flow definition. The engine doesn't import any LLM code –
// it gets an `Nlu` implementation injected, so it runs just as well with a fake keyword NLU in tests.
import { defaultMessages } from "./messages.ts";
import { END } from "./types.ts";
import type { Action, Flow, FlowEngineEvent, FlowSummary, FrameSnapshot, Messages, Nlu, SlotDefinition, SlotValue, Slots } from "./types.ts";

type Frame = {
  flow: Flow;
  step: number;
  slots: Slots;
  waitingFor?: string;
  attempts: number;
  /** Turned-down values per collect step (by step index) – for `maxAttempts`. */
  failures: Map<number, number>;
  noAutoSelect: Set<string>;
  /** Slots filled as the answer to their own question – a prefill: false slot is taken only from such an answer. */
  answered: Set<string>;
  /** Pushed by a `call` step: the frame below waits for it and gets its slots back. */
  called: boolean;
  /** Slots read for another flow and not checked yet: their own collect step does that. Shared along a call chain, like the slots. */
  unchecked: Set<string>;
};

export type FlowEngineOptions = {
  flows: Record<string, Flow>;
  nlu: Nlu;
  /** Receives everything the engine says to the user. */
  output: (text: string) => void;
  onEvent?: (event: FlowEngineEvent) => void;
  /** Overrides for the engine's own texts (e.g. a translation); the rest stays default. */
  messages?: Partial<Messages>;
};

export class FlowEngine {
  private readonly stack: Frame[] = [];
  private readonly flows: Record<string, Flow>;
  private readonly summaries: FlowSummary[];
  private readonly nlu: Nlu;
  private readonly output: (text: string) => void;
  private readonly emit: (event: FlowEngineEvent) => void;
  private readonly messages: Messages;

  constructor(options: FlowEngineOptions) {
    validateFlows(options.flows);
    this.flows = options.flows;
    this.summaries = Object.values(options.flows)
      .filter((flow) => flow.routable !== false)
      .map(({ name, title, description }) => ({ name, title, description }));
    this.nlu = options.nlu;
    this.output = options.output;
    this.emit = options.onEvent ?? (() => {});
    this.messages = { ...defaultMessages, ...options.messages };
  }

  private get top() { return this.stack.at(-1); }

  /** The top frame and the frames that called it, down to the flow the customer started (first). */
  private chain(): Frame[] {
    let start = this.stack.length - 1;
    while (this.stack[start]?.called) start--;
    return this.stack.slice(start);
  }

  /** `Nlu.route`, limited to the flows it may pick: a flow hidden from routing counts as no flow. */
  private async route(text: string): Promise<string | null> {
    const flow = await this.nlu.route(text, this.summaries);
    return flow !== null && this.flows[flow]?.routable === false ? null : flow;
  }

  // ───────────────────────── entry point ─────────────────────────

  async handle(text: string): Promise<void> {
    const frame = this.top;
    if (!frame?.waitingFor) {
      const flow = await this.route(text);
      this.emit({ type: "routed", flow });
      if (flow) return this.start(flow, text);
      return this.output(await this.nlu.answer(text));
    }

    const slot = this.slotDefinition(frame.flow, frame.waitingFor);
    const turnType = await this.nlu.classifyTurn(frame.flow.title, slot.question(frame.slots), text);
    this.emit({ type: "turnClassified", turnType });

    switch (turnType) {
      case "answer": {
        const { filled, reported } = await this.fill(frame, text, false);
        if (!filled.length && !reported) {
          this.output(++frame.attempts >= 2 ? this.messages.stillNotUnderstood() : this.messages.notUnderstood());
        }
        return this.advance(false);
      }
      case "step_question":
      case "digression":
        await this.fill(frame, text, false); // mixed turn: "Brazil, and how long does a refund take?"
        this.output(await this.nlu.answer(text, turnType === "step_question" ? { question: slot.question(frame.slots), help: slot.help } : undefined));
        return this.advance(true);
      case "task_switch": {
        const flow = await this.route(text);
        const chain = this.chain();
        if (flow && !chain.some((frame) => frame.flow.name === flow)) {
          this.output(this.messages.flowParked(chain[0]!.flow.title)); // the whole call chain waits
          if (!this.resumeParked(flow)) return this.start(flow, text);
          await this.fill(this.top!, text, true);
          return this.advance(true);
        }
        this.output(await this.nlu.answer(text));
        return this.advance(true);
      }
      case "cancel": {
        // cancelling a called flow (verification) cancels the task the customer started (booking)
        const [started] = this.chain();
        this.stack.splice(this.stack.indexOf(started!));
        this.handToParked(started!.flow, frame.slots);
        this.output(this.messages.flowCancelled(started!.flow.title));
        return this.advance(true);
      }
    }
  }

  async start(name: string, text?: string, carried: Slots = {}): Promise<void> {
    await this.push(name, carried, false, new Set(), text);
    return this.advance(false);
  }

  private async push(name: string, carried: Slots, called: boolean, unchecked: Set<string>, text?: string): Promise<void> {
    const flow = this.flows[name];
    if (!flow) throw new Error(`Unknown flow ${name}`);
    const frame: Frame = { flow, step: 0, slots: { ...carried }, attempts: 0, failures: new Map(), noAutoSelect: new Set(), answered: new Set(), called, unchecked };
    this.stack.push(frame);
    this.emit({ type: "flowStarted", flow: flow.name, title: flow.title, carried: Object.keys(carried), called });
    if (text) await this.fill(frame, text, true); // ← PREFILL from the opening message
  }

  // ───────────────────────── understanding → validated slots ─────────────────────────

  /**
   * The slots a message can fill: of the call chain and the flows it calls, even those not started yet.
   * With the same slot in several flows, the nearest flow that may take the value early describes it.
   */
  private wanted(frame: Frame, waiting: SlotDefinition | undefined, prefill: boolean): SlotDefinition[] {
    const flows = new Set<Flow>();
    const visit = (flow: Flow) => {
      if (flows.has(flow)) return;
      flows.add(flow);
      for (const step of flow.steps) if (step.kind === "call") visit(this.flows[step.flow]!);
    };
    for (const { flow } of this.chain().reverse()) visit(flow);

    const wanted = new Map<string, SlotDefinition>();
    for (const flow of flows) {
      for (const definition of flow.slots) {
        if (wanted.has(definition.name) || definition.name in frame.slots) continue;
        if (definition.prefill !== false || (!prefill && definition === waiting)) wanted.set(definition.name, definition);
      }
    }
    return [...wanted.values()];
  }

  /** Runs NLU over the message and stores every valid value it finds. */
  private async fill(frame: Frame, text: string, prefill: boolean): Promise<{ filled: string[]; reported: boolean }> {
    const waiting = frame.waitingFor ? this.slotDefinition(frame.flow, frame.waitingFor) : undefined;
    // the user may answer more than we asked ("Brazil, tastes bitter, to my account") → look for ALL open slots
    const wanted = this.wanted(frame, waiting, prefill);
    if (!wanted.length) return { filled: [], reported: false };

    const extraction = await this.nlu.extract(this.chain()[0]!.flow, wanted, frame.slots, text, waiting?.question(frame.slots));
    const values = { ...extraction.values };
    // the slot we asked about with several options → let the NLU pick one ("the one with the grinder", "number two")
    if (waiting?.type === "choice" && !prefill) {
      const options = waiting.options!(frame.slots);
      if (options.length > 1) {
        const chosen = await this.nlu.choose(waiting.question(frame.slots), text, options);
        if (chosen) values[waiting.name] = chosen;
      }
    }
    if (Object.keys(values).length || extraction.notAmongOptions.length) {
      this.emit({ type: prefill ? "slotsPrefilled" : "slotsExtracted", values, notAmongOptions: extraction.notAmongOptions });
    }

    const filled: string[] = [];
    let reported = false; // did we already tell the user what's wrong?
    for (const definition of wanted) {
      if (!frame.flow.slots.includes(definition)) {
        // another flow's slot: its collect step checks the value, so the customer doesn't hear about it mid-verification
        const value = values[definition.name];
        if (value === undefined || value === "" || (definition.type !== "choice" && !this.hasType(definition, value, frame.slots))) continue;
        frame.slots[definition.name] = value;
        frame.unchecked.add(definition.name);
        filled.push(definition.name);
        continue;
      }
      if (definition.type === "choice" && extraction.notAmongOptions.includes(definition.name) && !(definition.name in values)) {
        frame.noAutoSelect.add(definition.name);
        if (definition.notAvailable) {
          this.output(definition.notAvailable);
          reported = true;
        }
        continue;
      }
      const value = values[definition.name];
      if (value === undefined || value === "" || !this.hasType(definition, value, frame.slots)) continue;
      const error = definition.validate?.(value, frame.slots);
      if (error) {
        this.output(error);
        reported = true;
        frame.noAutoSelect.add(definition.name);
        if (definition === waiting && !prefill) countFailure(frame); // an answer to the question we asked counts as an attempt
        continue;
      }
      frame.slots[definition.name] = value;
      filled.push(definition.name);
    }
    if (waiting && filled.includes(waiting.name)) {
      frame.attempts = 0; // the next question starts with a clean count
      frame.answered.add(waiting.name);
    }
    return { filled, reported };
  }

  // ───────────────────────── the state machine ─────────────────────────

  /** Walk the steps until we need input from the user (or run out of flows). */
  private async advance(returning: boolean): Promise<void> {
    while (true) {
      const frame = this.top;
      if (!frame) return;
      const step = frame.flow.steps[frame.step];
      frame.waitingFor = undefined;

      if (!step || step.kind === "end") {
        this.stack.pop();
        this.emit({ type: "flowEnded", flow: frame.flow.name, title: frame.flow.title });
        if (frame.called) this.top!.slots = frame.slots; // the caller goes on with the next step, no "back to…" line
        else {
          this.handToParked(frame.flow, frame.slots);
          returning = true; // whatever is below gets a "back to…" line
        }
        continue;
      }

      switch (step.kind) {
        case "collect": {
          const definition = this.slotDefinition(frame.flow, step.slot);
          const answered = frame.answered.delete(step.slot);
          const unchecked = frame.unchecked.delete(step.slot);
          if (step.slot in frame.slots) {
            if (definition.prefill !== false || answered) {
              if ((!unchecked || this.check(frame, definition)) && (!step.verify || (await this.verify(frame, step.verify, step.slot)))) { // ← prefilled = step skipped
                frame.failures.delete(frame.step);
                frame.step++;
                continue;
              }
            } else delete frame.slots[step.slot]; // carried, set by an action or answered on an earlier pass → ask again
          }
          if (step.maxAttempts !== undefined && (frame.failures.get(frame.step) ?? 0) >= step.maxAttempts) {
            frame.failures.delete(frame.step);
            frame.step = this.indexOf(frame.flow, step.onExhausted ?? END);
            continue;
          }
          const options = definition.options?.(frame.slots);
          if (options && options.length === 0) {
            this.output(definition.noOptions ?? this.messages.noOptions());
            frame.step = frame.flow.steps.length; // → end
            continue;
          }
          if (options?.length === 1 && !frame.noAutoSelect.has(definition.name) && definition.prefill !== false) {
            frame.slots[definition.name] = options[0]!.value; // only one option → don't ask
            this.output(this.messages.autoSelected(options[0]!));
            continue; // the same step again, so that `verify` checks the value
          }
          frame.waitingFor = definition.name;
          const question = definition.question(frame.slots) + (options ? this.messages.formatOptions(options) : "");
          this.output(returning ? this.messages.resume(this.chain()[0]!.flow.title, question) : question);
          return;
        }
        case "say":
          this.output(step.text(frame.slots));
          frame.step++;
          continue;
        case "action":
          await this.run(frame, step.run);
          frame.step++;
          continue;
        case "set":
          setSlots(frame.slots, step.values);
          frame.step++;
          continue;
        case "goto":
          frame.step = !step.when || step.when(frame.slots) ? this.indexOf(frame.flow, step.to) : frame.step + 1;
          continue;
        case "link": {
          // e.g. a "return" turns out to be a "complaint": replace the flow, keep what we know
          this.stack.pop();
          this.handToParked(frame.flow, frame.slots);
          if (step.message) this.output(step.message);
          const carried = Object.fromEntries(step.carry.filter((name) => name in frame.slots).map((name) => [name, frame.slots[name]!]));
          if (this.resumeParked(step.flow)) {
            const resumed = this.top!;
            Object.assign(resumed.slots, carried);
            for (const name of Object.keys(carried)) resumed.unchecked.add(name);
          } else await this.push(step.flow, carried, false, new Set());
          returning = false;
          continue;
        }
        case "call":
          frame.step++; // where the caller goes on when the called flow ends
          await this.push(step.flow, frame.slots, true, frame.unchecked);
          continue;
      }
    }
  }

  /** A flow runs only once: moves the parked call chain with this flow to the top of the stack, if there is one. */
  private resumeParked(name: string): boolean {
    let start = this.stack.findLastIndex((frame) => frame.flow.name === name);
    if (start < 0) return false;
    let end = start + 1;
    while (this.stack[start]!.called) start--;
    while (this.stack[end]?.called) end++;
    this.stack.push(...this.stack.splice(start, end - start));
    return true;
  }

  /** A flow the customer started has left the stack: everything on it now is parked and gets its persisted slots, for its collect steps to check. */
  private handToParked(flow: Flow, slots: Slots): void {
    for (const name of this.persistedSlots(flow)) {
      if (!(name in slots)) continue; // the flow started empty: no value means it didn't touch the slot, not that it cleared it
      for (const parked of this.stack) {
        parked.slots[name] = slots[name]!;
        parked.unchecked.add(name);
      }
    }
  }

  private persistedSlots(flow: Flow): string[] {
    return [...(flow.persistedSlots ?? []), ...flow.steps.flatMap((step) => (step.kind === "call" ? this.persistedSlots(this.flows[step.flow]!) : []))];
  }

  private async run(frame: Frame, action: Action): Promise<void> {
    const result = await action({ ...frame.slots });
    if (result?.setSlots) setSlots(frame.slots, result.setSlots);
    for (const text of [result?.say ?? []].flat()) this.output(text);
  }

  /** Checks a value read while another flow was asking; a turned-down value is cleared. */
  private check(frame: Frame, definition: SlotDefinition): boolean {
    const value = frame.slots[definition.name]!;
    const valid = this.hasType(definition, value, frame.slots);
    const error = valid ? definition.validate?.(value, frame.slots) : null;
    if (valid && !error) return true;
    delete frame.slots[definition.name];
    if (error) {
      this.output(error);
      frame.noAutoSelect.add(definition.name);
      countFailure(frame);
    }
    return false;
  }

  /** Runs a collect step's `verify`; the value is turned down when the action cleared the slot. */
  private async verify(frame: Frame, action: Action, slot: string): Promise<boolean> {
    await this.run(frame, action);
    if (slot in frame.slots) return true;
    countFailure(frame);
    frame.noAutoSelect.add(slot); // a single option that failed must not be picked again without asking
    return false;
  }

  private slotDefinition(flow: Flow, name: string): SlotDefinition {
    const definition = flow.slots.find((slot) => slot.name === name);
    if (!definition) throw new Error(`Flow ${flow.name} has no slot ${name}`);
    return definition;
  }

  private hasType(definition: SlotDefinition, value: SlotValue, slots: Slots): boolean {
    switch (definition.type) {
      case "text": return typeof value === "string";
      case "bool": return typeof value === "boolean";
      case "number": return typeof value === "number" && Number.isFinite(value);
      case "choice": return definition.options!(slots).some((option) => option.value === value);
    }
  }

  private indexOf(flow: Flow, id: string): number {
    if (id === END) return flow.steps.length;
    const index = flow.steps.findIndex((step) => step.id === id);
    if (index < 0) throw new Error(`Flow ${flow.name} has no step ${id}`);
    return index;
  }

  /** The flow stack as data, bottom first. */
  snapshot(): FrameSnapshot[] {
    return this.stack.map((frame) => ({
      flow: frame.flow.name,
      title: frame.flow.title,
      step: frame.step,
      waitingFor: frame.waitingFor ?? null,
      slots: { ...frame.slots },
      called: frame.called,
    }));
  }
}

/** One more turned-down value for the collect step the frame stands on. */
function countFailure(frame: Frame): void {
  frame.failures.set(frame.step, (frame.failures.get(frame.step) ?? 0) + 1);
}

function setSlots(slots: Slots, values: Record<string, SlotValue | null>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === null) delete slots[name];
    else slots[name] = value;
  }
}

/** Catches broken references when the engine is created, not in the middle of a conversation. */
function validateFlows(flows: Record<string, Flow>): void {
  for (const [key, flow] of Object.entries(flows)) {
    const fail = (message: string) => { throw new Error(`Flow ${key}: ${message}`); };
    if (flow.name !== key) fail(`is registered as "${key}" but named "${flow.name}"`);
    for (const slot of flow.slots) {
      if (slot.type === "choice" && !slot.options) fail(`choice slot ${slot.name} has no options`);
    }
    const ids = flow.steps.flatMap((step) => (step.id === undefined ? [] : [step.id]));
    for (const id of ids) {
      if (id === END) fail(`step id ${END} is reserved`);
      if (ids.indexOf(id) !== ids.lastIndexOf(id)) fail(`step id ${id} is used twice`);
    }
    for (const step of flow.steps) {
      if (step.kind === "collect") {
        if (!flow.slots.some((slot) => slot.name === step.slot)) fail(`collects unknown slot ${step.slot}`);
        if (step.maxAttempts !== undefined && !(Number.isInteger(step.maxAttempts) && step.maxAttempts >= 1)) fail(`maxAttempts of ${step.slot} must be a whole number of at least 1`);
        if (step.onExhausted !== undefined && step.maxAttempts === undefined) fail(`onExhausted of ${step.slot} needs maxAttempts`);
        if (step.onExhausted !== undefined && step.onExhausted !== END && !ids.includes(step.onExhausted)) fail(`onExhausted to unknown step ${step.onExhausted}`);
      }
      if (step.kind === "goto" && step.to !== END && !ids.includes(step.to)) fail(`goto to unknown step ${step.to}`);
      if (step.kind === "link" && !flows[step.flow]) fail(`links to unknown flow ${step.flow}`);
      if (step.kind === "call") {
        if (!flows[step.flow]) fail(`calls unknown flow ${step.flow}`);
        else if (reaches(flows, step.flow, key)) fail(`calls ${step.flow}, which leads back to ${key} – a call can't repeat endlessly`);
        else if (flows[step.flow]!.steps.some((called) => called.kind === "link")) fail(`calls ${step.flow}, which uses a link – a called flow can't link, because a link ends the flow and a call has to come back`);
      }
    }
  }
}

/** Can `from` get to `to` through calls? */
function reaches(flows: Record<string, Flow>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const visit = (name: string): boolean => {
    if (name === to) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return (flows[name]?.steps ?? []).some((step) => step.kind === "call" && visit(step.flow));
  };
  return visit(from);
}
