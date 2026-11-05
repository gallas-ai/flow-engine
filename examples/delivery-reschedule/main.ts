// Plays the conversations from README.md, one per language: npm run example -- delivery-reschedule [yaml|code]
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Flow } from "../../src/index.ts";
import { tracing } from "../shared/tracing.ts";
import { selectVariants, transcript } from "../shared/transcript.ts";
import { registry } from "./actions.ts";
import { createFlows } from "./flows.ts";
import { languages, type Language } from "./languages.ts";
import { messages } from "./messages.ts";
import { nlu } from "./nlu.ts";

const read = async (file: string) => parse(await readFile(new URL(file, import.meta.url), "utf8"));

const variants: Record<"yaml" | "code", (language: Language) => Promise<Record<string, Flow>>> = {
  // the same flows.yaml with the responses of one language
  yaml: async (language) => compileFlows({ ...(await read("flows.yaml")), ...(await read(`responses.${language}.yaml`)) }, registry(language)),
  code: async (language) => createFlows(language),
};

/** What the customer says in each language; the bot's lines come from the engine. */
const conversations: Record<Language, string[]> = {
  en: ["I want to reschedule my delivery", "the one from last week", "10234", "Friday", "yes"],
  cs: ["Chci přesunout doručení", "ta z minulého týdne", "10234", "v pátek", "ano"],
  es: ["Quiero cambiar la entrega", "el de la semana pasada", "10234", "el viernes", "sí"],
};

const selected = selectVariants(["yaml", "code"] as const);
for (const variant of selected) {
  if (selected.length > 1) console.log(`--- ${variant} ---`);
  // every language is compiled up front, so a missing translation fails here, not in a customer's conversation
  const flows = Object.fromEntries(await Promise.all(languages.map(async (language) => [language, await variants[variant](language)] as const)));
  for (const language of languages) {
    const { customer, bot } = transcript();
    // the application picks the language before the first message
    const engine = new FlowEngine({ flows: flows[language], nlu: nlu[language], messages: messages[language], output: bot, ...tracing() });
    for (const text of conversations[language]) {
      customer(text);
      await engine.handle(text);
    }
    console.log();
  }
}
