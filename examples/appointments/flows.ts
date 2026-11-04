// Booking and cancelling an appointment, written in code: the same flows as flows.yaml.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { END, type Flow } from "../../src/index.ts";
import type { Actions } from "./actions.ts";

export function createFlows(actions: Actions): Record<string, Flow> {
  const verifyPatient: Flow = {
    name: "verify_patient",
    title: "Patient verification",
    description: "Finds the patient by phone number before anything is done with their appointments.",
    routable: false, // like `if: False`: only a `call` starts it
    persistedSlots: ["phone"], // a flow parked on this question doesn't ask it again
    slots: [{ name: "phone", type: "text", description: "the patient's phone number", question: () => "What is your phone number?" }],
    steps: [
      { kind: "action", run: actions.recallPatient },
      { kind: "goto", to: END, when: (slots) => "patient_id" in slots },
      { kind: "collect", slot: "phone", verify: actions.verifyPhone, maxAttempts: 2, onExhausted: "failed" },
      { kind: "end" },
      { id: "failed", kind: "say", text: () => "Sorry, I couldn't verify you. Please call the front desk." },
    ],
  };

  const bookAppointment: Flow = {
    name: "book_appointment",
    title: "Book appointment",
    description: "The patient wants to book an appointment.",
    slots: [{ name: "day", type: "text", description: "the day of the appointment, Monday to Friday", question: () => "Which day would you like?" }],
    steps: [
      { kind: "call", flow: "verify_patient" }, // comes back with the verification's slots: patient_id, patient_name
      { kind: "goto", to: END, when: (slots) => !("patient_id" in slots) }, // verification failed
      { kind: "collect", slot: "day" },
      { kind: "action", run: actions.bookAppointment },
    ],
  };

  const cancelAppointment: Flow = {
    name: "cancel_appointment",
    title: "Cancel appointment",
    description: "The patient wants to cancel an appointment they booked.",
    slots: [],
    steps: [
      { kind: "call", flow: "verify_patient" },
      { kind: "goto", to: END, when: (slots) => !("patient_id" in slots) },
      { kind: "action", run: actions.cancelAppointment },
    ],
  };

  return { verify_patient: verifyPatient, book_appointment: bookAppointment, cancel_appointment: cancelAppointment };
}
