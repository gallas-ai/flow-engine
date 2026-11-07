// A stand-in for Redis, shared by all servers: the state of every conversation, and a lock per conversation.
// In your project, keep the states in Redis or a database, and lock with Redis (SET … NX PX) or your database's locks.
import type { ConversationState } from "../../src/index.ts";

export class ConversationStore {
  private readonly states = new Map<string, string>(); // as JSON, the way Redis would keep them
  private readonly locks = new Map<string, Promise<void>>();

  async load(conversationId: string): Promise<ConversationState | undefined> {
    const state = this.states.get(conversationId);
    return state === undefined ? undefined : JSON.parse(state);
  }

  async save(conversationId: string, state: ConversationState): Promise<void> {
    this.states.set(conversationId, JSON.stringify(state));
  }

  /**
   * Runs `handle` while no other message of the conversation is handled, like Rasa's lock store. Without it, two
   * messages handled at once on two servers start from the same state, and the one saved last overwrites the other.
   */
  async locked<T>(conversationId: string, handle: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const lock = previous.then(() => done); // the next message of this conversation waits for this one
    this.locks.set(conversationId, lock);
    await previous;
    try {
      return await handle();
    } finally {
      release();
      if (this.locks.get(conversationId) === lock) this.locks.delete(conversationId);
    }
  }
}
