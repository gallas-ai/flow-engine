// The few-shot examples per language and a stand-in for the LLM that reads them. In your project, the same list goes into
// the prompt of `route`: see docs/nlu.md.
import type { Nlu } from "../../src/index.ts";
import { keywordNlu } from "../shared/nlu.ts";
import type { Language } from "./languages.ts";

/** `flow: null` = no flow, the bot just answers the message. */
type Example = { text: string; flow: string | null };

const examples: Record<Language, Example[]> = {
  en: [
    { text: "this mug arrived cracked", flow: "complaint" },
    { text: "I don't need this mug any more, I want my money back", flow: "refund" },
    { text: "how long do I have to return something?", flow: null },
  ],
  cs: [
    { text: "ten hrnek přišel prasklý", flow: "complaint" },
    { text: "hrnek už nepotřebuju, chci zpátky peníze", flow: "refund" },
    { text: "do kdy můžu zboží vrátit?", flow: null },
  ],
  es: [
    { text: "esta taza llegó rota", flow: "complaint" },
    { text: "ya no necesito esta taza, quiero que me devuelvan el dinero", flow: "refund" },
    { text: "¿cuánto tiempo tengo para devolver algo?", flow: null },
  ],
};

const returnPolicy: Record<Language, string> = {
  en: "Items can be returned within 30 days of delivery.",
  cs: "Zboží můžete vrátit do 30 dnů od doručení.",
  es: "Puede devolver los artículos en un plazo de 30 días desde la entrega.",
};

const words = (text: string) => new Set(text.toLowerCase().match(/\p{L}+/gu));

/** Stands in for the LLM: the example that shares the most words with the message decides, and no shared word means no flow. */
const routeWith = (list: Example[]): Nlu["route"] => async (text) => {
  const said = words(text);
  const shared = (example: Example) => [...words(example.text)].filter((word) => said.has(word)).length;
  const [closest] = list.toSorted((a, b) => shared(b) - shared(a));
  return closest && shared(closest) > 0 ? closest.flow : null;
};

function nluFor(language: Language): Nlu {
  return {
    ...keywordNlu({ routes: {}, extract: { order_number: (text) => /\b\d{4,}\b/.exec(text)?.[0] } }),
    route: routeWith(examples[language]),
    answer: async () => returnPolicy[language],
  };
}

export const nlu: Record<Language, Nlu> = { en: nluFor("en"), cs: nluFor("cs"), es: nluFor("es") };
