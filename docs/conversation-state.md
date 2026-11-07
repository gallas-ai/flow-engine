# Saving and restoring a conversation

An engine keeps the conversation in memory. When your bot runs on several servers behind a load balancer, or a server
restarts between two messages, save the conversation state after each message and continue from it in a new engine.
Then any server can answer the next message, and the load balancer needs no sticky sessions.

## Handling a message

For every customer message:

1. lock the conversation, so that no other server handles a message of it at the same time,
2. load its state (none for a new conversation),
3. create an engine with `state` and hand it the message,
4. save `engine.state()` and unlock the conversation.

```ts
const engine = new FlowEngine({ flows, nlu, output, state: await store.load(conversationId) }); // undefined: a new conversation
await engine.handle(text);
await store.save(conversationId, engine.state());
```

The [table-reservation example](https://github.com/gallas-ai/flow-engine/tree/main/examples/table-reservation) runs a
REST API on two servers behind a load balancer this way.

## What the state holds

The state holds the flow stack with everything the engine needs for the next message: slots, the question it waits for,
parked flows and the counters behind `maxAttempts` and "still not understood". It is plain JSON with a `version`:

```json
{
  "version": 1,
  "frames": [
    { "flow": "reserve_table", "step": 1, "slots": { "guests": 4 }, "waitingFor": "day", "called": false, "attempts": 0, "failures": [], "noAutoSelect": ["guests"], "unchecked": [] }
  ]
}
```

Store it as it is, in Redis, a database or anywhere else, and don't rely on its other fields, which may change.

## Worth knowing

- **Lock the conversation while a message is handled.** Two messages handled at once on two servers both start from the
  same state, and the one saved last overwrites the other. Retrying a message instead isn't safe, because its actions
  would run twice. Rasa does the same with a [lock store](https://rasa.com/docs/reference/integrations/lock-stores/);
  this package leaves storing and locking to you.
- **Only the engine's state travels.** Anything your actions remember outside the slots, in a variable or a closure,
  stays on the server that ran them. Keep it in the slots, or in your own store under the conversation's id.
- **Changing the flows.** The state names flows by name and steps by position. The constructor throws when a state
  doesn't fit the flows (an unknown flow, a step that doesn't exist or doesn't ask the slot the state waits for), but a
  step that only moved can go unnoticed. Let conversations on the old flows finish, or keep their states apart.
