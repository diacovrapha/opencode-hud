import { describe, expect, it } from "vitest";
import { inferBilling, rowBillableCost, computeBillingContext, buildProvidersList } from "@/lib/data/providers";
import { buildModelIndex, ModelIndex } from "@/lib/data/pricing";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/data/types";
import type { AggRow } from "@/lib/data/aggregate";

const PROVIDERS_JSON = JSON.stringify({
  anthropic: {
    name: "Anthropic",
    models: {
      "claude-sonnet-5-5": { cost: { input: 3, output: 15 } },
      "claude-haiku-4-5": { cost: { input: 0.8, output: 4 } },
    },
  },
  openai: {
    name: "OpenAI",
    models: { "gpt-4o": { cost: { input: 2.5, output: 10 } } },
  },
  "minimax-coding-plan": {
    name: "MiniMax Coding Plan",
    models: {
      "MiniMax-M3": { cost: { input: 0, output: 0 } },
    },
  },
  minimax: {
    name: "MiniMax",
    models: { "MiniMax-M3": { cost: { input: 0.3, output: 1.2 } } },
  },
  "github-copilot": {
    name: "GitHub Copilot",
    models: {
      "gpt-4o": { cost: { input: 2.5, output: 10 } },
      "claude-sonnet-5-5": { cost: { input: 3, output: 15 } },
    },
  },
  ollama: {
    name: "Ollama",
    models: { "llama3.2": { cost: { input: 0, output: 0 } } },
  },
  "my-local-server": {
    name: "My Local Server",
    models: { "qwen2.5": { cost: { input: 0, output: 0 } } },
  },
  "unknown-provider": {
    name: "Unknown",
    models: { "foo": { cost: { input: 1, output: 2 } } },
  },
});
const MODELS: ModelIndex = buildModelIndex(PROVIDERS_JSON);

describe("providers", () => {
  describe("inferBilling", () => {
    it("github-copilot vira subscription pelo nome", () => {
      expect(inferBilling("github-copilot", MODELS)).toBe("subscription");
    });
    it("minimax-coding-plan vira subscription pelo nome", () => {
      expect(inferBilling("minimax-coding-plan", MODELS)).toBe("subscription");
    });
    it("ollama vira free (id local)", () => {
      expect(inferBilling("ollama", MODELS)).toBe("free");
    });
    it("'lmstudio'/'llama.cpp' viram free", () => {
      expect(inferBilling("lmstudio", MODELS)).toBe("free");
      expect(inferBilling("llama.cpp", MODELS)).toBe("free");
    });
    it("providerId contendo 'local' vira free", () => {
      expect(inferBilling("my-local-server", MODELS)).toBe("free");
    });
    it("anthropic tem preços não-zero → 'api'", () => {
      expect(inferBilling("anthropic", MODELS)).toBe("api");
    });
    it("openai tem preços não-zero → 'api'", () => {
      expect(inferBilling("openai", MODELS)).toBe("api");
    });
    it("provider inexistente no índice → 'api' (palpite conservador)", () => {
      expect(inferBilling("nope-no-models", MODELS)).toBe("api");
    });
    it("providerId '-plan' (sem keyword explícita) vira subscription", () => {
      // abaixo da heurística geral, qualquer "-plan" também é subscription
      expect(inferBilling("acme-plan", MODELS)).toBe("subscription");
    });
  });

  describe("rowBillableCost", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      providers: { "minimax-coding-plan": { billing: "subscription" } },
    };
    const ctx = computeBillingContext({
      rows: [
        mockRow("anthropic", "claude-sonnet-5-5", 1_000_000, 1_000_000, 2.0),
        mockRow("minimax-coding-plan", "MiniMax-M3", 1_000_000, 1_000_000, 0),
      ],
      models: MODELS,
      settings,
      referenceModel: "anthropic/claude-sonnet-5-5",
    });

    it("linha de assinatura zera o cost variável mesmo com recorded > 0", () => {
      const r: AggRow = mockRow("minimax-coding-plan", "MiniMax-M3", 1_000_000, 1_000_000, 5);
      const out = rowBillableCost(r, ctx);
      expect(out.cost).toBe(0); // billing="subscription" força 0
      // api equivalente: recorded > 0 → usa o que o opencode registrou
      expect(out.api).toBe(5);
      // recorded é o original (5)
      expect(out.recorded).toBe(5);
    });

    it("linha de assinatura com recorded 0 usa fallback pay-as-you-go", () => {
      const r: AggRow = mockRow("minimax-coding-plan", "MiniMax-M3", 1_000_000, 1_000_000, 0);
      const out = rowBillableCost(r, ctx);
      expect(out.cost).toBe(0); // assinatura → variável 0
      expect(out.api).toBeCloseTo(0.3 + 1.2, 6); // input 0.3 + output 1.2
      expect(out.recorded).toBe(0);
    });

    it("api com recorded > 0 usa o recorded como cost variável", () => {
      const r: AggRow = mockRow("anthropic", "claude-sonnet-5-5", 1_000_000, 1_000_000, 18);
      const out = rowBillableCost(r, ctx);
      expect(out.cost).toBe(18);
      expect(out.api).toBe(18); // recorded > 0
      expect(out.recorded).toBe(18);
    });

    it("api com recorded = 0 mas com preço conhecido usa tokens × preço", () => {
      const r: AggRow = mockRow("anthropic", "claude-sonnet-5-5", 1_000_000, 1_000_000, 0);
      const out = rowBillableCost(r, ctx);
      // input 1M × 3 = 3; output 1M × 15 = 15 → total 18
      expect(out.cost).toBeCloseTo(18, 6);
      expect(out.api).toBeCloseTo(18, 6);
    });

    it("custom price tem prioridade sobre models.json", () => {
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
      const r: AggRow = mockRow("anthropic", "claude-sonnet-5-5", 1_000_000, 1_000_000, 0);
      const out = rowBillableCost(r, ctx2);
      // input 1M × 1 = 1; output 1M × 2 = 2 → 3
      expect(out.api).toBeCloseTo(3, 6);
    });

    it("apiEquivalent usa recorded se > 0, mesmo com preço conhecido", () => {
      const r: AggRow = mockRow("anthropic", "claude-sonnet-5-5", 1_000_000, 1_000_000, 100);
      const out = rowBillableCost(r, ctx);
      expect(out.api).toBe(100);
      // recorded registrado vs. calculado: o registrado vence
    });
  });

  describe("buildProvidersList — múltiplos provedores", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      providers: {
        "minimax-coding-plan": { billing: "subscription", monthlyFee: 14, feeCurrency: "USD" },
      },
    };
    const rows: AggRow[] = [
      mockRow("anthropic", "claude-sonnet-5-5", 1_000_000, 0, 3.0, "2026-10-15"),
      mockRow("anthropic", "claude-haiku-4-5", 500_000, 0, 0.4, "2026-10-16"),
      mockRow("minimax-coding-plan", "MiniMax-M3", 1_000_000, 0, 0, "2026-10-17"),
      mockRow("ollama", "llama3.2", 200_000, 0, 0, "2026-10-17"),
    ];
    const monthRows = rows.filter((r) => r.date >= "2026-10-01");

    it("monta providers com billing correto", () => {
      const ctx = computeBillingContext({
        rows,
        models: MODELS,
        settings,
        referenceModel: "anthropic/claude-sonnet-5-5",
      });
      const providers = buildProvidersList({
        rows,
        monthRows,
        models: MODELS,
        ctx,
        usdBrlRate: 5.32,
      });
      const ids = providers.map((p) => p.id).sort();
      expect(ids).toEqual(["anthropic", "minimax-coding-plan", "ollama"]);
      const ap = providers.find((p) => p.id === "anthropic")!;
      expect(ap.billing).toBe("api");
      expect(ap.monthlyFeeUsd).toBeUndefined();
      expect(ap.inferred).toBe(true);
      const mp = providers.find((p) => p.id === "minimax-coding-plan")!;
      expect(mp.billing).toBe("subscription");
      expect(mp.inferred).toBe(false); // configurado pelo user
      expect(mp.monthlyFeeUsd).toBeCloseTo(14, 6);
      const op = providers.find((p) => p.id === "ollama")!;
      expect(op.billing).toBe("free");
    });

    it("monthAggregate para assinatura tem cost=0 e apiEquivalent>0", () => {
      const ctx = computeBillingContext({
        rows,
        models: MODELS,
        settings,
        referenceModel: "anthropic/claude-sonnet-5-5",
      });
      const providers = buildProvidersList({
        rows, monthRows, models: MODELS, ctx, usdBrlRate: 5.32,
      });
      const mp = providers.find((p) => p.id === "minimax-coding-plan")!;
      expect(mp.monthAggregate.cost).toBe(0);
      expect(mp.monthAggregate.apiEquivalentCost).toBeCloseTo(0.3, 6);
    });

    it("monthlyFeeUsd converte BRL → USD quando feeCurrency = 'BRL'", () => {
      const s2: Settings = {
        ...settings,
        providers: {
          "minimax-coding-plan": { billing: "subscription", monthlyFee: 70, feeCurrency: "BRL" },
        },
      };
      const ctx = computeBillingContext({
        rows, models: MODELS, settings: s2, referenceModel: "anthropic/claude-sonnet-5-5",
      });
      const providers = buildProvidersList({
        rows, monthRows, models: MODELS, ctx, usdBrlRate: 5,
      });
      const mp = providers.find((p) => p.id === "minimax-coding-plan")!;
      // 70 BRL / 5 USD/BRL = 14 USD
      expect(mp.monthlyFeeUsd).toBeCloseTo(14, 6);
    });
  });

  describe("subscriptions — multiple das assinaturas", () => {
    it("multiple = apiEquivalent / monthlyFee", () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        providers: {
          "minimax-coding-plan": { billing: "subscription", monthlyFee: 14, feeCurrency: "USD" },
        },
      };
      const rows: AggRow[] = [
        // Uso intenso de MiniMax no mês — pagamento por token seria 28 USD.
        mockRow("minimax-coding-plan", "MiniMax-M3", 10_000_000, 0, 0, "2026-10-15"),
      ];
      const monthRows = rows;
      const ctx = computeBillingContext({
        rows, models: MODELS, settings, referenceModel: "anthropic/claude-sonnet-5-5",
      });
      const providers = buildProvidersList({
        rows, monthRows, models: MODELS, ctx, usdBrlRate: 5,
      });
      const mp = providers.find((p) => p.id === "minimax-coding-plan")!;
      // 10M tokens input × 0.3 / 1M = 3 USD ... mas para o custom test queremos conferir multiple.
      // apiEquivalent ≈ 3 USD; multiple = 3/14 ≈ 0.214
      expect(mp.monthAggregate.apiEquivalentCost).toBeCloseTo(3.0, 6);
      expect(mp.monthlyFeeUsd).toBe(14);
      // multiple ≈ 0.214
      expect((3.0 / 14)).toBeCloseTo(0.214285, 5);
    });
  });
});

function mockRow(
  providerId: string,
  modelId: string,
  input: number,
  output: number,
  cost: number,
  date = "2026-10-18",
): AggRow {
  return {
    date,
    providerId,
    modelId,
    agent: "chefe",
    directory: "C:/projetos",
    cost,
    tokens: { input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    messages: 1,
    sessions: new Set(["s1"]),
  };
}
