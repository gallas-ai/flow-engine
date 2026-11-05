# Our own Tracer interface instead of a dependency on @opentelemetry/api

Status: accepted

The engine traces with OpenTelemetry, but it doesn't depend on `@opentelemetry/api`. The `tracer` option takes
`Tracer`, an interface of our own with only what the engine calls: `startActiveSpan`, and on the span `setAttribute`,
`addEvent`, `recordException`, `setStatus` and `end`. A tracer from `trace.getTracer()` fits it as it is, so users write
no adapter. Rasa has no counterpart: it configures tracing in `endpoints.yml` and brings its own exporters.

## Considered options

- **`@opentelemetry/api` as an (optional peer) dependency.** OpenTelemetry recommends that libraries depend on the API:
  without an SDK it does nothing, and the library could get its tracer by itself. But the package would no longer be
  dependency-free, and its published types would point to a package the user may not have.
- **No change to the engine; spans built from `onEvent`.** It needs nothing new, but the events carry no durations, and
  spans opened inside `Nlu` or an action can't nest under the engine's.

## Consequences

- Without a `tracer`, the engine traces nothing and pays almost nothing for it: every span is a no-op object.
- The interface must stay a structural subset of OpenTelemetry's `Tracer` and `Span`. Because `startActiveSpan` is
  generic, TypeScript doesn't check its span strictly, so `test/opentelemetry.test.ts` checks that OpenTelemetry's
  `Span` fits `TracerSpan` and runs the engine against the real SDK.
- Any other tracer with the same shape works too, e.g. a fake one in tests.
- Content (texts, slot values) goes on spans only with `recordContent`. The attribute names `flow_engine.input` and
  `flow_engine.output` are neutral; a backend such as MLflow gets its own names from the collector, not from the engine.
