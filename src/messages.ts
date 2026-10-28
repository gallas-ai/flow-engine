import type { Messages } from "./types.ts";

export const defaultMessages: Messages = {
  notUnderstood: () => "Sorry, I didn't quite get that.",
  stillNotUnderstood: () => "We still don't understand each other. Try a simple answer, or ask for a human.",
  flowParked: (flowTitle) => `OK, I'll put "${flowTitle}" aside for now.`,
  flowCancelled: (flowTitle) => `Understood, "${flowTitle}" is cancelled.`,
  resume: (flowTitle, question) => `Back to ${flowTitle}: ${question}`,
  noOptions: () => "Sorry, I have nothing to offer here.",
  autoSelected: (option) => `(${option.label})`,
  formatOptions: (options) => "\n" + options.map((option, i) => `   ${i + 1}) ${option.label}`).join("\n"),
};
