// The keywords the fake NLU of this example knows. In your project, an LLM does this: see docs/nlu.md.
import { keywordNlu } from "../shared/nlu.ts";

export const nlu = keywordNlu({
  routes: { verify_customer: /verify/i },
  // an answer to the question is the e-mail, in an opening message only something with an @ is
  extract: { email: (text, answering) => (answering ? text.trim() : /\S+@\S+/.exec(text)?.[0]) },
});
