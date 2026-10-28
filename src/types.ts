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
export type ActionResult = { say?: string | string[]; setSlots?: Record<string, SlotValue | null> };

export type Step = { id?: string } & (
  | { kind: "collect"; slot: string }
  | { kind: "say"; text: (slots: Slots) => string }
  /** Jumps to the step with id `to` (or END) when `when` holds; without `when` it always jumps. */
  | { kind: "goto"; to: string; when?: (slots: Slots) => boolean }
  | { kind: "set"; values: Record<string, SlotValue | null> }
  | { kind: "link"; flow: string; carry: string[]; message?: string }
  | { kind: "action"; run: (slots: Slots) => ActionResult | void | Promise<ActionResult | void> }
  | { kind: "end" }
);

export type Flow = {
  name: string;
  title: string;
  /** When this flow applies – passed to `Nlu.route` so the NLU can pick the flow. */
  description?: string;
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

/** Everything the engine says to the user on its own (not taken from a flow definition). */
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
  | { type: "flowStarted"; flow: string; title: string; carried: string[] }
  | { type: "flowEnded"; flow: string; title: string }
  | { type: "slotsPrefilled"; values: Slots; notAmongOptions: string[] }
  | { type: "slotsExtracted"; values: Slots; notAmongOptions: string[] };

/** One frame of the flow stack, as data. */
export type FrameSnapshot = { flow: string; title: string; step: number; waitingFor: string | null; slots: Slots };
