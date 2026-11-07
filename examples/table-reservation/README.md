# Reserving a table through a REST API on two servers

A restaurant's bot runs as a REST API on two servers behind a load balancer that sends every message to the other
server. Neither server remembers the conversation: each message continues from the conversation state in a shared
store.

## Run it

From the repository root:

```bash
npm run example -- table-reservation        # both versions
npm run example -- table-reservation yaml   # or: code
```

On Node 22.18 or newer, `node examples/table-reservation/main.ts yaml` works too.

To see each message as a trace in MLflow, start the local OpenTelemetry Collector and MLflow, then run the example with
`OTEL_EXPORTER_OTLP_ENDPOINT` set:

```bash
docker compose -f observability/compose.yaml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run example -- table-reservation
```

Then open <http://localhost:5050>, the **Default** experiment and its **Traces** tab. More in
[Tracing](../../docs/tracing.md#try-it-locally-with-mlflow). All messages of the conversation are one session, although
two servers answered them; the `service.instance.id` attribute of each trace names the server.

## What it does

`main.ts` starts two instances of the REST API (`a` and `b`), a round-robin load balancer in front of them, and plays
the customer, who sends every message to the load balancer. `bot (a)` and `bot (b)` show which instance answered:

```transcript
customer: I'd like to reserve a table
bot (a):  For how many people?
customer: 12 of us
bot (b):  We seat at most 8 people at one table.   ← b knows the question a asked
          For how many people?
customer: 4
bot (a):  Which day?
customer: Friday
bot (b):  What time?
             1) 18:00
             2) 19:30
             3) 21:00
customer: 19:30
bot (a):  A table for 4 on Friday at 19:30. Shall I reserve it?   ← slots filled on both servers
customer: yes
bot (b):  Reserved. See you on Friday at 19:30!
```

## How a message is handled

The REST API takes the request and response of
[Rasa's REST channel](https://rasa.com/docs/reference/channels/your-own-website/):

```http
POST /webhooks/rest/webhook
{"sender": "customer-1", "message": "Friday"}

[{"recipient_id": "customer-1", "text": "What time?\n   1) 18:00\n   2) 19:30\n   3) 21:00"}]
```

`sender` names the conversation. For every message, [`server.ts`](server.ts):

1. locks the conversation, so that no other server handles a message of it at the same time,
2. loads its state from the store (none for a new conversation),
3. creates a new `FlowEngine` with `state`, and hands it the message,
4. saves `engine.state()` and unlocks the conversation.

```ts
const engine = new FlowEngine({ flows, nlu, output: (text) => said.push(text), state: await store.load(sender) });
await engine.handle(message);
await store.save(sender, engine.state());
```

The state is plain JSON. After `4` it is:

```json
{
  "version": 1,
  "frames": [
    {
      "flow": "reserve_table",
      "step": 1,
      "slots": { "guests": 4 },
      "waitingFor": "day",
      "called": false,
      "attempts": 0,
      "failures": [],
      "noAutoSelect": ["guests"],
      "unchecked": []
    }
  ]
}
```

Store it as it is and don't rely on its fields: only `version` is guaranteed. More in
[Saving and restoring a conversation](../../docs/conversation-state.md).

## Files

| File | What it is | In your project |
|---|---|---|
| [`flows.yaml`](flows.yaml), [`flows.ts`](flows.ts) | The reservation flow, in YAML and in code | Your flows |
| [`nlu.ts`](nlu.ts) | Keywords for the fake NLU | An LLM, see [Connecting an LLM](../../docs/nlu.md) |
| [`server.ts`](server.ts) | One instance of the REST API | Your web framework, the same four steps |
| [`store.ts`](store.ts) | The states and the locks, in memory, shared by both instances | Redis or a database, and Redis locks |
| [`load-balancer.ts`](load-balancer.ts) | Sends each request to the next instance | nginx, a cloud load balancer, a Kubernetes Service |

The example runs everything in one process, so that it plays the same every time. The instances share nothing but
the store: neither keeps an engine or anything else between requests. On real servers, the store must be one that all
of them reach, such as Redis.

## Worth knowing

- **The lock matters.** When a customer sends two messages quickly and each reaches a different server, both start from
  the same state, and the one saved last overwrites the other. Retrying a message instead isn't safe: its actions would
  run twice. Rasa solves this the same way, with a
  [lock store](https://rasa.com/docs/reference/integrations/lock-stores/).
- **Only what's in the engine travels.** Anything your actions remember outside the slots, in a variable or a closure,
  stays on the server that ran them. Keep it in the slots, or in your own store under the conversation's id.
- **Changing the flows.** The state names flows by name and steps by position. When the flows change, a new engine
  rejects a state that no longer fits (an unknown flow, a step that doesn't exist or doesn't ask the slot the state waits
  for), but a step that only moved can go unnoticed. Let the conversations on the old flows finish, or keep their states
  apart.
