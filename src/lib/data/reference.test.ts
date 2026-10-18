import { describe, expect, it } from "vitest";
import {
  resolveReference,
  pickMostUsedModel,
} from "@/lib/data/reference";
import { buildModelIndex, ModelIndex } from "@/lib/data/pricing";
import type { AgentConfig } from "@/lib/data/types";
import type { AggRow } from "@/lib/data/aggregate";

const MODELS_JSON = JSON.stringify({
  anthropic: {
    models: {
      "claude-sonnet-5-5": { cost: { input: 3, output: 15 } },
      "claude-haiku-4-5": { cost: { input: 0.8, output: 4 } },
    },
  },
  openai: { models: { "gpt-4o": { cost: { input: 2.5, output: 10 } } } },
});
const MODELS: ModelIndex = buildModelIndex(MODELS_JSON);

function agentsWith(name: string, model: string, mode: "primary" | "subagent" = "primary"): AgentConfig[] {
  return [{ name, model, mode }];
}

function row(
  providerId: string,
  modelId: string,
  input: number,
  output: number,
  date = "2026-10-15",
): AggRow {
  return {
    date,
    providerId, modelId,
    agent: "chefe", directory: "C:/x",
    cost: 0,
    tokens: { input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    messages: 1, sessions: new Set(["s"]),
  };
}

describe("reference", () => {
  describe("resolveReference", () => {
    it("modo manual usa o modelo configurado", () => {
      const out = resolveReference({
        mode: "manual",
        manualModel: "anthropic/claude-haiku-4-5",
        agentsJson: "{}",
        configJson: "{}",
        agentsConfig: [],
        rows: [],
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("anthropic/claude-haiku-4-5");
      expect(out.label).toBe("claude-haiku-4-5");
      expect(out.mode).toBe("manual");
      expect(out.priceMissing).toBe(false);
    });

    it("modo auto → default_agent → model do agente (frontmatter)", () => {
      // agents.jsonc simulando um agente 'chefe' com model no agents/* merge
      const out = resolveReference({
        mode: "auto",
        manualModel: "",
        agentsJson: "{}",
        configJson: JSON.stringify({
          default_agent: "chefe",
        }),
        agentsConfig: agentsWith("chefe", "anthropic/claude-sonnet-5-5"),
        rows: [],
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("anthropic/claude-sonnet-5-5");
      expect(out.mode).toBe("auto");
      expect(out.source).toBe("agente principal: chefe");
      expect(out.priceMissing).toBe(false);
    });

    it("modo auto → cai em agent.<name>.model do jsonc", () => {
      const out = resolveReference({
        mode: "auto",
        manualModel: "",
        agentsJson: "{}",
        configJson: JSON.stringify({
          default_agent: "general",
          agent: { general: { model: "openai/gpt-4o" } },
        }),
        agentsConfig: [{ name: "general", model: "", mode: "subagent" }],
        rows: [],
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("openai/gpt-4o");
      expect(out.source).toBe("agente principal: general");
    });

    it("modo auto → fallback para o 'model' global do jsonc", () => {
      const out = resolveReference({
        mode: "auto",
        manualModel: "",
        agentsJson: "{}",
        configJson: JSON.stringify({ model: "anthropic/claude-haiku-4-5" }),
        agentsConfig: [],
        rows: [],
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("anthropic/claude-haiku-4-5");
      expect(out.source).toBe("modelo padrão do opencode");
    });

    it("modo auto → fallback para o modelo com maior apiEquivalentCost (30d)", () => {
      // Hoje é 2026-10-18. Linhas dentro dos últimos 30 dias: gpt-4o = 10M input +
      // 1M output = $25 + $10 = $35. Sonnet 5.5 = 1M input + 1M output = $3 + $15 = $18.
      const rows = [
        row("openai", "gpt-4o", 10_000_000, 1_000_000, "2026-10-12"),
        row("anthropic", "claude-sonnet-5-5", 1_000_000, 1_000_000, "2026-10-05"),
        // linha FORA da janela (anterior a 30 dias) — não deve contar
        row("anthropic", "claude-haiku-4-5", 10_000_000, 10_000_000, "2026-08-01"),
      ];
      const out = resolveReference({
        mode: "auto",
        manualModel: "",
        agentsJson: "{}",
        configJson: "{}",
        agentsConfig: [],
        rows,
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("openai/gpt-4o");
      expect(out.source).toBe("modelo mais usado");
    });

    it("modo auto sem nada → devolve reference vazia com priceMissing", () => {
      const out = resolveReference({
        mode: "auto",
        manualModel: "",
        agentsJson: "{not-json",
        configJson: "",
        agentsConfig: [],
        rows: [],
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("");
      expect(out.priceMissing).toBe(true);
    });
  });

  describe("pickMostUsedModel", () => {
    it("ignora linhas fora da janela de 30 dias", () => {
      const rows = [
        row("openai", "gpt-4o", 1_000_000, 1_000_000, "2026-10-15"),
        // Haiku com uso MASSIVO mas em ago (fora da janela)
        row("anthropic", "claude-haiku-4-5", 100_000_000, 100_000_000, "2026-08-01"),
      ];
      const out = pickMostUsedModel({
        rows,
        models: MODELS,
        now: new Date(2026, 9, 18, 14, 0),
      });
      expect(out.model).toBe("openai/gpt-4o");
    });
  });
});
