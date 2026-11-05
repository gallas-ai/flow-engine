# Returns and complaints in three languages

One bot tells a return from a complaint and from a plain question, in English, Czech and Spanish, helped by a few
example messages per language.

## Run it

From the repository root:

```bash
npm run example -- returns-and-complaints        # both versions
npm run example -- returns-and-complaints yaml   # or: code
```

On Node 22.18 or newer, `node examples/returns-and-complaints/main.ts yaml` works too.

To see each message as a trace in MLflow, start the local OpenTelemetry Collector and MLflow, then run the example with
`OTEL_EXPORTER_OTLP_ENDPOINT` set:

```bash
docker compose -f observability/compose.yaml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run example -- returns-and-complaints
```

Then open <http://localhost:5050>, the **Default** experiment and its **Traces** tab. More in
[Tracing](../../docs/tracing.md#try-it-locally-with-mlflow).

## What it does

Three conversations in each language, one for each thing `route` can decide. No message is copied from the examples:
each one is only close to an example.

### English

```transcript
customer: my plate arrived cracked                  ← closest example: "this mug arrived cracked" → complaint
bot:      What is your order number?
customer: 10234
bot:      We're sorry. The complaint about order 10234 is open.

customer: I want my money back for this plate       ← closest example: "… I want my money back" → refund
bot:      What is your order number?
customer: 10234
bot:      The refund for order 10234 has started.

customer: how long do I have to send it back?       ← closest example: "how long do I have to return something?" → null
bot:      Items can be returned within 30 days of delivery.
```

### Czech

```transcript
customer: talíř přišel prasklý                      ← closest example: "ten hrnek přišel prasklý" → complaint
bot:      Jaké je číslo vaší objednávky?
customer: 10234
bot:      Omlouváme se. Reklamace objednávky 10234 je založená.

customer: chci zpátky peníze za tenhle talíř        ← closest example: "… chci zpátky peníze" → refund
bot:      Jaké je číslo vaší objednávky?
customer: 10234
bot:      Vrácení peněz za objednávku 10234 je spuštěné.

customer: do kdy můžu poslat zboží zpátky?          ← closest example: "do kdy můžu zboží vrátit?" → null
bot:      Zboží můžete vrátit do 30 dnů od doručení.
```

### Spanish

```transcript
customer: la jarra llegó rota                       ← closest example: "esta taza llegó rota" → complaint
bot:      ¿Cuál es su número de pedido?
customer: 10234
bot:      Lo sentimos. La reclamación del pedido 10234 está abierta.

customer: quiero que me devuelvan el dinero de este plato   ← closest example: "… quiero que me devuelvan el dinero" → refund
bot:      ¿Cuál es su número de pedido?
customer: 10234
bot:      El reembolso del pedido 10234 está en marcha.

customer: ¿cuánto tiempo tengo para enviar la taza?   ← closest example: "¿cuánto tiempo tengo para devolver algo?" → null
bot:      Puede devolver los artículos en un plazo de 30 días desde la entrega.
```

## How it works

The flows say when they apply in their `description`, and those stay in English. The examples sit next to them where
the descriptions can't draw the line: between two similar flows, and between a task and a question about it. They are
part of the NLU, one list per language, because they show how customers phrase a request ([nlu.ts](nlu.ts)):

```ts
const examples: Record<Language, Example[]> = {
  en: [
    { text: "this mug arrived cracked", flow: "complaint" },
    { text: "I don't need this mug any more, I want my money back", flow: "refund" },
    { text: "how long do I have to return something?", flow: null }, // no flow: the bot just answers
  ],
  cs: [/* … */],
  es: [/* … */],
};
```

The engine, the flows and the YAML know nothing about the examples. Each language gets its own NLU, and the application
creates the engine with the NLU of the customer's language:

```ts
const engine = new FlowEngine({ flows: flows[language], nlu: nlu[language], output: send });
```

| File | What it is |
|---|---|
| [nlu.ts](nlu.ts) | The examples per language and the stand-in for the LLM |
| [flows.yaml](flows.yaml) | The flows in YAML, without any texts |
| [responses.en.yaml](responses.en.yaml), [responses.cs.yaml](responses.cs.yaml), [responses.es.yaml](responses.es.yaml) | The flows' texts per language |
| [flows.ts](flows.ts), [texts.ts](texts.ts) | The same flows and texts in code |
| [languages.ts](languages.ts) | The list of languages and the `Language` type |
| [main.ts](main.ts) | Plays the conversations above |

## The stand-in for the LLM

This example runs without an LLM. `routeWith` in [nlu.ts](nlu.ts) picks the example that shares the most words with the
message, and no flow when no word matches. So the list really decides: change an example and the bot picks a different
flow.

That shows how the examples are wired in, not how accurate they make an LLM. With a real one, the same list goes into
the prompt of `route`; see [docs/nlu.md](../../docs/nlu.md#few-shot-examples-in-route).

## Limitations

- **Word matching is not understanding.** The stand-in doesn't know that "plate" and "mug" are alike, and it can't
  handle a message that shares no words with an example.
- **The engine's own texts stay English.** These conversations never reach one. The
  [delivery-reschedule](../delivery-reschedule) example shows how to translate them.
- **No hidden flows here.** The prompt in `docs/nlu.md` leaves out examples of flows that are hidden from routing; this
  example has no such flow.

[test/examples-layout.test.ts](../../test/examples-layout.test.ts) plays all the conversations in both versions.
