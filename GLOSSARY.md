# Flow engine

A library for task-oriented conversations: the LLM understands what the customer says, the flows decide what happens
next.

## Language

**Language**:
The human language a conversation is held in, named by a two-letter code (`en`, `cs`, `es`). It is fixed for the whole
conversation and changes only texts, never the flow logic.
_Avoid_: Locale, translation

## Moving between flows

**Routing**:
The NLU picking which flow a customer's message starts. A flow can be hidden from routing, so that only another flow
can start it.
_Avoid_: Intent detection, dispatch

**Link**:
Handing the conversation over to another flow for good: the current flow ends and the linked flow takes its place.
_Avoid_: Redirect, jump

**Call**:
Running another flow in the middle of the current one; when the called flow ends, the calling flow continues where it
stopped.
_Avoid_: Sub-flow, include, nested flow

**Call chain**:
The flow the customer started together with the flows it called, directly or through other called flows. Cancelling or
parking acts on the whole call chain, never on one called flow alone.
_Avoid_: Sub-flow stack

**Parking**:
Setting a call chain aside because the customer switched to another task. The chain continues where it stopped once that
task is over, or as soon as the customer asks for it again.
_Avoid_: Suspending, pausing, interrupting
