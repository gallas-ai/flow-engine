// A fake keyword NLU for the examples, so they run without an LLM. Each example configures its own keywords.
// In your project, implement `Nlu` with an LLM instead: see docs/nlu.md.
import type { Nlu, SlotValue, Slots } from "../../src/index.ts";

export type KeywordNluConfig = {
  /** Flow name → the pattern an opening message must match to start it. */
  routes: Record<string, RegExp>;
  /** Slot name → its value in `text`, or undefined. `answering` = the text replies to a question. */
  extract: Record<string, (text: string, answering: boolean) => SlotValue | undefined>;
  /** A reply to a question that matches cancels the flow. */
  cancel?: RegExp;
};

/** Every other reply to a question is an answer, never a digression or task switch. */
export function keywordNlu({ routes, extract, cancel }: KeywordNluConfig): Nlu {
  return {
    async route(text) {
      return Object.entries(routes).find(([, pattern]) => pattern.test(text))?.[0] ?? null;
    },
    async classifyTurn(_flowTitle, _question, text) {
      return cancel?.test(text) ? "cancel" : "answer";
    },
    async extract(_flow, wanted, _slots, text, question) {
      const values: Slots = {};
      for (const { name } of wanted) {
        const value = extract[name]?.(text, question !== undefined);
        if (value !== undefined) values[name] = value;
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
}
