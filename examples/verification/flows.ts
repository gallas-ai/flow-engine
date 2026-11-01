// Verifying a customer by e-mail, written in code: the same flow as flows.yaml.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import type { Flow } from "../../src/index.ts";
import { verifyEmail } from "./actions.ts";

export const verifyCustomer: Flow = {
  name: "verify_customer",
  title: "Customer verification",
  description: "The customer needs to verify themselves by e-mail, e.g. before we tell them the status of an order.",
  slots: [
    {
      name: "email",
      type: "text",
      description: "the customer's e-mail address",
      question: () => "What is your e-mail address?",
      validate: (value) => (String(value).includes("@") ? null : "That doesn't look like an e-mail address."), // like `rejections`
    },
  ],
  steps: [
    { kind: "collect", slot: "email", verify: verifyEmail, maxAttempts: 2, onExhausted: "failed" },
    { kind: "say", text: (slots) => `Thank you, ${slots.customer_name}, you are verified.` },
    { kind: "end" },
    { id: "failed", kind: "say", text: () => "Sorry, I couldn't verify you. Please contact our support." },
  ],
};
