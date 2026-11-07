/** One slot value: text and choice slots hold strings, bool slots booleans, number slots numbers. */
export type SlotValue = string | number | boolean;

/** Slot values collected so far, keyed by slot name. A slot that isn't set has no key. */
export type Slots = Record<string, SlotValue>;

/** One value offered for a choice slot. */
export type Option = { value: string; label: string };

/** The step id a `goto` uses to end the flow. */
export const END = "END";

export type SlotDefinition = {
  name: string;
  /** What the value means – the NLU sees this (prefill + extraction). */
  description: string;
  question: (slots: Slots) => string;
  /** Used when the user asks about this step ("why do you need it?"). */
  help?: string;
  /** text = free text, bool = true / false, number = a finite number, choice = the value of one of `options` */
  type: "text" | "bool" | "number" | "choice";
  options?: (slots: Slots) => Option[];
  /** Said when the user names something that isn't among the options. */
  notAvailable?: string;
  /** Said when there are no options at all – the flow ends. */
  noOptions?: string;
  /** Business rules in code, never in the prompt. Returns an error message or null. */
  validate?: (value: SlotValue, slots: Slots) => string | null;
  /**
   * false = the engine always asks itself (consent, confirmation!): the slot is never taken from an earlier message,
   * and a value it already holds (carried, set by an action, answered on an earlier pass) is asked again.
   */
  prefill?: boolean;
};

/** What an action says and which slots it changes; null deletes a slot. */
export type ActionResult = {
  say?: string | string[];
  setSlots?: Record<string, SlotValue | null>;
  /** For a collect step's `verify` that clears the slot: this turned-down value doesn't count toward `maxAttempts`. */
  uncounted?: boolean;
};

/** Code run by an `action` step; it gets a copy of the slots. */
export type Action = (slots: Slots) => ActionResult | void | Promise<ActionResult | void>;

export type Step = { id?: string } & (
  | {
      kind: "collect";
      slot: string;
      /** Checks the collected value; an action that clears the slot turns the value down, and the question is asked again. */
      verify?: Action;
      /** How many turned-down values (by `verify` or `validate`) the step accepts before it gives up. */
      maxAttempts?: number;
      /** Where the flow goes after `maxAttempts` turned-down values: a step id, or END (the default). */
      onExhausted?: string;
    }
  | { kind: "say"; text: (slots: Slots) => string }
  /** Jumps to the step with id `to` (or END) when `when` holds; without `when` it always jumps. */
  | { kind: "goto"; to: string; when?: (slots: Slots) => boolean }
  | { kind: "set"; values: Record<string, SlotValue | null> }
  | { kind: "link"; flow: string; carry: string[]; message?: string }
  /**
   * Runs the flow and continues with the next step when it ends. The called flow starts with all of this flow's slots,
   * and all of its slots (set or cleared) come back. Check them afterwards: an END in the called flow ends only that flow.
   */
  | { kind: "call"; flow: string }
  | { kind: "action"; run: Action }
  | { kind: "end" }
);

export type Flow = {
  name: string;
  title: string;
  /** When this flow applies – passed to `Nlu.route` so the NLU can pick the flow. */
  description?: string;
  /** false = hidden from `Nlu.route`: only a `call` or a `link` starts the flow (YAML: `if: False`). Defaults to true. */
  routable?: boolean;
  /**
   * Slots that go to the parked flows when this flow leaves: at its end, on a cancel or on a `link` (YAML: `persisted_slots`,
   * which a `link` carries too). The persisted slots of the flows it calls count as well.
   */
  persistedSlots?: string[];
  slots: SlotDefinition[];
  steps: Step[];
};

/** What `Nlu.route` gets to know about each flow. */
export type FlowSummary = { name: string; title: string; description?: string };

/** How a message relates to the question the engine is waiting on. */
export const TURN_TYPES = ["answer", "step_question", "digression", "task_switch", "cancel"] as const;
export type TurnType = (typeof TURN_TYPES)[number];

/** What the NLU found in one message. */
export type Extraction = {
  /** Raw values for the wanted slots the message mentions; the engine still validates them. */
  values: Slots;
  /** Choice slots for which the user named something that isn't among the options. */
  notAmongOptions: string[];
};

/** Everything the engine needs from language understanding. */
export interface Nlu {
  /** Which of `flows` does this message start? Returns its name, or null = just answer it. */
  route(text: string, flows: FlowSummary[]): Promise<string | null>;
  classifyTurn(flowTitle: string, question: string, text: string): Promise<TurnType>;
  /** Values for any of the `wanted` slots the message contains. */
  extract(flow: Flow, wanted: SlotDefinition[], slots: Slots, text: string, question?: string): Promise<Extraction>;
  /** Map an answer to the value of one of the offered options. */
  choose(question: string, text: string, options: Option[]): Promise<string | null>;
  /** Free Q&A; `step` = the question we asked + its help, for "why do you ask?" */
  answer(text: string, step?: { question: string; help?: string }): Promise<string>;
}

/**
 * Everything the engine says to the user on its own (not taken from a flow definition).
 * `flowTitle` is the title of the flow the customer started, never of a flow it called.
 */
export type Messages = {
  notUnderstood: () => string;
  /** After the second answer in a row the engine couldn't use. */
  stillNotUnderstood: () => string;
  flowParked: (flowTitle: string) => string;
  flowCancelled: (flowTitle: string) => string;
  /** Asks the waiting question again after a digression or a finished flow. */
  resume: (flowTitle: string, question: string) => string;
  /** Fallback when a choice slot has no options and no `noOptions` text. */
  noOptions: () => string;
  /** Said when the only option was picked without asking. */
  autoSelected: (option: Option) => string;
  /** Appended to the question of a choice slot. */
  formatOptions: (options: Option[]) => string;
};

/** What happened inside the engine – for logging and debugging. */
export type FlowEngineEvent =
  | { type: "routed"; flow: string | null }
  | { type: "turnClassified"; turnType: TurnType }
  /** `called` = started by a `call` step (or linked to from a called flow); `carried` = the slots it started with. */
  | { type: "flowStarted"; flow: string; title: string; carried: string[]; called: boolean }
  | { type: "flowEnded"; flow: string; title: string }
  | { type: "slotsPrefilled"; values: Slots; notAmongOptions: string[] }
  | { type: "slotsExtracted"; values: Slots; notAmongOptions: string[] };

/** One frame of the flow stack, as data. `called` = the frame below called it. */
export type FrameSnapshot = { flow: string; title: string; step: number; waitingFor: string | null; slots: Slots; called: boolean };

/**
 * Everything the engine remembers about one conversation between two messages, as JSON: `engine.state()` gives it,
 * the `state` option continues from it. Store it as it is; only `version` is guaranteed, the other fields may change.
 */
export type ConversationState = {
  version: 1;
  /** The flow stack, bottom first. */
  frames: {
    flow: string;
    step: number;
    slots: Slots;
    waitingFor: string | null;
    called: boolean;
    /** Answers in a row the engine couldn't use. */
    attempts: number;
    /** Turned-down values per collect step: [step index, count]. */
    failures: [number, number][];
    noAutoSelect: string[];
    unchecked: string[];
  }[];
};

/** A span attribute value, as OpenTelemetry takes it. */
export type TracerAttributeValue = string | number | boolean | string[];

/** The part of an OpenTelemetry span the engine uses; a span from `@opentelemetry/api` fits as it is. */
export interface TracerSpan {
  setAttribute(key: string, value: TracerAttributeValue): unknown;
  addEvent(name: string, attributes?: Record<string, TracerAttributeValue>): unknown;
  recordException(exception: Error | string): void;
  /** The engine only sets ERROR (code 2). */
  setStatus(status: { code: 2; message?: string }): unknown;
  end(): void;
}

/**
 * The part of an OpenTelemetry tracer the engine uses: `trace.getTracer("…")` from `@opentelemetry/api` fits as it is.
 * `startActiveSpan` makes the span active while `fn` runs, so spans opened inside `Nlu` or an action nest under it.
 */
export interface Tracer {
  startActiveSpan<F extends (span: TracerSpan) => unknown>(name: string, fn: F): ReturnType<F>;
}
