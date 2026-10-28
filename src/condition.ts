// Conditions in YAML flows: a small subset of Rasa's pypred, parsed once and compiled to a function.
//
//   slots.item is null            slots.item_days > 30          slots.reason = "vadne"
//   not slots.confirm_return      not (slots.address matches ".*[0-9].*")
//
// No eval: the grammar below is the whole language.
//   or         := and ("or" and)*
//   and        := unary ("and" unary)*
//   unary      := "not" unary | comparison
//   comparison := operand (("=" | "==" | "!=" | ">" | ">=" | "<" | "<=") operand | "is" ["not"] "null" | "matches" string)?
//   operand    := slots.<name> | "string" | number | true | false | null | "(" or ")"
import type { SlotValue, Slots } from "./types.ts";

type Value = SlotValue | null;
type Expression = (slots: Slots) => Value;
type Token = { kind: "string" | "number" | "word" | "symbol"; text: string; value?: string | number };

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(-?\d+(?:\.\d+)?)|([A-Za-z_][\w.]*)|(==|!=|>=|<=|[=><()]))/y;
const COMPARISONS: Record<string, (a: Value, b: Value) => boolean> = {
  "=": (a, b) => a === b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">": (a, b) => typeof a === "number" && typeof b === "number" && a > b,
  ">=": (a, b) => typeof a === "number" && typeof b === "number" && a >= b,
  "<": (a, b) => typeof a === "number" && typeof b === "number" && a < b,
  "<=": (a, b) => typeof a === "number" && typeof b === "number" && a <= b,
};

/** Parses a condition; throws on a syntax error. A slot that isn't set is null. */
export function parseCondition(source: string): (slots: Slots) => boolean {
  const tokens = tokenize(source);
  let position = 0;
  const fail = (message: string): never => { throw new Error(`${message} in condition "${source}"`); };
  const peek = () => tokens[position];
  const accept = (text: string) => (peek()?.kind !== "string" && peek()?.text === text ? tokens[position++] : undefined);
  const expect = (text: string) => accept(text) ?? fail(`expected "${text}"`);

  const parseOr = (): Expression => {
    let left = parseAnd();
    while (accept("or")) {
      const [a, b] = [left, parseAnd()];
      left = (slots) => Boolean(a(slots)) || Boolean(b(slots));
    }
    return left;
  };
  const parseAnd = (): Expression => {
    let left = parseUnary();
    while (accept("and")) {
      const [a, b] = [left, parseUnary()];
      left = (slots) => Boolean(a(slots)) && Boolean(b(slots));
    }
    return left;
  };
  const parseUnary = (): Expression => {
    if (accept("not")) {
      const operand = parseUnary();
      return (slots) => !operand(slots);
    }
    return parseComparison();
  };
  const parseComparison = (): Expression => {
    const left = parseOperand();
    if (accept("is")) {
      const negated = Boolean(accept("not"));
      expect("null");
      return (slots) => (left(slots) === null) !== negated;
    }
    if (accept("matches")) {
      const token = tokens[position++];
      if (token?.kind !== "string") return fail(`expected a string after "matches"`);
      let pattern: RegExp;
      try { pattern = new RegExp(token.value as string); } catch { return fail(`invalid regular expression ${token.text}`); }
      return (slots) => { const value = left(slots); return typeof value === "string" && pattern.test(value); };
    }
    const operator = peek()?.kind === "symbol" ? COMPARISONS[peek()!.text] : undefined;
    if (!operator) return left;
    position++;
    const right = parseOperand();
    return (slots) => operator(left(slots), right(slots));
  };
  const parseOperand = (): Expression => {
    const token = tokens[position++] ?? fail("unexpected end");
    if (token.kind === "string" || token.kind === "number") return () => token.value!;
    if (token.text === "(") {
      const inner = parseOr();
      expect(")");
      return inner;
    }
    if (token.text === "true") return () => true;
    if (token.text === "false") return () => false;
    if (token.text === "null") return () => null;
    const name = /^slots\.(\w+)$/.exec(token.text)?.[1];
    if (token.kind === "word" && name) return (slots) => slots[name] ?? null;
    return fail(`unexpected "${token.text}"`);
  };

  const condition = parseOr();
  if (position < tokens.length) fail(`unexpected "${tokens[position]!.text}"`);
  return (slots) => Boolean(condition(slots));
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    if (!source.slice(TOKEN.lastIndex).trim()) break;
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) throw new Error(`unexpected "${source.slice(start).trim()[0]}" in condition "${source}"`);
    const [, string, number, word, symbol] = match;
    if (string) tokens.push({ kind: "string", text: string, value: string.slice(1, -1).replace(/\\(["'\\])/g, "$1") });
    else if (number) tokens.push({ kind: "number", text: number, value: Number(number) });
    else if (word) tokens.push({ kind: "word", text: word });
    else tokens.push({ kind: "symbol", text: symbol! });
  }
  return tokens;
}
