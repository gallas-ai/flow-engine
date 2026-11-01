// The engine's own texts per language, shared by both versions. English uses the defaults.
// Typed as the full `Messages`, so a text missing in one language is a compile error.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { defaultMessages, type Messages } from "../../src/index.ts";
import type { Language } from "./languages.ts";

export const messages: Record<Language, Messages> = {
  en: defaultMessages,
  cs: {
    notUnderstood: () => "Promiňte, tomu úplně nerozumím.",
    stillNotUnderstood: () => "Pořád si nerozumíme. Zkuste jednoduchou odpověď, nebo požádejte o spojení s člověkem.",
    flowParked: (flowTitle) => `Dobře, „${flowTitle}“ zatím odložím.`,
    flowCancelled: (flowTitle) => `Rozumím, „${flowTitle}“ ruším.`,
    resume: (flowTitle, question) => `Zpět k „${flowTitle}“: ${question}`,
    noOptions: () => "Promiňte, tady vám nemám co nabídnout.",
    autoSelected: defaultMessages.autoSelected,
    formatOptions: defaultMessages.formatOptions,
  },
  es: {
    notUnderstood: () => "Perdone, no lo he entendido bien.",
    stillNotUnderstood: () => "Seguimos sin entendernos. Pruebe con una respuesta sencilla o pida hablar con una persona.",
    flowParked: (flowTitle) => `De acuerdo, dejo «${flowTitle}» para más tarde.`,
    flowCancelled: (flowTitle) => `Entendido, «${flowTitle}» queda cancelado.`,
    resume: (flowTitle, question) => `Volvamos a «${flowTitle}»: ${question}`,
    noOptions: () => "Lo siento, aquí no tengo nada que ofrecerle.",
    autoSelected: defaultMessages.autoSelected,
    formatOptions: defaultMessages.formatOptions,
  },
};
