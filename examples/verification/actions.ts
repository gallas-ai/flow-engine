// The code both versions of the flow share: the e-mail check, and the registry flows.yaml refers to by name.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Action, ActionResult, FlowRegistry } from "../../src/index.ts";

/** A stand-in for the CRM: customer names by e-mail. */
export const customers: Record<string, string> = { "jane@example.com": "Jane" };

/** E-mails several customers share: they can't verify anyone, but aren't a wrong answer either. */
const sharedEmails = new Set(["office@example.com"]);

/** Finds the customer; an unknown e-mail is cleared, which the collect step counts as a failed attempt. */
export const verifyEmail: Action = async (slots): Promise<ActionResult> => {
  if (sharedEmails.has(String(slots.email).toLowerCase())) {
    return { say: "Several customers share this e-mail address. Please give me your own.", setSlots: { email: null }, uncounted: true };
  }
  const name = customers[String(slots.email).toLowerCase()];
  return name ? { setSlots: { customer_name: name } } : { say: "I couldn't verify this e-mail address.", setSlots: { email: null } };
};

/** The code `flows.yaml` refers to by name. */
export const registry: FlowRegistry = { actions: { action_verify_email: verifyEmail } };
