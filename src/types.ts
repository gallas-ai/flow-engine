/** Slot values collected so far, keyed by slot name. */
export type Slots = Record<string, string>;

/** One value offered for a choice slot. */
export type Option = { value: string; label: string };

/** The two values a yes/no slot can hold. */
export const YES = "yes";
export const NO = "no";

export type SlotDefinition = {
  name: string;
  /** What the value means – the NLU sees this (prefill + extraction). */
  description: string;
  question: (slots: Slots) => string;
  /** Used when the user asks about this step ("why do you need it?"). */
  help?: string;
  /** text = free text, yesno = YES / NO, choice = the value of one of `options` */
  type: "text" | "yesno" | "choice";
  options?: (slots: Slots) => Option[];
  /** Said when the user names something that isn't among the options. */
  notAvailable?: string;
  /** Said when there are no options at all – the flow ends. */
  noOptions?: string;
  /** Business rules in code, never in the prompt. Returns an error message or null. */
  validate?: (value: string, slots: Slots) => string | null;
  /** false = never take it from an earlier message, always ask (consent, confirmation!). */
  prefill?: boolean;
};

export type Step = { id?: string } & (
  | { kind: "collect"; slot: string }
  | { kind: "say"; text: (slots: Slots) => string }
  | { kind: "goto"; to: string; when: (slots: Slots) => boolean }
  | { kind: "link"; flow: string; carry: string[]; message: string }
  | { kind: "action"; run: (slots: Slots) => string }
  | { kind: "end" }
);

export type Flow = { name: string; title: string; slots: SlotDefinition[]; steps: Step[] };

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
  /** Which flow does this message start? null = just answer it. */
  route(text: string): Promise<string | null>;
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
