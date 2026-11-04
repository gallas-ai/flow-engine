// The code both versions of the flows share, and the registry flows.yaml refers to by name.
// One `createActions()` serves one conversation: it remembers the verified patient, so a second task in the same
// conversation isn't verified again.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Action, FlowRegistry } from "../../src/index.ts";

type Patient = { id: string; name: string };

/** A stand-in for the practice's patient records: patients by phone number. */
const patients: Record<string, Patient> = { "555-0100": { id: "P-17", name: "Jane" } };

export type Actions = Record<"recallPatient" | "verifyPhone" | "bookAppointment" | "cancelAppointment", Action>;

export function createActions(): Actions {
  let verified: Patient | undefined; // kept for the whole conversation, outside the slots of any flow
  const appointments = new Map<string, string>(); // a stand-in for the calendar: day by patient id
  const patientSlots = (patient: Patient) => ({ setSlots: { patient_id: patient.id, patient_name: patient.name } });

  return {
    recallPatient: () => (verified ? patientSlots(verified) : undefined),
    /** Finds the patient; an unknown number is cleared, which the collect step counts as a failed attempt. */
    verifyPhone: (slots) => {
      if (verified) return patientSlots(verified); // a second run, for a parked flow: nothing new to say
      const patient = patients[String(slots.phone)];
      if (!patient) return { say: "I couldn't find a patient with this phone number.", setSlots: { phone: null } };
      verified = patient;
      return { say: `Thank you, ${patient.name}, you are verified.`, ...patientSlots(patient) };
    },
    bookAppointment: (slots) => {
      appointments.set(String(slots.patient_id), String(slots.day));
      return { say: `Done: you're booked for ${slots.day}.` };
    },
    cancelAppointment: (slots) => {
      const day = appointments.get(String(slots.patient_id));
      if (!day) return { say: "You have no appointment to cancel." };
      appointments.delete(String(slots.patient_id));
      return { say: `Your appointment on ${day} is cancelled.` };
    },
  };
}

/** The code `flows.yaml` refers to by name. */
export const registry = (actions: Actions): FlowRegistry => ({
  actions: {
    action_recall_patient: actions.recallPatient,
    action_verify_phone: actions.verifyPhone,
    action_book_appointment: actions.bookAppointment,
    action_cancel_appointment: actions.cancelAppointment,
  },
});
