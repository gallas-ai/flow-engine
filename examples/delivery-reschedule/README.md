# Rescheduling a delivery in three languages

One bot moves a parcel delivery to another day and talks to customers in English, Czech and Spanish. The flow logic
is written once, only the texts differ per language.

## Run it

From the repository root:

```bash
npm run example -- delivery-reschedule        # both versions
npm run example -- delivery-reschedule yaml   # or: code
```

On Node 22.18 or newer, `node examples/delivery-reschedule/main.ts yaml` works too.

To see each message as a trace in MLflow, start the local OpenTelemetry Collector and MLflow, then run the example with
`OTEL_EXPORTER_OTLP_ENDPOINT` set:

```bash
docker compose -f observability/compose.yaml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run example -- delivery-reschedule
```

Then open <http://localhost:5050>, the **Default** experiment and its **Traces** tab. More in
[Tracing](../../docs/tracing.md#try-it-locally-with-mlflow).

## What it does

The same conversation, once in each language.

### English

```transcript
customer: I want to reschedule my delivery
bot:      What is your order number?
customer: the one from last week
bot:      Sorry, I didn't quite get that.          ← the engine's own text, from messages.ts
          What is your order number?
customer: 10234
bot:      Which day should we deliver it?
             1) Monday                              ← option labels from actions.ts, values mon / wed / fri
             2) Wednesday
             3) Friday
customer: Friday
bot:      Shall I move the delivery of order 10234?   ← ask_before_filling: always asked
customer: yes
bot:      Done, order 10234 arrives on Friday.      ← said by the action
```

### Czech

```transcript
customer: Chci přesunout doručení
bot:      Jaké je číslo vaší objednávky?
customer: ta z minulého týdne
bot:      Promiňte, tomu úplně nerozumím.          ← notUnderstood in Czech
          Jaké je číslo vaší objednávky?
customer: 10234
bot:      Který den vám ji máme doručit?
             1) pondělí
             2) středa
             3) pátek
customer: v pátek
bot:      Mám přesunout doručení objednávky 10234?
customer: ano
bot:      Hotovo, nový termín doručení objednávky 10234: pátek.
```

### Spanish

```transcript
customer: Quiero cambiar la entrega
bot:      ¿Cuál es su número de pedido?
customer: el de la semana pasada
bot:      Perdone, no lo he entendido bien.
          ¿Cuál es su número de pedido?
customer: 10234
bot:      ¿Qué día se lo entregamos?
             1) lunes
             2) miércoles
             3) viernes
customer: el viernes                                ← the slot gets "fri", the same value as in English
bot:      ¿Cambio la entrega del pedido 10234?
customer: sí
bot:      Listo, el pedido 10234 llegará el viernes.
```

## How it works

The engine has no language setting. A conversation is one `FlowEngine`, and the application creates it with the
flows, the NLU and the messages of the customer's language. The language is picked before the first message and stays
for the whole conversation. How you pick it (the website's language, the channel, the customer's profile, a detector
over the first message) is up to the application.

Four kinds of text need translating, and each lives in one place:

| Text | YAML version | Code version |
|---|---|---|
| Questions and messages of the flow | [responses.en.yaml](responses.en.yaml), [responses.cs.yaml](responses.cs.yaml), [responses.es.yaml](responses.es.yaml) | [texts.ts](texts.ts) |
| Texts of actions and option labels | [actions.ts](actions.ts) (both versions) | [actions.ts](actions.ts) |
| The engine's own texts (`notUnderstood`, …) | [messages.ts](messages.ts) (both versions) | [messages.ts](messages.ts) |
| Understanding the customer | [nlu.ts](nlu.ts): one NLU per language | [nlu.ts](nlu.ts) |

The rest of the files:

| File | What it is |
|---|---|
| [flows.yaml](flows.yaml) | The flow logic in YAML, without any texts |
| [flows.ts](flows.ts) | The same flow in code: `createFlows(language)` |
| [languages.ts](languages.ts) | The list of languages and the `Language` type |
| [main.ts](main.ts) | Plays the three conversations above |

Choice options keep the same values in every language (`mon`, `wed`, `fri`), only their labels are translated. Slot
values, conditions and actions never depend on the language.

## YAML

[flows.yaml](flows.yaml) has the flow logic and no `responses`:

```yaml
slots:
  delivery_day:
    type: choice
    options: delivery_days # code: the days the courier can come, labelled in the customer's language
  confirmed:
    type: bool

flows:
  reschedule_delivery:
    name: Delivery reschedule
    description: The customer wants their parcel delivered on a different day.
    steps:
      - collect: order_number
        description: the order number, e.g. 10234
      - collect: delivery_day
        description: the day the customer wants the parcel delivered
      - collect: confirmed
        description: whether the customer confirms the new delivery day
        ask_before_filling: true
        next:
          - if: not slots.confirmed
            then:
              - action: utter_delivery_kept
      - action: action_reschedule_delivery # code: books the courier and says when the parcel arrives
```

Each language has its own `responses` file, e.g. [responses.cs.yaml](responses.cs.yaml):

```yaml
responses:
  utter_ask_order_number: Jaké je číslo vaší objednávky?
  utter_ask_delivery_day: Který den vám ji máme doručit?
  utter_ask_confirmed: Mám přesunout doručení objednávky {order_number}?
  utter_delivery_kept: Dobře, doručení zůstává beze změny.
```

The application compiles the flows once per language, at startup, and creates an engine for each conversation:

```ts
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFlows, FlowEngine } from "@gallas-ai/flow-engine";

const read = async (file: string) => parse(await readFile(file, "utf8"));
const flowsYaml = await read("flows.yaml");

// at startup: the same flows with the responses of each language
const flows = {
  en: compileFlows({ ...flowsYaml, ...(await read("responses.en.yaml")) }, registry("en")),
  cs: compileFlows({ ...flowsYaml, ...(await read("responses.cs.yaml")) }, registry("cs")),
  es: compileFlows({ ...flowsYaml, ...(await read("responses.es.yaml")) }, registry("es")),
};

// per conversation: the customer's language picks everything
const engine = new FlowEngine({ flows: flows[language], nlu: nlu[language], messages: messages[language], output: send });
```

`registry(language)` in [actions.ts](actions.ts) returns the action and the delivery-day options for one language,
so the action speaks the customer's language and the options get translated labels.

### A missing translation fails the start

Because every language is compiled at startup, a response missing from one file stops the application before any
customer talks to it. With `utter_ask_confirmed` missing from `responses.es.yaml`:

```text
flows.reschedule_delivery.steps[2].collect: unknown response "utter_ask_confirmed" – add it to responses
```

## Code

[flows.ts](flows.ts) builds the same flow for one language. The texts come from [texts.ts](texts.ts), where `Texts`
is a type, so a text missing in one language is a compile error:

```ts
import { FlowEngine, type Flow } from "@gallas-ai/flow-engine";

export function createFlows(language: Language): Record<string, Flow> {
  const t = texts[language];
  const rescheduleDeliveryFlow: Flow = {
    name: "reschedule_delivery",
    title: "Delivery reschedule",
    slots: [
      { name: "order_number", type: "text", description: "the order number, e.g. 10234", question: () => t.askOrderNumber },
      { name: "delivery_day", type: "choice", /* … */ question: () => t.askDeliveryDay, options: deliveryDays(language) },
      { name: "confirmed", type: "bool", /* … */ question: t.askConfirmed, prefill: false },
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

const engine = new FlowEngine({ flows: createFlows(language), nlu: nlu[language], messages: messages[language], output: send });
```

## The engine's own texts

[messages.ts](messages.ts) translates every text the engine says on its own. It is typed as the full `Messages`, not
`Partial<Messages>`, so a text missing in one language is a compile error. English uses `defaultMessages`:

```ts
import { defaultMessages, type Messages } from "@gallas-ai/flow-engine";

export const messages: Record<Language, Messages> = {
  en: defaultMessages,
  cs: {
    notUnderstood: () => "Promiňte, tomu úplně nerozumím.",
    flowCancelled: (flowTitle) => `Rozumím, „${flowTitle}“ ruším.`,
    // … all the other texts
  },
  es: { /* … */ },
};
```

## The NLU

The NLU has to understand the customer's language and answer free questions in it. In this example each language has
its own keyword NLU ([nlu.ts](nlu.ts)): "yes", "ano" and "sí" all become `true`, and "Friday", "pátek" and "viernes" all
become `fri`. With an LLM, create one `Nlu` per language that tells the model which language to answer in; see
[docs/nlu.md](../../docs/nlu.md#multiple-languages).

## Limitations

- **The flow title stays English.** The flow's `name` (`title` in code) is shown in three engine messages: a flow put
  aside, a flow cancelled, and "back to …" after a digression. The Czech and Spanish versions of these messages insert
  the English title as it is, e.g. `Rozumím, „Delivery reschedule“ ruším.`
- **Slot descriptions stay English.** Only the NLU reads them, never the customer.
- **No switching mid-conversation.** A running conversation can't move to another language; the next conversation can.
- **Languages, not locales.** Dates, numbers and currencies aren't formatted per country. Do that in your actions if
  you need it.

[test/examples-layout.test.ts](../../test/examples-layout.test.ts) plays all three conversations in both versions.
