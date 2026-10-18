import { describe, expect, it } from "vitest";
import {
  searchCatalogSync,
  searchCatalog,
  _setCatalogSource,
} from "@/lib/data/catalog";
import { buildModelIndex, ModelIndex } from "@/lib/data/pricing";

const PROVIDERS_JSON = JSON.stringify({
  anthropic: {
    name: "Anthropic",
    models: {
      "claude-sonnet-5-5": { cost: { input: 3, output: 15 } },
      "claude-haiku-4-5": { cost: { input: 0.8, output: 4 } },
      "claude-opus-4-7": { cost: { input: 15, output: 75 } },
    },
  },
  openai: {
    name: "OpenAI",
    models: { "gpt-4o": { cost: { input: 2.5, output: 10 } } },
  },
  minimax: {
    name: "MiniMax",
    models: { "MiniMax-M3": { cost: { input: 0.3, output: 1.2 } } },
  },
  ollama: {
    name: "Ollama",
    models: { "llama3.2": { cost: { input: 0, output: 0 } } },
  },
});
const MODELS: ModelIndex = buildModelIndex(PROVIDERS_JSON);

describe("catalog", () => {
  describe("searchCatalogSync", () => {
    it("busca vazia devolve os populares (anthropic primeiro)", () => {
      const used = new Set<string>();
      const out = searchCatalogSync("", MODELS, used, 30);
      // anthropic aparece antes de minimax (popular) mas usado vem primeiro
      expect(out.length).toBeGreaterThan(0);
      // O primeiro provider "popular" é anthropic
      const firstProvider = out[0]!.providerId;
      expect(["anthropic"]).toContain(firstProvider);
    });

    it("modelos usados vêm ANTES de não-usados", () => {
      const used = new Set(["minimax/MiniMax-M3"]);
      const out = searchCatalogSync("", MODELS, used, 30);
      // minimax/MiniMax-M3 deve estar no topo (mesmo que não seja 'popular')
      expect(out[0]!.key).toBe("minimax/MiniMax-M3");
      expect(out[0]!.used).toBe(true);
    });

    it("busca encontra 'haiku' mesmo sem o nome do provider", () => {
      const used = new Set<string>();
      const out = searchCatalogSync("haiku", MODELS, used, 30);
      expect(out.length).toBeGreaterThan(0);
      expect(out.some((c) => c.modelId.includes("haiku"))).toBe(true);
    });

    it("busca case-insensitive", () => {
      const used = new Set<string>();
      const upper = searchCatalogSync("GPT-4O", MODELS, used, 30);
      const lower = searchCatalogSync("gpt-4o", MODELS, used, 30);
      expect(upper.length).toBe(lower.length);
      expect(upper[0]!.key).toBe(lower[0]!.key);
    });

    it("busca em 'name' do provider (campo 'Anthropic')", () => {
      const used = new Set<string>();
      const out = searchCatalogSync("Anthropic", MODELS, used, 30);
      // Espera os 3 modelos da Anthropic
      const anthropicMatches = out.filter((c) => c.providerLabel === "Anthropic");
      expect(anthropicMatches.length).toBe(3);
    });

    it("busca 'ollama' devolve os modelos desse provider", () => {
      const used = new Set<string>();
      const out = searchCatalogSync("ollama", MODELS, used, 30);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.providerId === "ollama")).toBe(true);
    });

    it("respeita o limit", () => {
      const used = new Set<string>();
      const out = searchCatalogSync("", MODELS, used, 2);
      expect(out.length).toBeLessThanOrEqual(2);
    });
  });

  describe("searchCatalog (async)", () => {
    it("sem source registrado devolve mock fallback", async () => {
      _setCatalogSource(null);
      const out = await searchCatalog("");
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBeGreaterThan(0);
    });

    it("com source registrado usa o índice do mesmo", async () => {
      const usedKeys = new Set<string>(["anthropic/claude-haiku-4-5"]);
      _setCatalogSource({
        getModels: () => MODELS,
        getUsedKeys: async () => usedKeys,
      });
      const out = await searchCatalog("", 30);
      // Primeiro item deve ser o usado
      expect(out[0]!.used).toBe(true);
      expect(out[0]!.key).toBe("anthropic/claude-haiku-4-5");
      _setCatalogSource(null); // cleanup
    });
  });
});
