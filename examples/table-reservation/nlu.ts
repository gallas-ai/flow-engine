// The keywords the fake NLU of this example knows. In your project, an LLM does this: see docs/nlu.md.
import { keywordNlu } from "../shared/nlu.ts";

const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export const nlu = keywordNlu({
  routes: { reserve_table: /\b(reserve|table)\b/i },
  extract: {
    guests: (text) => {
      const guests = /(?<![\d:])\d+(?![\d:])/.exec(text)?.[0]; // a number, not part of a time like 19:30
      return guests === undefined ? undefined : Number(guests);
    },
    day: (text) => DAYS.exec(text)?.[1]!.replace(/^./, (first) => first.toUpperCase()),
    time: (text) => /\b\d{1,2}:\d{2}\b/.exec(text)?.[0],
    confirm: (text) => (/\byes\b/i.test(text) ? true : /\bno\b/i.test(text) ? false : undefined),
  },
});
