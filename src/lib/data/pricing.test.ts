import { describe, expect, it } from "vitest";
import {
  FALLBACK_PROVIDERS,
  buildModelIndex,
  findPrice,
  priceTokens,
  splitModelKey,
} from "@/lib/data/pricing";
import type { TokenSet } from "@/lib/data/types";

const modelsFixture = {
  anthropic: {
    models: {
      "claude-sonnet-5-5": {
        cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
      },
      "claude-haiku-4-5": {
        cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
      },
    },
  },
  "minimax-coding-plan": {
    models: {
      "MiniMax-M3": { cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
      "MiniMax-M2.7-highspeed": { cost: { input: 0, output: 0 } },
    },
  },
  minimax: {
    models: {
      "MiniMax-M3": {
        cost: { input: 0.3, output: 1.2, cache_read: 0.06, cache_write: 0.375 },
      },
      "MiniMax-M2.7-highspeed": {
        cost: { input: 0.6, output: 2.4, cache_read: 0.06, cache_write: 0.375 },
      },
    },
  },
  unknown: { models: { foo: { cost: { input: 5, output: 10 } } } },
};

describe("pricing", () => {
  describe("buildModelIndex", () => {
    it("constrói índice providerId/modelId → ModelCost", () => {
      const idx = buildModelIndex(JSON.stringify(modelsFixture));
      // 7 entries: anthropic×2 + minimax-coding-plan×2 + minimax×2 + unknown×1
      expect(idx.size).toBe(7);
      const sonnet = idx.get("anthropic\u0000claude-sonnet-5-5");
      expect(sonnet?.cost).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });
    });
    it("ignora entries sem cost ou com cost inválido", () => {
      const idx = buildModelIndex(
        JSON.stringify({
          a: { models: { b: { cost: { input: 1, output: 2 } } } },
          c: { models: { d: { cost: { input: "x" } } } },
          e: { models: { f: {} } },
        }),
      );
      expect(idx.size).toBe(1);
    });
  });

  describe("findPrice", () => {
    const idx = buildModelIndex(JSON.stringify(modelsFixture));

    it("devolve exact quando o custo é > 0", () => {
      const r = findPrice(idx, "anthropic", "claude-sonnet-5-5");
      expect(r.via).toBe("exact");
    });

    it("cai em fallback quando o provider de assinatura tem cost 0", () => {
      const r = findPrice(idx, "minimax-coding-plan", "MiniMax-M3");
      expect(r.via).toBe("fallback");
      if (r.via === "fallback") {
        expect(r.entry.providerId).toBe("minimax");
        expect(r.entry.cost.input).toBe(0.3);
      }
    });

    it("compara IDs de forma case-insensitive no fallback", () => {
      const r = findPrice(idx, "minimax-coding-plan", "minimax-m3");
      expect(r.via).toBe("fallback");
      if (r.via === "fallback") {
        expect(r.entry.providerId).toBe("minimax");
      }
    });

    it("marca missing quando nem exato nem fallback existem", () => {
      const r = findPrice(idx, "inexistente", "foo");
      expect(r.via).toBe("missing");
    });
  });

  describe("FALLBACK_PROVIDERS", () => {
    it("inclui minimax-coding-plan com pay-as-you-go candidatos", () => {
      expect(FALLBACK_PROVIDERS["minimax-coding-plan"]).toContain("minimax");
    });
  });

  describe("priceTokens", () => {
    it("conta reasoning como output", () => {
      const tokens: TokenSet = { input: 1_000_000, output: 0, reasoning: 1_000_000, cacheRead: 0, cacheWrite: 0 };
      // cost input 2 + output 10 → input 2 + (output+reasoning) 10 = 12
      expect(priceTokens({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, tokens)).toBeCloseTo(12, 6);
    });

    it("conta cache_read e cache_write separadamente", () => {
      const tokens: TokenSet = { input: 0, output: 0, reasoning: 0, cacheRead: 1_000_000, cacheWrite: 2_000_000 };
      // 0.1 + 2*2.5 = 5.1
      expect(priceTokens({ input: 0, output: 0, cacheRead: 0.1, cacheWrite: 2.5 }, tokens)).toBeCloseTo(5.1, 6);
    });
  });

  describe("splitModelKey", () => {
    it("separa provider/modelId", () => {
      expect(splitModelKey("anthropic/claude-sonnet-5-5")).toEqual({
        providerId: "anthropic",
        modelId: "claude-sonnet-5-5",
      });
    });
    it("devolve modelId vazio quando não há '/'", () => {
      expect(splitModelKey("foo")).toEqual({ providerId: "", modelId: "foo" });
    });
  });
});