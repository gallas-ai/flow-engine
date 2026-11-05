// The engine's `Tracer` against the real OpenTelemetry SDK: the tracer fits without an adapter, and spans nest.
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { FlowEngine, type Flow, type Nlu, type Slots, type TracerSpan } from "../src/index.ts";

// `startActiveSpan` is generic, which makes TypeScript lenient about its span: check the span on its own.
const spanFits = (span: Span): TracerSpan => span;
void spanFits;

const exporter = new InMemorySpanExporter();
new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();

const order: Flow = {
  name: "order",
  title: "Order",
  slots: [{ name: "item", type: "text", description: "what to order", question: () => "What would you like?" }],
  steps: [{ kind: "collect", slot: "item" }, { kind: "action", run: (slots) => ({ say: `Ordered ${slots.item}.` }) }],
};

/** An NLU like one built on an instrumented LLM SDK: each call opens a span of its own. */
const nlu: Nlu = {
  async route() {
    return "order";
  },
  async classifyTurn() {
    return "answer";
  },
  async extract(_flow, _wanted, _slots, text) {
    return trace.getTracer("llm-sdk").startActiveSpan("llm.chat", async (span) => {
      const values: Slots = text.includes("tea") ? { item: "tea" } : {};
      span.end();
      return { values, notAmongOptions: [] };
    });
  },
  async choose() {
    return null;
  },
  async answer(text) {
    return text;
  },
};

describe("tracing with OpenTelemetry", () => {
  it("takes the tracer from @opentelemetry/api, and spans opened inside the NLU nest under the engine's", async () => {
    const engine = new FlowEngine({ flows: { order }, nlu, output: () => {}, tracer: trace.getTracer("flow-engine") });
    await engine.handle("I want to order tea");

    const spans = exporter.getFinishedSpans();
    const span = (name: string) => spans.find((span) => span.name === name)!;
    const parent = (child: ReadableSpan) => spans.find((span) => span.spanContext().spanId === child.parentSpanContext?.spanId)?.name;
    expect(parent(span("llm.chat"))).toBe("Nlu.extract");
    expect(parent(span("Nlu.extract"))).toBe("FlowEngine.fill");
    expect(parent(span("FlowEngine.fill"))).toBe("FlowEngine.handle");
    expect(span("FlowEngine.handle").parentSpanContext).toBeUndefined();
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);
    expect(span("FlowEngine.handle").attributes).toMatchObject({ "flow_engine.routed_flow": "order" });
    expect(span("FlowEngine.handle").events.map((event) => event.name)).toEqual(["routed", "flowStarted"]);
  });

  it("marks the spans an error passes through", async () => {
    exporter.reset();
    const failing: Nlu = { ...nlu, extract: () => Promise.reject(new Error("LLM down")) };
    const engine = new FlowEngine({ flows: { order }, nlu: failing, output: () => {}, tracer: trace.getTracer("flow-engine") });
    await expect(engine.handle("I want to order tea")).rejects.toThrow("LLM down");

    const handle = exporter.getFinishedSpans().find((span) => span.name === "FlowEngine.handle")!;
    expect(handle.status).toEqual({ code: SpanStatusCode.ERROR, message: "LLM down" });
    expect(handle.events.map((event) => event.name)).toContain("exception");
  });
});
