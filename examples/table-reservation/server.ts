// One instance of the bot's REST API, with the request and response of Rasa's REST channel:
//   POST /webhooks/rest/webhook  {"sender": "c-1", "message": "Hi"}  →  [{"recipient_id": "c-1", "text": "…"}]
// It keeps nothing between requests: every message gets a new engine, which continues from the state in the store.
// In your project, import from "@gallas-ai/flow-engine" instead of the source.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { FlowEngine, type Flow } from "../../src/index.ts";
import { tracing } from "../shared/tracing.ts";
import { nlu } from "./nlu.ts";
import type { ConversationStore } from "./store.ts";

export type Server = { url: string; close: () => Promise<void> };

export async function startServer(instance: string, flows: Record<string, Flow>, store: ConversationStore): Promise<Server> {
  /** Handles one message of the conversation `sender` and returns what the bot said. */
  const reply = (sender: string, message: string) =>
    store.locked(sender, async () => {
      const said: string[] = [];
      const engine = new FlowEngine({
        flows,
        nlu,
        output: (text) => said.push(text),
        state: await store.load(sender), // undefined for a new conversation
        ...tracing(sender, { "service.instance.id": instance }),
      });
      await engine.handle(message);
      await store.save(sender, engine.state());
      return said;
    });

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/webhooks/rest/webhook") {
      response.writeHead(404).end();
      return;
    }
    const { sender, message } = JSON.parse(await body(request)) as { sender: string; message: string };
    const said = await reply(sender, message);
    response.writeHead(200, { "content-type": "application/json", "x-served-by": instance });
    response.end(JSON.stringify(said.map((text) => ({ recipient_id: sender, text }))));
  });
  return listen(server);
}

export async function body(request: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
}

/** Starts listening on a free port. */
export async function listen(server: ReturnType<typeof createServer>): Promise<Server> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
