// The code both versions of the flow share: the delivery days, the booking, and the registry flows.yaml refers to by
// name. Actions are code, so their texts are here, per language.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Action, FlowRegistry, Option, Slots } from "../../src/index.ts";
import type { Language } from "./languages.ts";

/** The days the courier can come. The values are the same in every language, only the labels are translated. */
const dayLabels: Record<Language, Record<string, string>> = {
  en: { mon: "Monday", wed: "Wednesday", fri: "Friday" },
  cs: { mon: "pondělí", wed: "středa", fri: "pátek" },
  es: { mon: "lunes", wed: "miércoles", fri: "viernes" },
};

const rescheduled: Record<Language, (order: string, day: string) => string> = {
  en: (order, day) => `Done, order ${order} arrives on ${day}.`,
  cs: (order, day) => `Hotovo, nový termín doručení objednávky ${order}: ${day}.`,
  es: (order, day) => `Listo, el pedido ${order} llegará el ${day}.`,
};

export const deliveryDays = (language: Language) => (_slots: Slots): Option[] =>
  Object.entries(dayLabels[language]).map(([value, label]) => ({ value, label }));

/** A stand-in for the courier's API; says the new day in the customer's language. */
export const rescheduleDelivery = (language: Language): Action => async (slots) => ({
  say: rescheduled[language](String(slots.order_number), dayLabels[language][String(slots.delivery_day)]!),
});

/** The code `flows.yaml` refers to by name, for one language. */
export const registry = (language: Language): FlowRegistry => ({
  actions: { action_reschedule_delivery: rescheduleDelivery(language) },
  options: { delivery_days: deliveryDays(language) },
});
