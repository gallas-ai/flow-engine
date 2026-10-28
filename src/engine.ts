// A small declarative flow engine.
//
// Key idea: the LLM is only the NLU ("what did the user say?"). WHAT HAPPENS NEXT is decided by
// this deterministic code following the flow definition. The engine doesn't import any LLM code –
// it gets an `Nlu` implementation injected, so it runs just as well with a fake keyword NLU in tests.
import { defaultMessages } from "./messages.ts";
import { END } from "./types.ts";
import type { Flow, FlowEngineEvent, FlowSummary, FrameSnapshot, Messages, Nlu, SlotDefinition, SlotValue, Slots } from "./types.ts";

type Frame = {
  flow: Flow;
  step: number;
  slots: Slots;
  waitingFor?: string;
  attempts: number;
  noAutoSelect: Set<string>;
  /** Slots filled as the answer to their own question – a prefill: false slot is taken only from such an answer. */
  answered: Set<string>;
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
    this.summaries = Object.values(options.flows).map(({ name, title, description }) => ({ name, title, description }));
    this.nlu = options.nlu;
    this.output = options.output;
    this.emit = options.onEvent ?? (() => {});
    this.messages = { ...defaultMessages, ...options.messages };
  }

  private get top() { return this.stack.at(-1); }

  // ───────────────────────── entry point ─────────────────────────

  async handle(text: string): Promise<void> {
    const frame = this.top;
    if (!frame?.waitingFor) {
      const flow = await this.nlu.route(text, this.summaries);
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
        if (!filled.includes(slot.name) && !reported) {
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
        const flow = await this.nlu.route(text, this.summaries);
        if (flow && flow !== frame.flow.name) {
          this.output(this.messages.flowParked(frame.flow.title));
          return this.start(flow, text);
        }
        this.output(await this.nlu.answer(text));
        return this.advance(true);
      }
      case "cancel":
        this.stack.pop();
        this.output(this.messages.flowCancelled(frame.flow.title));
        return this.advance(true);
    }
  }

  async start(name: string, text?: string, carried: Slots = {}): Promise<void> {
    const flow = this.flows[name];
    if (!flow) throw new Error(`Unknown flow ${name}`);
    const frame: Frame = { flow, step: 0, slots: { ...carried }, attempts: 0, noAutoSelect: new Set(), answered: new Set() };
    this.stack.push(frame);
    this.emit({ type: "flowStarted", flow: flow.name, title: flow.title, carried: Object.keys(carried) });
    if (text) await this.fill(frame, text, true); // ← PREFILL from the opening message
    return this.advance(false);
  }

  // ───────────────────────── understanding → validated slots ─────────────────────────

  /** Runs NLU over the message and stores every valid value it finds. */
  private async fill(frame: Frame, text: string, prefill: boolean): Promise<{ filled: string[]; reported: boolean }> {
    const waiting = frame.waitingFor ? this.slotDefinition(frame.flow, frame.waitingFor) : undefined;
    // the user may answer more than we asked ("Brazil, tastes bitter, to my account") → look for ALL open slots
    const wanted = frame.flow.slots.filter(
      (definition) => !(definition.name in frame.slots) && (definition.prefill !== false || (!prefill && definition === waiting)),
    );
    if (!wanted.length) return { filled: [], reported: false };

    const extraction = await this.nlu.extract(frame.flow, wanted, frame.slots, text, waiting?.question(frame.slots));
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
        returning = true; // whatever is below gets a "back to…" line
        continue;
      }

      switch (step.kind) {
        case "collect": {
          const definition = this.slotDefinition(frame.flow, step.slot);
          const answered = frame.answered.delete(step.slot);
          if (step.slot in frame.slots) {
            if (definition.prefill !== false || answered) { frame.step++; continue; } // ← prefilled = step skipped
            delete frame.slots[step.slot]; // carried, set by an action or answered on an earlier pass → ask again
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
            frame.step++;
            continue;
          }
          frame.waitingFor = definition.name;
          const question = definition.question(frame.slots) + (options ? this.messages.formatOptions(options) : "");
          this.output(returning ? this.messages.resume(frame.flow.title, question) : question);
          return;
        }
        case "say":
          this.output(step.text(frame.slots));
          frame.step++;
          continue;
        case "action": {
          const result = await step.run({ ...frame.slots });
          if (result?.setSlots) setSlots(frame.slots, result.setSlots);
          for (const text of [result?.say ?? []].flat()) this.output(text);
          frame.step++;
          continue;
        }
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
          if (step.message) this.output(step.message);
          const carried = Object.fromEntries(step.carry.filter((name) => name in frame.slots).map((name) => [name, frame.slots[name]!]));
          return this.start(step.flow, undefined, carried);
        }
      }
    }
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
    }));
  }
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
      if (step.kind === "collect" && !flow.slots.some((slot) => slot.name === step.slot)) fail(`collects unknown slot ${step.slot}`);
      if (step.kind === "goto" && step.to !== END && !ids.includes(step.to)) fail(`goto to unknown step ${step.to}`);
      if (step.kind === "link" && !flows[step.flow]) fail(`links to unknown flow ${step.flow}`);
    }
  }
}
