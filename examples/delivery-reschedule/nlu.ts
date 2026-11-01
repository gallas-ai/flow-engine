// The keywords the fake NLU of this example knows, one NLU per language. In your project, an LLM does this, told which
// language to answer in: see docs/nlu.md.
import type { Nlu } from "../../src/index.ts";
import { keywordNlu } from "../shared/nlu.ts";
import type { Language } from "./languages.ts";

type Keywords = { route: RegExp; days: Record<string, string>; yes: RegExp; no: RegExp };

const keywords: Record<Language, Keywords> = {
  en: { route: /deliver/i, days: { monday: "mon", wednesday: "wed", friday: "fri" }, yes: /^yes\b/i, no: /^no\b/i },
  cs: { route: /doručení/i, days: { pondělí: "mon", středa: "wed", středu: "wed", pátek: "fri" }, yes: /^ano\b/i, no: /^ne\b/i },
  es: { route: /entrega/i, days: { lunes: "mon", miércoles: "wed", viernes: "fri" }, yes: /^s[ií](?![a-z])/i, no: /^no\b/i },
};

function nluFor({ route, days, yes, no }: Keywords): Nlu {
  return keywordNlu({
    routes: { reschedule_delivery: route },
    extract: {
      order_number: (text) => /\b\d{4,}\b/.exec(text)?.[0],
      delivery_day: (text) => Object.entries(days).find(([word]) => text.toLowerCase().includes(word))?.[1],
      // only an answer to the question confirms, never the opening message
      confirmed: (text, answering) => (!answering ? undefined : yes.test(text) ? true : no.test(text) ? false : undefined),
    },
  });
}

export const nlu: Record<Language, Nlu> = { en: nluFor(keywords.en), cs: nluFor(keywords.cs), es: nluFor(keywords.es) };
