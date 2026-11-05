// Traces the examples when OTEL_EXPORTER_OTLP_ENDPOINT is set: see docs/tracing.md.
// In your project, set up OpenTelemetry once at startup and pass its tracer to the engine the same way.
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { FlowEngineOptions } from "../../src/index.ts";

let provider: NodeTracerProvider | undefined;
let run = "";
let conversations = 0;

export function startTracing(example: string): void {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": "flow-engine-examples" }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())], // sends to $OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces
  });
  provider.register();
  run = `${example} ${new Date().toISOString().slice(0, 19)}`;
}

/** Engine options that trace one conversation as a session of its own; none while tracing is off. */
export function tracing(): Partial<FlowEngineOptions> {
  if (!provider) return {};
  return { tracer: trace.getTracer("flow-engine-examples"), recordContent: true, traceAttributes: { "session.id": `${run} #${++conversations}` } };
}

/** Sends the spans still waiting in the batch. */
export async function stopTracing(): Promise<void> {
  await provider?.shutdown();
}
