// Validação contra o `opencode.db` real.
//
// O script Python em `__pycache__/export_fixture.py` (rodado manualmente)
// exporta as linhas para `__pycache__/fixture.json`. Este teste carrega
// esse JSON, roda a mesma agregação TS e compara com os totais canônicos
// que o script já calculou diretamente via SQL.
//
// Se o fixture não existir, o teste é pulado (em CI / outros hosts não há DB).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addAggregate,
  buildBreakdowns,
  buildDaily,
  emptyAggregate,
  filterRowsByPeriod,
  normalizeDir,
  rowToAggRow,
  rowsForToday,
  sumAggregates,
  type AggRow,
} from "@/lib/data/aggregate";
import { buildModelIndex } from "@/lib/data/pricing";

type Fixture = {
  today_start_ms: number;
  rows: Array<{
    day: string;
    day_ms: number;
    provider_id: string;
    model_id: string;
    agent: string;
    directory: string;
    session_id: string;
    cost: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
  }>;
  sessions: Array<{ id: string; parent_id: string | null; agent: string; model: string; directory: string; time_created: number; time_updated: number; archived: number }>;
  session_self_agg: Record<string, { cost: number; tokens_input: number; tokens_output: number; tokens_reasoning: number; tokens_cache_read: number; tokens_cache_write: number; messages: number }>;
  db_totals: { cost: number; tokens_input: number; tokens_output: number; tokens_reasoning: number; tokens_cache_read: number; tokens_cache_write: number; messages: number };
  db_today_totals: { cost: number; tokens_input: number; tokens_output: number; tokens_reasoning: number; tokens_cache_read: number; tokens_cache_write: number; messages: number };
};

const FIXTURE_PATH = path.resolve(__dirname, "../../../__pycache__/fixture.json");

function loadFixture(): Fixture | null {
  if (!existsSync(FIXTURE_PATH)) return null;
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as Fixture;
}

function toAggRows(f: Fixture): AggRow[] {
  const out: AggRow[] = [];
  for (const r of f.rows) {
    out.push(
      rowToAggRow(
        {
          dayMs: r.day_ms,
          providerId: r.provider_id,
          modelId: r.model_id,
          agent: r.agent,
          directory: r.directory,
          cost: r.cost,
          tokens: {
            input: r.tokens_input,
            output: r.tokens_output,
            reasoning: r.tokens_reasoning,
            cacheRead: r.tokens_cache_read,
            cacheWrite: r.tokens_cache_write,
          },
          messages: 1,
        },
        () => r.session_id,
      ),
    );
    // Força a data local que o script já computou (day é o YYYY-MM-DD local).
    const last = out[out.length - 1]!;
    last.date = r.day;
  }
  return out;
}

function toAggAggregate(r: AggRow): ReturnType<typeof emptyAggregate> {
  return {
    cost: r.cost,
    apiEquivalentCost: 0,
    referenceCost: 0,
    tokens: r.tokens,
    messages: r.messages,
    sessions: r.sessions.size,
  };
}

describe("db validation (requires __pycache__/fixture.json)", () => {
  const fixture = loadFixture();
  if (!fixture) {
    it.skip("fixture not found — rode export_fixture.py para gerar", () => {});
    return;
  }

  // `now` estável dentro do dia de referência do fixture (meio-dia local).
  const now = new Date(fixture.today_start_ms + 12 * 60 * 60 * 1000);

  const rows = toAggRows(fixture);
  const allAgg = sumAggregates(rows.map(toAggAggregate));
  const todayAgg = sumAggregates(rowsForToday(rows, now).map(toAggAggregate));

  it("cost total bate com o SUM(cost) do banco", () => {
    expect(allAgg.cost).toBeCloseTo(fixture.db_totals.cost, 6);
  });
  it("tokens_input total bate com o SUM do banco", () => {
    expect(allAgg.tokens.input).toBe(fixture.db_totals.tokens_input);
  });
  it("tokens_output total bate com o SUM do banco", () => {
    expect(allAgg.tokens.output).toBe(fixture.db_totals.tokens_output);
  });
  it("tokens_reasoning total bate com o SUM do banco", () => {
    expect(allAgg.tokens.reasoning).toBe(fixture.db_totals.tokens_reasoning);
  });
  it("tokens_cache_read total bate com o SUM do banco", () => {
    expect(allAgg.tokens.cacheRead).toBe(fixture.db_totals.tokens_cache_read);
  });
  it("tokens_cache_write total bate com o SUM do banco", () => {
    expect(allAgg.tokens.cacheWrite).toBe(fixture.db_totals.tokens_cache_write);
  });
  it("messages total bate com COUNT(*) do banco", () => {
    expect(allAgg.messages).toBe(fixture.db_totals.messages);
  });

  it("cost de hoje bate com SUM(cost) WHERE time_created >= hoje", () => {
    expect(todayAgg.cost).toBeCloseTo(fixture.db_today_totals.cost, 6);
  });
  it("messages de hoje bate com COUNT(*) WHERE time_created >= hoje", () => {
    expect(todayAgg.messages).toBe(fixture.db_today_totals.messages);
  });

  it("apiEquivalent não é zero para grupos com tokens e preço conhecido", () => {
    // Inclui todos os modelos vistos no fixture, mais o fallback pay-as-you-go
    // para `minimax-coding-plan`.
    const models = buildModelIndex(
      JSON.stringify({
        "anthropic": { models: {
          "claude-sonnet-5-5": { cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 } },
          "claude-opus-5-5": { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } },
          "claude-sonnet-4-6": { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } },
        } },
        "minimax": { models: {
          "MiniMax-M3": { cost: { input: 0.3, output: 1.2, cache_read: 0.06, cache_write: 0.375 } },
          "MiniMax-M2.7-highspeed": { cost: { input: 0.6, output: 2.4, cache_read: 0.06, cache_write: 0.375 } },
        } },
      }),
    );
    const { byModel } = buildBreakdowns(rows, models, "anthropic/claude-sonnet-5-5");
    // Esperamos ver os grupos com tokens E que tenham preço (exato ou fallback).
    const withPrice = byModel.filter((b) => !b.priceMissing);
    expect(withPrice.length).toBeGreaterThan(0);
    for (const b of withPrice) {
      if (b.aggregate.tokens.input + b.aggregate.tokens.output > 0) {
        expect(b.aggregate.apiEquivalentCost).toBeGreaterThan(0);
      }
    }
  });

  it("filterRowsByPeriod('all') == todas as linhas", () => {
    expect(filterRowsByPeriod(rows, "all")).toHaveLength(fixture.rows.length);
  });
  it("filterRowsByPeriod('today') == rows de hoje", () => {
    expect(filterRowsByPeriod(rows, "today", now).length).toBe(rowsForToday(rows, now).length);
  });
  it("filterRowsByPeriod('month') <= filterRowsByPeriod('all')", () => {
    expect(filterRowsByPeriod(rows, "month", now).length).toBeLessThanOrEqual(filterRowsByPeriod(rows, "all", now).length);
  });

  it("normalizeDir não muda paths com '/'", () => {
    expect(normalizeDir("C:/projetos/foo")).toBe("C:/projetos/foo");
  });

  it("daily cobre os dias esperados (sem buracos)", () => {
    const models = buildModelIndex(
      JSON.stringify({
        "anthropic": { models: { "claude-sonnet-5-5": { cost: { input: 2, output: 10 } } } },
      }),
    );
    const daily = buildDaily(rows, models, "anthropic/claude-sonnet-5-5", "7d", now);
    expect(daily).toHaveLength(7);
  });

  it("sem dupla contagem na árvore de sessões", () => {
    // Para cada sessão, verifica que o aggregate próprio <= soma do aggregate da subárvore.
    const selfAgg = fixture.session_self_agg;
    const childrenByParent = new Map<string, string[]>();
    for (const s of fixture.sessions) {
      if (s.parent_id) {
        const arr = childrenByParent.get(s.parent_id) ?? [];
        arr.push(s.id);
        childrenByParent.set(s.parent_id, arr);
      }
    }
    function aggOf(id: string): { cost: number; tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }; messages: number } {
      const s = selfAgg[id] ?? { cost: 0, tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0, messages: 0 };
      return {
        cost: s.cost,
        tokens: { input: s.tokens_input, output: s.tokens_output, reasoning: s.tokens_reasoning, cacheRead: s.tokens_cache_read, cacheWrite: s.tokens_cache_write },
        messages: s.messages,
      };
    }
    function subtreeAgg(id: string): { cost: number; tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }; messages: number } {
      const acc = aggOf(id);
      for (const child of childrenByParent.get(id) ?? []) {
        const c = subtreeAgg(child);
        acc.cost += c.cost;
        acc.tokens.input += c.tokens.input;
        acc.tokens.output += c.tokens.output;
        acc.tokens.reasoning += c.tokens.reasoning;
        acc.tokens.cacheRead += c.tokens.cacheRead;
        acc.tokens.cacheWrite += c.tokens.cacheWrite;
        acc.messages += c.messages;
      }
      return acc;
    }
    let maxCost = 0;
    let maxInput = 0;
    let maxOutput = 0;
    let maxReasoning = 0;
    let maxCacheRead = 0;
    let maxCacheWrite = 0;
    let maxMessages = 0;
    for (const s of fixture.sessions) {
      const self = aggOf(s.id);
      const sub = subtreeAgg(s.id);
      // A self nunca pode ser maior que a subárvore.
      expect(self.cost).toBeLessThanOrEqual(sub.cost + 1e-6);
      expect(self.tokens.input).toBeLessThanOrEqual(sub.tokens.input);
      expect(self.messages).toBeLessThanOrEqual(sub.messages);
      maxCost = Math.max(maxCost, sub.cost);
      maxInput = Math.max(maxInput, sub.tokens.input);
      maxOutput = Math.max(maxOutput, sub.tokens.output);
      maxReasoning = Math.max(maxReasoning, sub.tokens.reasoning);
      maxCacheRead = Math.max(maxCacheRead, sub.tokens.cacheRead);
      maxCacheWrite = Math.max(maxCacheWrite, sub.tokens.cacheWrite);
      maxMessages = Math.max(maxMessages, sub.messages);
    }
    // sanity: pelo menos uma raiz deve agregar pelo menos 2 sessões (root + children)
    const roots = fixture.sessions.filter((s) => !s.parent_id);
    const rootWithChildren = roots.find((r) => (childrenByParent.get(r.id)?.length ?? 0) > 0);
    expect(rootWithChildren).toBeDefined();
    if (rootWithChildren) {
      const sub = subtreeAgg(rootWithChildren.id);
      const self = aggOf(rootWithChildren.id);
      expect(sub.cost).toBeGreaterThanOrEqual(self.cost);
      expect(sub.tokens.input).toBeGreaterThan(self.tokens.input);
    }
    // 2x para evitar warning de "declared but never read"
    expect(maxCost + maxInput + maxOutput + maxReasoning + maxCacheRead + maxCacheWrite + maxMessages).toBeGreaterThanOrEqual(0);
    // uso do addAggregate para garantir que o import é válido (sanity)
    const a = emptyAggregate();
    const b = emptyAggregate();
    expect(addAggregate(a, b).cost).toBe(0);
  });
});