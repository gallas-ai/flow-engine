// The flow's texts for the code version, one object per language: what responses.<language>.yaml is for the YAML version.
// `Texts` is a type, so a missing translation is a compile error.
import type { Slots } from "../../src/index.ts";
import type { Language } from "./languages.ts";

export type Texts = {
  askOrderNumber: string;
  askDeliveryDay: string;
  askConfirmed: (slots: Slots) => string;
  deliveryKept: string;
};

export const texts: Record<Language, Texts> = {
  en: {
    askOrderNumber: "What is your order number?",
    askDeliveryDay: "Which day should we deliver it?",
    askConfirmed: (slots) => `Shall I move the delivery of order ${slots.order_number}?`,
    deliveryKept: "OK, the delivery stays as it was.",
  },
  cs: {
    askOrderNumber: "Jaké je číslo vaší objednávky?",
    askDeliveryDay: "Který den vám ji máme doručit?",
    askConfirmed: (slots) => `Mám přesunout doručení objednávky ${slots.order_number}?`,
    deliveryKept: "Dobře, doručení zůstává beze změny.",
  },
  es: {
    askOrderNumber: "¿Cuál es su número de pedido?",
    askDeliveryDay: "¿Qué día se lo entregamos?",
    askConfirmed: (slots) => `¿Cambio la entrega del pedido ${slots.order_number}?`,
    deliveryKept: "De acuerdo, la entrega se queda como estaba.",
  },
};
