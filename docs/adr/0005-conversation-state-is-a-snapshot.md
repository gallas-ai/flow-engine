# The conversation state is a snapshot the application stores

Status: accepted

To run the engine on several servers behind a load balancer, a conversation must continue on whichever server gets the
next message. `engine.state()` returns the whole conversation state as JSON and `new FlowEngine({ …, state })`
continues from it; storing it and locking a conversation while one message is handled are left to the application.
Rasa keeps conversations in a tracker store as a history of events, replayed when it loads one, and serialises
messages of one conversation with a lock store. Both are part of the Rasa server; this package is a library, not a
server.

## Considered options

- **A `ConversationStore` interface in the engine options and `handle(conversationId, text)`.** Closer to Rasa's
  tracker store, and one engine would serve every conversation. But it breaks `handle(text)`, and the engine would have
  to know about storage and locking, which every application does differently (Redis, SQL, …).
- **A history of events instead of a snapshot, as in Rasa.** It allows replaying and auditing a conversation, but the
  engine would need an event for every change to its frames, and replaying would run the steps again. `onEvent` and
  tracing already give a history for debugging.

## Consequences

- The state names flows by name and steps by index, because a step's `id` is optional. A state saved before the flows
  changed can point to a different step. The constructor rejects what it can detect (an unknown flow, a step out of
  range, a slot the step doesn't ask for); the rest is the application's job: let old conversations finish, or keep
  states of different flow versions apart.
- The state has a `version` field. Its fields are internal and may change; only a state of a supported `version` is
  guaranteed to load.
- Without a lock per conversation, two messages handled at once on two servers both start from the same state, and one
  overwrites the other. Retrying a message instead is unsafe: its actions would run twice.
