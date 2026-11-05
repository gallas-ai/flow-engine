// Plays the conversations from README.md, three per language: npm run example -- returns-and-complaints [yaml|code]
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type Flow } from "../../src/index.ts";
import { selectVariants, transcript } from "../shared/transcript.ts";
import { createFlows } from "./flows.ts";
import { languages, type Language } from "./languages.ts";
import { nlu } from "./nlu.ts";

const read = async (file: string) => parse(await readFile(new URL(file, import.meta.url), "utf8"));

const variants: Record<"yaml" | "code", (language: Language) => Promise<Record<string, Flow>>> = {
  // the same flows.yaml with the responses of one language
  yaml: async (language) => compileFlows({ ...(await read("flows.yaml")), ...(await read(`responses.${language}.yaml`)) }),
  code: async (language) => createFlows(language),
};

/** What the customer says in each language; the bot's lines come from the engine. */
const conversations: Record<Language, string[][]> = {
  en: [
    ["my plate arrived cracked", "10234"],
    ["I want my money back for this plate", "10234"],
    ["how long do I have to send it back?"],
  ],
  cs: [
    ["talíř přišel prasklý", "10234"],
    ["chci zpátky peníze za tenhle talíř", "10234"],
    ["do kdy můžu poslat zboží zpátky?"],
  ],
  es: [
    ["la jarra llegó rota", "10234"],
    ["quiero que me devuelvan el dinero de este plato", "10234"],
    ["¿cuánto tiempo tengo para enviar la taza?"],
  ],
};

const selected = selectVariants(["yaml", "code"] as const);
for (const variant of selected) {
  if (selected.length > 1) console.log(`--- ${variant} ---`);
  for (const language of languages) {
    const flows = await variants[variant](language);
    for (const [index, conversation] of conversations[language].entries()) {
      if (index > 0) console.log();
      const { customer, bot } = transcript();
      // the application picks the language before the first message
      const engine = new FlowEngine({ flows, nlu: nlu[language], output: bot });
      for (const text of conversation) {
        customer(text);
        await engine.handle(text);
      }
    }
    console.log();
  }
}
