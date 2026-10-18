// Resolução do "modelo de referência" efetivo.
//
// `Settings.referenceMode` = "manual" → usa `Settings.referenceModel` direto.
// `Settings.referenceMode` = "auto"   → procura na config do opencode:
//
//   1. `default_agent` do `opencode.jsonc` → model do agente (frontmatter
//      `agents/<nome>.md` ou `agent.<nome>.model` no próprio jsonc).
//   2. "model" global do `opencode.jsonc`.
//   3. Modelo com MAIOR `apiEquivalentCost` (preço manual > json > fallback)
//      nos últimos 30 dias. Calculado a partir das `rows` (período ≥ 30d).
//
// A função é PURA (não toca o SQLite nem o filesystem): recebe as linhas e o
// JSON já parseado e devolve `ResolvedReference`.
//
// `agent.<nome>.model` é lido do `opencode.jsonc` (campo `agent`) caso o
// frontmatter não defina — `agents.ts.extractAgentsConfig` MESCLA as duas
// fontes, então normalmente basta olhar o `agentsConfig`. Aqui nós ainda
// consultamos `cfg.agent` por segurança para cobrir configs onde o agente
// não existe no mapa `agents/*.md`.

import type { AgentConfig, ResolvedReference } from "./types";
import type { AggRow } from "./aggregate";
import type { ModelIndex } from "./pricing";
import { findPrice, priceTokens, splitModelKey } from "./pricing";
import { parseJsonc } from "./agents";

export type ResolveReferenceArgs = {
  mode: "auto" | "manual";
  manualModel: string;
  /** Conteúdo cru de `agents/*.md` (objeto JSON serializado em `real.ts`). */
  agentsJson: string;
  /** Conteúdo cru de `opencode.jsonc`. */
  configJson: string;
  /** Lista de agentes já fundida com overrides do jsonc (output de `extractAgentsConfig`). */
  agentsConfig: AgentConfig[];
  /** Linhas completas do snapshot, para o fallback de "modelo mais usado". */
  rows: AggRow[];
  models: ModelIndex;
  /** `now` para a janela de 30 dias do fallback. */
  now?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve o `Reference` efetivo. Sempre devolve algo (mesmo que vazio) para a
 * UI não precisar de `!snapshot.reference`.
 */
export function resolveReference(args: ResolveReferenceArgs): ResolvedReference {
  if (args.mode === "manual") {
    return buildResolved(args.manualModel, args.models, "manual", undefined);
  }

  const cfg = parseJsonc(args.configJson);
  const defaultAgent = cfg && typeof cfg["default_agent"] === "string"
    ? (cfg["default_agent"] as string)
    : null;

  let model = "";
  let source: string | undefined;

  // 1) default_agent → model do agente (frontmatter OU agent.<name>.model)
  if (defaultAgent) {
    const ac = args.agentsConfig.find((a) => a.name === defaultAgent);
    if (ac && ac.model) {
      model = ac.model;
      source = `agente principal: ${defaultAgent}`;
    } else {
      // Defesa: agent.<name>.model do jsonc (caso o agente não esteja em agentsConfig)
      const agentDef = cfg?.["agent"];
      if (agentDef && typeof agentDef === "object" && !Array.isArray(agentDef)) {
        const def = (agentDef as Record<string, unknown>)[defaultAgent];
        if (def && typeof def === "object") {
          const m = (def as { model?: unknown }).model;
          if (typeof m === "string" && m.length > 0) {
            model = m;
            source = `agente principal: ${defaultAgent}`;
          }
        }
      }
    }
  }

  // 2) "model" global do jsonc
  if (!model && cfg && typeof cfg["model"] === "string") {
    const m = cfg["model"] as string;
    if (m.length > 0) {
      model = m;
      source = "modelo padrão do opencode";
    }
  }

  // 3) Modelo com maior apiEquivalentCost nos últimos 30 dias.
  if (!model) {
    const picked = pickMostUsedModel({
      rows: args.rows,
      models: args.models,
      now: args.now ?? new Date(),
    });
    if (picked.model) {
      model = picked.model;
      source = "modelo mais usado";
    }
  }

  return buildResolved(model, args.models, "auto", source);
}

function buildResolved(
  qualified: string,
  models: ModelIndex,
  mode: "auto" | "manual",
  source: string | undefined,
): ResolvedReference {
  if (!qualified) {
    return { model: "", label: "", mode, source, priceMissing: true };
  }
  const { providerId, modelId } = splitModelKey(qualified);
  const lookup = findPrice(models, providerId, modelId);
  return {
    model: qualified,
    label: modelId || qualified,
    mode,
    source,
    priceMissing: lookup.via === "missing",
  };
}

/**
 * Escolhe o par (provider/model) com MAIOR custo API-equivalente nos últimos
 * 30 dias. Devolve `model` no formato `"provider/model"` ou `""` se vazio.
 */
export function pickMostUsedModel(args: {
  rows: AggRow[];
  models: ModelIndex;
  now?: Date;
}): { model: string; api: number } {
  const now = args.now ?? new Date();
  const cutoffMs = now.getTime() - 30 * MS_PER_DAY;
  // provider/model → api acumulado
  const accum = new Map<string, number>();
  for (const r of args.rows) {
    const dayMs = localDayToMs(r.date);
    if (dayMs === null || dayMs < cutoffMs) continue;
    if (!r.providerId || !r.modelId) continue;
    const lookup = findPrice(args.models, r.providerId, r.modelId);
    if (lookup.via === "missing") continue;
    const api = priceTokens(lookup.entry.cost, r.tokens);
    const key = `${r.providerId}/${r.modelId}`;
    accum.set(key, (accum.get(key) ?? 0) + api);
  }
  let best = "";
  let bestApi = -Infinity;
  for (const [k, v] of accum) {
    if (v > bestApi) {
      best = k;
      bestApi = v;
    }
  }
  return { model: best, api: best === "" ? 0 : (bestApi as number) };
}

function localDayToMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}
