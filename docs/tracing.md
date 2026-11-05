# Tracing

The engine can trace every customer message as an [OpenTelemetry](https://opentelemetry.io/) trace: which flow the NLU
picked, how it classified the message, what it extracted, which steps ran, what the actions and `verify` returned and
how long each part took. The engine has no dependency on OpenTelemetry: you pass it a tracer, and without one it traces
nothing.

## Turning it on

Set up the OpenTelemetry SDK once at startup, then pass a tracer from `@opentelemetry/api`:

```ts
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { FlowEngine } from "@gallas-ai/flow-engine";

new NodeTracerProvider({ spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())] }).register();

const engine = new FlowEngine({
  flows,
  nlu,
  output: (text) => send(text),
  tracer: trace.getTracer("my-bot"),
  traceAttributes: { "session.id": conversationId }, // optional: on the span of each message
  recordContent: true, // optional: texts and slot values on the spans, see below
});
```

| Option | Default | What it does |
|---|---|---|
| `tracer` | none | Any object with OpenTelemetry's `startActiveSpan`. `trace.getTracer(…)` fits as it is |
| `traceAttributes` | `{}` | Attributes put as they are on the span of each message and each `start()`, e.g. `session.id` to group a conversation's messages |
| `recordContent` | `false` | Puts customer texts, bot lines, slot values, NLU results and action results on the spans |

`startActiveSpan` makes each span active while it runs. A span opened inside your `Nlu` or an action, such as one from
an instrumented LLM SDK, nests under the engine's span, and a span you open around `engine.handle()` becomes the parent
of the message's span.

## What gets traced

One trace per `engine.handle(text)` call, and one per `engine.start(…)` called from your code:

```
FlowEngine.handle               one customer message
├─ Nlu.route / Nlu.classifyTurn
├─ FlowEngine.fill              reading slot values from the message
│  ├─ Nlu.extract
│  └─ Nlu.choose
├─ FlowEngine.run_step          one per step that ran: collect, say, set, goto, link, call, action, end
│  ├─ action                    an action step's action
│  └─ verify                    a collect step's verify
└─ Nlu.answer
```

A flow often lives across several messages, so there is no span per flow. The `flowStarted` and `flowEnded` events show
where a flow starts and ends.

All attributes start with `flow_engine.`. Their names follow
[Rasa's tracing](https://rasa.com/docs/reference/integrations/tracing/) where Rasa has the same thing
(`current_flow_id`, `step_custom_id`, `action_name`).

| Span | Attributes |
|---|---|
| `FlowEngine.handle` | `current_flow_id` and `waiting_for`: the top flow and the slot it waited for when the message came in. `stack_depth`, `turn_type`, `routed_flow` |
| `FlowEngine.start` | `current_flow_id`: the started flow |
| `Nlu.*` | `current_flow_id`. `route` adds `flow_count`, the number of flows offered. `extract` adds `wanted`, the slot names it looks for |
| `FlowEngine.fill` | `current_flow_id`, `prefill` (reading the opening message), `filled` (the slot names that got a value) |
| `FlowEngine.run_step` | `current_flow_id`, `step_index`, `step_kind`, `step_custom_id` (the step's `id`). A collect step adds `slot` and `skipped` (true when the slot already had a value). A call or link step adds `target_flow` |
| `action`, `verify` | `action_name`: the action function's name, which for YAML flows is its name in the registry. `verify` adds `slot` and `accepted` |

Each line the bot says is an `output` event on the span that said it. The engine's
[events](https://github.com/gallas-ai/flow-engine/blob/main/docs/nlu.md#engine-options) (`routed`, `turnClassified`,
`flowStarted`, `flowEnded`, `slotsPrefilled`, `slotsExtracted`) are events on the span they happen in, with their fields
as attributes. `onEvent` still gets them all.

An error thrown by your `Nlu` or an action is recorded on every span it passes through, and their status is set to
`ERROR`. The error then reaches your code as it would without tracing.

## Content and personal data

Customer texts and slot values can hold personal data, so by default the spans hold only names: flows, steps, slots and
turn types. The `output` events then have no text, and the slot events list only slot names. Rasa keeps them out of its
spans too.

With `recordContent: true`, the spans also get:

- `flow_engine.input` and `flow_engine.output`, as JSON: the message and the bot's lines on `FlowEngine.handle`, the
  arguments and results on `Nlu.*`, the slots and the `ActionResult` on `action` and `verify`, and the values that
  passed on `FlowEngine.fill`
- the text in each `output` event, and the slot values in the slot events

## Try it locally with MLflow

The repository has a Docker Compose setup with an OpenTelemetry Collector and [MLflow](https://mlflow.org/), and the
examples trace their conversations when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. From a clone of the repository:

```bash
docker compose -f observability/compose.yaml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run example -- appointments
```

Open MLflow at <http://localhost:5050>, then the **Default** experiment and its **Traces** tab. Each customer message is
one trace. The **Group by session** button above the list groups a conversation's messages by their `session.id`, which
MLflow reads from the root span. The examples turn `recordContent` on, so you see each span's inputs and outputs.

- The collector receives OTLP on ports 4317 (gRPC) and 4318 (HTTP). It prints a line per batch (`docker compose -f
  observability/compose.yaml logs -f otel-collector`) and sends the spans on to MLflow. MLflow takes only OTLP over HTTP
  and needs a SQL backend store, here SQLite.
- MLflow shows a span's inputs and outputs from its own attributes (`mlflow.spanInputs`, `mlflow.spanOutputs`). The
  collector's `transform` processor copies the engine's `flow_engine.input` and `flow_engine.output` into them, so the
  engine needs no MLflow-specific code. See `observability/otel-collector.yaml`.
- MLflow runs on port 5050, because macOS often holds 5000 for AirPlay. Pick another port with
  `MLFLOW_PORT=5051 docker compose -f observability/compose.yaml up -d`.
- Stop it with `docker compose -f observability/compose.yaml down`. Add `-v` to delete the stored traces as well.
