// The keywords the fake NLU of this example knows. In your project, an LLM does this: see docs/nlu.md.
import { keywordNlu } from "../shared/nlu.ts";

const DAYS = /\b(monday|tuesday|wednesday|thursday|friday)\b/i;

export const nlu = keywordNlu({
  // verify_patient has no route: it is hidden from routing, so the NLU never sees it
  routes: { book_appointment: /\bbook/i, cancel_appointment: /\bcancel/i },
  extract: {
    phone: (text) => /\b\d{3}-\d{4}\b/.exec(text)?.[0],
    day: (text) => DAYS.exec(text)?.[1]!.replace(/^./, (first) => first.toUpperCase()),
  },
  cancel: /forget it/i,
});
