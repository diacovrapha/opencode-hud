// Testes focados em como a billing (`BillingContext`) muda o agregado e os
// breakdowns, complementando o `aggregate.test.ts` (que mantém o caminho sem
// billing para preservar os checks legacy).

import { describe, expect, it } from "vitest";
import {
  buildBreakdowns,
  buildDaily,
  totalAggregate,
  priceFor,
} from "@/lib/data/aggregate";
import {
  computeBillingContext,
  rowBillableCost,
} from "@/lib/data/providers";
import { buildModelIndex } from "@/lib/data/pricing";
import type { TokenSet, Settings } from "@/lib/data/types";
import { DEFAULT_SETTINGS } from "@/lib/data/types";
import type { AggRow } from "@/lib/data/aggregate";

const PROVIDERS_JSON = JSON.stringify({
  anthropic: {
    models: {
      "claude-sonnet-5-5": { cost: { input: 3, output: 15 } },
      "claude-haiku-4-5": { cost: { input: 0.8, output: 4 } },
    },
  },
  "minimax-coding-plan": {
    models: { "MiniMax-M3": { cost: { input: 0, output: 0 } } },
  },
  minimax: {
    models: { "MiniMax-M3": { cost: { input: 0.3, output: 1.2 } } },
  },
  ollama: {
    models: { "llama3.2": { cost: { input: 0, output: 0 } } },
  },
});
const MODELS = buildModelIndex(PROVIDERS_JSON);

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  providers: {
    "minimax-coding-plan": { billing: "subscription" },
    ollama: { billing: "free" },
  },
};

const ctx = computeBillingContext({
  rows: [],
  models: MODELS,
  settings,
  referenceModel: "anthropic/claude-sonnet-5-5",
});

function t(over: Partial<TokenSet> = {}): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, ...over };
}
function row(over: Partial<AggRow>): AggRow {
  return {
    date: "2026-10-18",
    providerId: "anthropic",
    modelId: "claude-sonnet-5-5",
    agent: "chefe",
    directory: "C:/x",
    cost: 0,
    tokens: t(),
    messages: 1,
    sessions: new Set(["s1"]),
    ...over,
  };
}

describe("aggregate + billing", () => {
  it("totalAggregate: assinatura zera cost mesmo com recorded > 0", () => {
    const r = row({
      providerId: "minimax-coding-plan",
      modelId: "MiniMax-M3",
      tokens: t({ input: 1_000_000 }),
      cost: 5,
    });
    const out = totalAggregate([r], MODELS, "anthropic/claude-sonnet-5-5", ctx);
    expect(out.cost).toBe(0);
    // Mas recordedCost preserva o original
    expect(out.recordedCost).toBe(5);
    // apiEquivalent usa recorded > 0
    expect(out.apiEquivalentCost).toBe(5);
  });

  it("buildBreakdowns: chave por modelo canônico mantém fallback", () => {
    const r = row({
      providerId: "minimax-coding-plan",
      modelId: "MiniMax-M3",
      tokens: t({ input: 1_000_000 }),
      cost: 0,
    });
    const { byModel } = buildBreakdowns([r], MODELS, "anthropic/claude-sonnet-5-5", ctx);
    expect(byModel[0]!.key).toBe("minimax/MiniMax-M3");
    expect(byModel[0]!.aggregate.cost).toBe(0);
    expect(byModel[0]!.aggregate.apiEquivalentCost).toBeCloseTo(0.3, 6);
  });

  it("api com recorded = 0 e preço conhecido → cost = tokens × preço", () => {
    const r = row({
      providerId: "anthropic",
      modelId: "claude-sonnet-5-5",
      tokens: t({ input: 1_000_000 }),
      cost: 0,
    });
    const out = totalAggregate([r], MODELS, "anthropic/claude-sonnet-5-5", ctx);
    expect(out.cost).toBeCloseTo(3, 6); // 1M × 3 USD/M
    expect(out.apiEquivalentCost).toBeCloseTo(3, 6);
  });

  it("free (ollama) zera o cost variável", () => {
    const r = row({
      providerId: "ollama",
      modelId: "llama3.2",
      tokens: t({ input: 10_000_000 }),
      cost: 0,
    });
    const out = totalAggregate([r], MODELS, "anthropic/claude-sonnet-5-5", ctx);
    expect(out.cost).toBe(0);
    expect(out.recordedCost).toBe(0);
    // api = 0 (sem preço conhecido, recorded 0)
    expect(out.apiEquivalentCost).toBe(0);
  });

  it("customPrice tem prioridade sobre models.json", () => {
    const settingsWithCustom: Settings = {
      ...DEFAULT_SETTINGS,
      customPrices: {
        "anthropic/claude-sonnet-5-5": { input: 1, output: 2 },
      },
    };
    const ctx2 = computeBillingContext({
      rows: [],
      models: MODELS,
      settings: settingsWithCustom,
      referenceModel: "anthropic/claude-sonnet-5-5",
    });
    const r = row({
      tokens: t({ input: 1_000_000 }),
      cost: 0,
    });
    const out = totalAggregate([r], MODELS, "anthropic/claude-sonnet-5-5", ctx2);
    // 1M × 1 USD = 1 USD
    expect(out.cost).toBeCloseTo(1, 6);
    expect(out.apiEquivalentCost).toBeCloseTo(1, 6);
  });

  it("priceFor com ctx aplica billing por linha", () => {
    const tokens = t({ input: 1_000_000 });
    const out = priceFor(MODELS, "anthropic/claude-sonnet-5-5", "anthropic", "claude-sonnet-5-5", tokens, 0, ctx);
    expect(out.cost).toBeCloseTo(3, 6);
    const sub = priceFor(MODELS, "anthropic/claude-sonnet-5-5", "minimax-coding-plan", "MiniMax-M3", tokens, 5, ctx);
    expect(sub.cost).toBe(0); // assinatura
    expect(sub.recorded).toBe(5);
  });

  it("buildDaily cobre dias sem buracos, com billing aplicada", () => {
    const r1 = row({ date: "2026-10-12", providerId: "anthropic", modelId: "claude-sonnet-5-5", tokens: t({ input: 1_000_000 }), cost: 0 });
    const r2 = row({ date: "2026-10-18", providerId: "anthropic", modelId: "claude-sonnet-5-5", tokens: t({ input: 2_000_000 }), cost: 0 });
    const days = buildDaily([r1, r2], MODELS, "anthropic/claude-sonnet-5-5", "7d", new Date(2026, 9, 18, 14, 0), ctx);
    expect(days).toHaveLength(7);
    expect(days[0]!.aggregate.cost).toBeCloseTo(3, 6); // 1M × 3
    expect(days[days.length - 1]!.aggregate.cost).toBeCloseTo(6, 6); // 2M × 3
  });

  it("rowBillableCost com provider SEM configuração usa inferBilling", () => {
    // O provedor 'anthropic' não está em `settings.providers`. inferBilling vai
    // para 'api' (todos os modelos têm preço não-zero).
    const r = row({ tokens: t({ input: 1_000_000 }), cost: 0 });
    const out = rowBillableCost(r, ctx);
    expect(out.cost).toBeCloseTo(3, 6);
    expect(out.api).toBeCloseTo(3, 6);
  });
});
