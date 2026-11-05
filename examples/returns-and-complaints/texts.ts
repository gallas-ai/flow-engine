// The flows' texts for the code version, one object per language: what responses.<language>.yaml is for the YAML version.
// `Texts` is a type, so a missing translation is a compile error.
import type { Slots } from "../../src/index.ts";
import type { Language } from "./languages.ts";

export type Texts = {
  askOrderNumber: string;
  refundStarted: (slots: Slots) => string;
  complaintOpened: (slots: Slots) => string;
};

export const texts: Record<Language, Texts> = {
  en: {
    askOrderNumber: "What is your order number?",
    refundStarted: (slots) => `The refund for order ${slots.order_number} has started.`,
    complaintOpened: (slots) => `We're sorry. The complaint about order ${slots.order_number} is open.`,
  },
  cs: {
    askOrderNumber: "Jaké je číslo vaší objednávky?",
    refundStarted: (slots) => `Vrácení peněz za objednávku ${slots.order_number} je spuštěné.`,
    complaintOpened: (slots) => `Omlouváme se. Reklamace objednávky ${slots.order_number} je založená.`,
  },
  es: {
    askOrderNumber: "¿Cuál es su número de pedido?",
    refundStarted: (slots) => `El reembolso del pedido ${slots.order_number} está en marcha.`,
    complaintOpened: (slots) => `Lo sentimos. La reclamación del pedido ${slots.order_number} está abierta.`,
  },
};
