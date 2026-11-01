// Rescheduling a parcel delivery, written in code: the same flow as flows.yaml, built for one language.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Flow } from "../../src/index.ts";
import { deliveryDays, rescheduleDelivery } from "./actions.ts";
import type { Language } from "./languages.ts";
import { texts } from "./texts.ts";

export function createFlows(language: Language): Record<string, Flow> {
  const t = texts[language];
  const rescheduleDeliveryFlow: Flow = {
    name: "reschedule_delivery",
    title: "Delivery reschedule", // also in Czech and Spanish messages: the title isn't translated
    description: "The customer wants their parcel delivered on a different day.",
    slots: [
      { name: "order_number", type: "text", description: "the order number, e.g. 10234", question: () => t.askOrderNumber },
      {
        name: "delivery_day",
        type: "choice",
        description: "the day the customer wants the parcel delivered",
        question: () => t.askDeliveryDay,
        options: deliveryDays(language),
      },
      {
        name: "confirmed",
        type: "bool",
        description: "whether the customer confirms the new delivery day",
        question: t.askConfirmed,
        prefill: false, // like `ask_before_filling: true`
      },
    ],
    steps: [
      { kind: "collect", slot: "order_number" },
      { kind: "collect", slot: "delivery_day" },
      { kind: "collect", slot: "confirmed" },
      { kind: "goto", to: "kept", when: (slots) => !slots.confirmed },
      { kind: "action", run: rescheduleDelivery(language) },
      { kind: "end" },
      { id: "kept", kind: "say", text: () => t.deliveryKept },
    ],
  };
  return { reschedule_delivery: rescheduleDeliveryFlow };
}
