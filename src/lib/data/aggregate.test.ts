import { describe, expect, it } from "vitest";
import {
  addAggregate,
  buildBreakdowns,
  buildDaily,
  buildSessionTree,
  emptyAggregate,
  filterRowsByPeriod,
  normalizeDir,
  rowsForToday,
  rowToAggRow,
  sumAggregates,
  type AggRow,
  type SessionRawRow,
} from "@/lib/data/aggregate";
import { buildModelIndex } from "@/lib/data/pricing";
import type { TokenSet } from "@/lib/data/types";

const modelsJson = JSON.stringify({
  anthropic: { models: {
    "claude-sonnet-5-5": { cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 } },
    "claude-haiku-4-5": { cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } },
  } },
  "minimax-coding-plan": { models: {
    "MiniMax-M3": { cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
  } },
  minimax: { models: {
    "MiniMax-M3": { cost: { input: 0.3, output: 1.2, cache_read: 0.06, cache_write: 0.375 } },
  } },
});
const models = buildModelIndex(modelsJson);

function t(over: Partial<TokenSet> = {}): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, ...over };
}

function row(over: Partial<AggRow>): AggRow {
  return {
    date: "2026-10-18",
    providerId: "anthropic",
    modelId: "claude-sonnet-5-5",
    agent: "chefe",
    directory: "C:/projetos",
    cost: 0,
    tokens: t(),
    messages: 1,
    sessions: new Set(["s1"]),
    ...over,
  };
}

describe("aggregate", () => {
  describe("helpers", () => {
    it("emptyAggregate / addAggregate", () => {
      const a = emptyAggregate();
      const b = { cost: 1, apiEquivalentCost: 0.5, referenceCost: 1.5, tokens: t({ input: 10 }), messages: 2, sessions: 1 };
      const c = addAggregate(a, b);
      expect(c.cost).toBe(1);
      expect(c.tokens.input).toBe(10);
    });
    it("sumAggregates agrega várias entradas", () => {
      const xs = [
        { cost: 1, apiEquivalentCost: 0, referenceCost: 0, tokens: t({ input: 10 }), messages: 1, sessions: 0 },
        { cost: 2, apiEquivalentCost: 0, referenceCost: 0, tokens: t({ input: 5 }), messages: 1, sessions: 0 },
      ];
      const s = sumAggregates(xs);
      expect(s.cost).toBe(3);
      expect(s.tokens.input).toBe(15);
    });
  });

  describe("normalizeDir", () => {
    it("substitui barras invertidas por '/'", () => {
      expect(normalizeDir("C:\\projetos\\opencode-hud")).toBe("C:/projetos/opencode-hud");
    });
    it("mantém barras '/' inalteradas", () => {
      expect(normalizeDir("C:/projetos")).toBe("C:/projetos");
    });
  });

  describe("rowToAggRow", () => {
    it("converte RawRow em AggRow com data local", () => {
      const dayMs = new Date(2026, 9, 18, 13, 30, 0).getTime();
      const r = rowToAggRow({
        dayMs,
        providerId: "anthropic",
        modelId: "claude-sonnet-5-5",
        agent: "chefe",
        directory: "C:\\projetos",
        cost: 0.05,
        tokens: t({ input: 100, output: 50 }),
        messages: 3,
      }, () => "ses_x");
      expect(r.date).toBe("2026-10-18");
      expect(r.directory).toBe("C:/projetos");
      expect(r.sessions.has("ses_x")).toBe(true);
    });
  });

  describe("filterRowsByPeriod e rowsForToday", () => {
    const rows: AggRow[] = [
      row({ date: "2026-10-12", cost: 1 }),
      row({ date: "2026-10-15", cost: 2 }),
      row({ date: "2026-10-18", cost: 3 }),
    ];
    const now = new Date(2026, 9, 18, 14, 0);

    it("7d inclui hoje e os 6 dias anteriores", () => {
      const f = filterRowsByPeriod(rows, "7d", now);
      expect(f.map((r) => r.date).sort()).toEqual(["2026-10-12", "2026-10-15", "2026-10-18"]);
    });
    it("today inclui só hoje", () => {
      const f = filterRowsByPeriod(rows, "today", now);
      expect(f).toHaveLength(1);
    });
    it("all retorna tudo", () => {
      expect(filterRowsByPeriod(rows, "all", now)).toHaveLength(3);
    });
    it("rowsForToday filtra só hoje", () => {
      const t = rowsForToday(rows, now);
      expect(t).toHaveLength(1);
    });
  });

  describe("buildBreakdowns", () => {
    const ref = "anthropic/claude-sonnet-5-5";
    const rows: AggRow[] = [
      row({ cost: 1, tokens: t({ input: 1_000_000 }), sessions: new Set(["s1"]) }),
      row({ cost: 2, providerId: "anthropic", modelId: "claude-haiku-4-5", tokens: t({ input: 500_000 }), sessions: new Set(["s2"]) }),
    ];

    it("byModel separa modelos", () => {
      const { byModel } = buildBreakdowns(rows, models, ref);
      expect(byModel).toHaveLength(2);
      const sonnet = byModel.find((b) => b.key === "anthropic/claude-sonnet-5-5")!;
      expect(sonnet.aggregate.cost).toBe(1);
      expect(sonnet.aggregate.sessions).toBe(1);
      // apiEquivalent: input 1M * 2 = 2 USD
      expect(sonnet.aggregate.apiEquivalentCost).toBeCloseTo(2, 6);
    });

    it("byProject usa última pasta do directory normalizado", () => {
      // Passa por rowToAggRow para acionar a normalização (\\ -> /).
      const terceira = rowToAggRow({
        dayMs: new Date(2026, 9, 18, 14, 0).getTime(),
        providerId: "anthropic",
        modelId: "claude-sonnet-5-5",
        agent: "chefe",
        directory: "C:\\outro\\proj",
        cost: 0.5,
        tokens: t(),
        messages: 1,
      }, () => "s3");
      const { byProject } = buildBreakdowns(
        [...rows, terceira],
        models,
        ref,
      );
      // default é C:/projetos (label "projetos") e o outro é "C:/outro/proj" (label "proj")
      expect(byProject.map((b) => b.label).sort()).toEqual(["proj", "projetos"]);
      const proj = byProject.find((b) => b.path === "C:/projetos")!;
      expect(proj.path).toBe("C:/projetos");
    });

    it("apiEquivalent cai no fallback para MiniMax-M3", () => {
      const r: AggRow = row({ providerId: "minimax-coding-plan", modelId: "MiniMax-M3", cost: 0, tokens: t({ input: 1_000_000 }) });
      const { byModel } = buildBreakdowns([r], models, ref);
      // fallback para minimax/MiniMax-M3 com input 0.3 → 0.3 USD
      expect(byModel[0]!.aggregate.apiEquivalentCost).toBeCloseTo(0.3, 6);
      // chave usa providerId canônico do fallback
      expect(byModel[0]!.key).toBe("minimax/MiniMax-M3");
    });
  });

  describe("buildDaily", () => {
    const ref = "anthropic/claude-sonnet-5-5";
    const rows: AggRow[] = [
      row({ date: "2026-10-12", cost: 1, tokens: t({ input: 1_000_000 }) }),
      row({ date: "2026-10-18", cost: 3, tokens: t({ input: 2_000_000 }) }),
    ];
    const now = new Date(2026, 9, 18, 14, 0);

    it("preenche os dias do período (7d) com zeros onde não há dados", () => {
      const days = buildDaily(rows, models, ref, "7d", now);
      expect(days).toHaveLength(7);
      // primeiro dia = 2026-10-12 (data de início de 7d, hoje = 18)
      expect(days[0]!.date).toBe("2026-10-12");
      expect(days[0]!.aggregate.cost).toBe(1);
      expect(days[days.length - 1]!.date).toBe("2026-10-18");
      expect(days[days.length - 1]!.aggregate.cost).toBe(3);
      const vazios = days.filter((d) => d.date !== "2026-10-12" && d.date !== "2026-10-18");
      for (const d of vazios) {
        expect(d.aggregate.cost).toBe(0);
        expect(d.aggregate.tokens.input).toBe(0);
      }
    });

    it("preenche 365 dias em 'all'", () => {
      const days = buildDaily(rows, models, ref, "all", now);
      expect(days).toHaveLength(365);
    });
  });

  describe("buildSessionTree", () => {
    function session(over: Partial<SessionRawRow>): SessionRawRow {
      return {
        id: "s1",
        title: "t",
        agent: "chefe",
        providerId: "anthropic",
        modelId: "claude-sonnet-5-5",
        directory: "C:/projetos",
        parentId: null,
        timeCreated: 0,
        timeUpdated: 0,
        archived: false,
        selfAggregate: { cost: 1, apiEquivalentCost: 0, referenceCost: 0, tokens: t({ input: 10 }), messages: 2, sessions: 1 },
        ...over,
      };
    }

    it("raiz agrega a si mesma + descendentes (sem dupla contagem)", () => {
      const sessions = [
        session({ id: "r" }),
        session({ id: "c1", parentId: "r", selfAggregate: { cost: 2, apiEquivalentCost: 0, referenceCost: 0, tokens: t({ input: 5 }), messages: 1, sessions: 1 } }),
        session({ id: "g1", parentId: "c1", selfAggregate: { cost: 4, apiEquivalentCost: 0, referenceCost: 0, tokens: t({ input: 7 }), messages: 3, sessions: 1 } }),
        session({ id: "outro" }),
      ];
      const { roots } = buildSessionTree(sessions);
      const raiz = roots.find((n) => n.id === "r")!;
      // Raiz agrega self + child + grandchild = 1 + 2 + 4 = 7
      expect(raiz.aggregate.cost).toBe(7);
      expect(raiz.aggregate.tokens.input).toBe(22);
      expect(raiz.aggregate.messages).toBe(6);
      expect(raiz.aggregate.sessions).toBe(3);
      // Filhos aninhados em children
      expect(raiz.children).toHaveLength(1);
      expect(raiz.children![0]!.id).toBe("c1");
      expect(raiz.children![0]!.children![0]!.id).toBe("g1");
      // "outro" continua como raiz independente
      expect(roots.find((n) => n.id === "outro")).toBeDefined();
    });
  });
});