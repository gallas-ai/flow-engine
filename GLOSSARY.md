# Flow engine

A library for task-oriented conversations: the LLM understands what the customer says, the flows decide what happens
next.

## Language

**Language**:
The human language a conversation is held in, named by a two-letter code (`en`, `cs`, `es`). It is fixed for the whole
conversation and changes only texts, never the flow logic.
_Avoid_: Locale, translation
