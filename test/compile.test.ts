import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { compileFlows, FlowEngine, type ActionResult, type FlowRegistry, type Nlu, type Option, type Slots } from "../src/index.ts";
import { parseCondition } from "../src/condition.ts";
import source from "./fixtures/eshop.yaml?raw";

// ───────────────────────── the shop behind the YAML ─────────────────────────

const delivered: Record<string, { id: string; days: number }> = {
  Brazílie: { id: "P06@1038", days: 12 },
  "moka konvička": { id: "P11@1031", days: 45 },
};

function createRegistry(unshipped: Option[]): FlowRegistry {
  return {
    actions: {
      async action_resolve_item(slots): Promise<ActionResult> {
        const item = Object.values(delivered).find(({ id }) => id === slots.item) ?? delivered[String(slots.item)];
        return item ? { setSlots: { item: item.id, item_days: item.days } } : { setSlots: { item: null } };
      },
      action_create_return: (slots) => ({ say: `Vrácení ${slots.item} založeno.` }),
      action_create_complaint: (slots) => ({ say: `Reklamace ${slots.item} založena.` }),
      action_find_orders_for_address: () => ({ setSlots: { order_candidate_count: unshipped.length } }),
      action_change_address: (slots) => ({ say: `Adresa objednávky ${slots.order_id} změněna na ${slots.address}.` }),
    },
    options: { unshipped_orders: () => unshipped },
  };
}

// ───────────────────────── a fake keyword NLU in Czech ─────────────────────────

const has = (text: string, ...words: string[]) => words.some((word) => text.toLowerCase().includes(word));

const czechNlu: Nlu = {
  async route(text) {
    if (has(text, "vrátit")) return "vraceni";
    if (has(text, "reklam")) return "reklamace";
    if (has(text, "adres")) return "zmena_adresy";
    return null;
  },
  async classifyTurn() {
    return "answer";
  },
  async extract(_flow, wanted, _slots, text, question) {
    const values: Slots = {};
    for (const { name } of wanted) {
      if (name === "item" && has(text, "brazíl")) values.item = "Brazílie";
      if (name === "item" && has(text, "moka")) values.item = "moka konvička";
      if (name === "item" && has(text, "čaj")) values.item = "čaj";
      if (name === "reason" && has(text, "nehodí")) values.reason = "nehodi_se";
      if (name === "reason" && has(text, "rozbit")) values.reason = "vadne";
      if (name === "refund" && has(text, "účet")) values.refund = "ucet";
      if (name === "defect" && has(text, "teče")) values.defect = "teče u těsnění";
      if (name === "resolution" && has(text, "výměn")) values.resolution = "výměna";
      if (name.startsWith("confirm_") && /^ano\b/i.test(text)) values[name] = true;
      if (name.startsWith("confirm_") && /^ne\b/i.test(text)) values[name] = false;
      if (name === "address" && question === "Na jakou adresu?") values.address = text;
    }
    return { values, notAmongOptions: [] };
  },
  async choose() {
    return null;
  },
  async answer(text) {
    return text;
  },
};

function createEngine(unshipped: Option[] = [{ value: "1045", label: "1045 (moka konvička)" }]) {
  const said: string[] = [];
  const engine = new FlowEngine({ flows: compileFlows(parse(source), createRegistry(unshipped)), nlu: czechNlu, output: (text) => said.push(text) });
  const send = async (text: string) => {
    const before = said.length;
    await engine.handle(text);
    return said.slice(before);
  };
  return { engine, send };
}

// ───────────────────────── conversations ─────────────────────────

describe("the e-shop flows from YAML", () => {
  it("walks a return to the end", async () => {
    const { engine, send } = createEngine();
    expect(await send("chci vrátit Brazílii, nehodí se mi")).toEqual(["Jak ti máme vrátit peníze?\n   1) na účet\n   2) kredit +10 %"]);
    expect(await send("na účet")).toEqual(["Vracíš P06@1038, peníze: ucet. Odeslat?"]);
    expect(await send("ano")).toEqual(["Vrácení P06@1038 založeno."]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("asks again for an item that wasn't delivered", async () => {
    const { send } = createEngine();
    expect(await send("chci vrátit čaj")).toEqual(["Tohle zboží mezi doručenými nevidím.", "Jaké zboží?"]);
    expect(await send("Brazílie")).toEqual(["Proč ho vracíš?\n   1) nehodí se\n   2) je vadné"]);
  });

  it("refuses a return after 30 days with the value the action set", async () => {
    const { send } = createEngine();
    expect(await send("chci vrátit moka konvičku")).toEqual([
      "Zboží jsi dostal před 45 dny, vrátit lze jen do 30 dnů. Pokud je vadné, můžeš ho reklamovat.",
      "Jaké zboží?",
    ]);
  });

  it("ends without sending when the customer doesn't confirm", async () => {
    const { engine, send } = createEngine();
    await send("chci vrátit Brazílii, nehodí se mi");
    await send("na účet");
    expect(await send("ne, radši ne")).toEqual(["Dobře, nic jsem neodeslal."]);
    expect(engine.snapshot()).toEqual([]);
  });

  it("switches a defective return to a complaint and keeps the item", async () => {
    const { engine, send } = createEngine();
    expect(await send("chci vrátit Brazílii, je rozbitá")).toEqual([
      "Když je zboží vadné, jde o reklamaci. Přepínám, zboží už mám. 🔧",
      "Co je s ním za problém?",
    ]);
    expect(engine.snapshot()[0]).toMatchObject({ flow: "reklamace", slots: { item: "P06@1038", item_days: 12 } });
    expect(await send("teče")).toEqual(["Jaké řešení chceš?"]);
    expect(await send("výměnu")).toEqual(["Reklamace P06@1038: teče u těsnění, řešení: výměna. Odeslat?"]);
    expect(await send("ano")).toEqual(["Reklamace P06@1038 založena."]);
  });

  it("picks the only unshipped order and rejects an address without a number", async () => {
    const { send } = createEngine();
    expect(await send("chci změnit adresu")).toEqual(["(1045 (moka konvička))", "Na jakou adresu?"]);
    expect(await send("Dlouhá ulice")).toEqual(["Adresa potřebuje číslo popisné.", "Na jakou adresu?"]);
    expect(await send("Dlouhá 5, Praha")).toEqual(["Adresa objednávky 1045 změněna na Dlouhá 5, Praha."]);
  });

  it("ends the address change when there is no unshipped order", async () => {
    const { send } = createEngine([]);
    expect(await send("chci změnit adresu")).toEqual(["Nemáš žádnou neodeslanou objednávku."]);
  });

  it("passes flow titles and descriptions on", () => {
    const flows = compileFlows(parse(source), createRegistry([]));
    expect(flows.vraceni).toMatchObject({ name: "vraceni", title: "Vrácení zboží" });
    expect(flows.vraceni!.description).toMatch(/^Zákazník chce vrátit zboží/);
  });
});

// ───────────────────────── validation ─────────────────────────

describe("compile errors", () => {
  /** Compiles the fixture after `change` broke something in it. */
  const compileBroken = (change: (data: any) => void, registry = createRegistry([])) => () => {
    const data = parse(source);
    change(data);
    return new FlowEngine({ flows: compileFlows(data, registry), nlu: czechNlu, output: () => {} });
  };

  it("names the path of the broken spot", () => {
    expect(compileBroken((data) => (data.flows.vraceni.steps[1].next[2].else = "ask_reasn"))).toThrow(
      'flows.vraceni.steps[1].next[2].else: unknown step "ask_reasn"',
    );
    expect(compileBroken((data) => (data.flows.vraceni.steps[0].descripton = "x"))).toThrow(
      'flows.vraceni.steps[0]: unknown key "descripton"',
    );
    expect(compileBroken((data) => (data.flows.vraceni.steps[1].next[1].if = "slots.item_days >"))).toThrow(
      'flows.vraceni.steps[1].next[1].if: unexpected end in condition "slots.item_days >"',
    );
    expect(compileBroken((data) => delete data.responses.utter_ask_refund)).toThrow(
      'flows.vraceni.steps[3].collect: unknown response "utter_ask_refund"',
    );
    expect(compileBroken((data) => (data.flows.vraceni.steps[7].link = "reklamce"))).toThrow("Flow vraceni: links to unknown flow reklamce");
  });

  it("requires every action in the registry", () => {
    const registry = createRegistry([]);
    delete registry.actions!.action_create_return;
    expect(compileBroken(() => {}, registry)).toThrow('flows.vraceni.steps[5].action: unknown action "action_create_return"');
  });
});

describe("conditions", () => {
  const holds = (condition: string, slots: Slots) => parseCondition(condition)(slots);

  it("compares, tests for null, matches and combines", () => {
    expect(holds("slots.n > 30", { n: 31 })).toBe(true);
    expect(holds("slots.n > 30", { n: "31" })).toBe(false);
    expect(holds("slots.n <= 30 and slots.s = 'a'", { n: 30, s: "a" })).toBe(true);
    expect(holds("slots.x is null", {})).toBe(true);
    expect(holds("slots.x is not null or slots.y", { y: true })).toBe(true);
    expect(holds("not slots.ok", { ok: false })).toBe(true);
    expect(holds('not (slots.a matches "[0-9]")', { a: "Dlouhá 5" })).toBe(false);
    expect(holds('slots.s != "a \\" b"', { s: 'a " b' })).toBe(false);
  });

  it("rejects syntax errors", () => {
    expect(() => parseCondition("slots.a = ")).toThrow("unexpected end");
    expect(() => parseCondition("slots.a == 1 1")).toThrow('unexpected "1"');
    expect(() => parseCondition("item = 1")).toThrow('unexpected "item"');
    expect(() => parseCondition("slots.a ~ 1")).toThrow('unexpected "~"');
    expect(() => parseCondition('slots.a matches "("')).toThrow("invalid regular expression");
  });
});
