# <Topic>: flow brief

Status: draft | approved on <date>
Language the bot speaks: <language>

Repeat everything below for each flow.

## Flow: <name>

### 1. Task

- What the customer wants when this flow starts, in one or two sentences:
- What sounds similar but doesn't belong here, and where it goes instead:
- Who starts it: the customer, or only another flow:
- When it changes something or shows private data: who is allowed to, and how the bot makes sure it is them:

### 2. Information the bot needs

| Information | Kind (text, yes/no, number, one of a list) | Allowed values, or where the list comes from | May come from the customer's first message, or always asked |
|---|---|---|---|

### 3. Rules

| Information | What is turned down | What the bot says then | Checked against a system? | How many attempts | What happens after the last one |
|---|---|---|---|---|---|

### 4. Decisions

| Decision | Outcome | What happens next | Where this path ends |
|---|---|---|---|

List every outcome, including "no" and "not found".

### 5. Systems

| What the bot looks up or changes | When | What it needs | What it gives back | What happens when it fails |
|---|---|---|---|---|

### 6. Other flows

- Hands the customer over to, for good, and what goes along:
- Runs in the middle and then continues, and how a failed run is recognised:
- When the customer switches to another task and comes back, what must not be asked twice:

### 7. What the bot says

| Moment | Text |
|---|---|

Include every question, why the bot asks when the customer wants to know, what it says about a value that isn't on the
list, and what it says when there is nothing to offer.

### 8. Example conversations

The main path and at least one that fails, each ending with the outcome.

```
customer: …
bot:      …
outcome:  …
```
