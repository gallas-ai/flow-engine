// Prints a conversation the way the examples' READMEs show it:
//
//   customer: I want to verify myself
//   bot:      What is your e-mail address?
//             (a second line the bot said in the same turn)
const INDENT = " ".repeat("customer: ".length);

export function transcript(print: (line: string) => void = console.log) {
  let botTurn = false;
  const lines = (label: string, text: string) =>
    text.split("\n").forEach((line, i) => print(`${i === 0 ? label.padEnd(INDENT.length) : INDENT}${line}`.trimEnd()));
  return {
    customer(text: string) {
      botTurn = false;
      lines("customer:", text);
    },
    /** Pass as the engine's `output`. `label` names who answers, e.g. `bot (a)` for one of several servers. */
    bot(text: string, label = "bot") {
      lines(botTurn ? "" : `${label}:`, text);
      botTurn = true;
    },
  };
}

/**
 * The variants to play: the one named on the command line, or all of them.
 * Exits with a usage message when the name is unknown.
 */
export function selectVariants<T extends string>(variants: readonly T[], arg = process.argv[2]): T[] {
  if (arg === undefined) return [...variants];
  if ((variants as readonly string[]).includes(arg)) return [arg as T];
  console.error(`Unknown variant "${arg}". Use one of: ${variants.join(", ")}.`);
  process.exit(1);
}
