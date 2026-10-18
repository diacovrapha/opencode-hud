// Precificação a partir do `models.json` do opencode.
//
// O arquivo tem centenas de providers; só guardamos um índice em memória
// `providerId -> modelId -> ModelCost` para evitar reprocessar o JSON a cada
// tick. O índice é recarregado a cada `MODELS_RELOAD_MS` (6h).
//
// Para modelos em providers de assinatura (cost = 0), procuramos o mesmo
// `modelId` em outros providers pay-as-you-go, comparando IDs case-insensitive.
// Se não acharmos, marcamos o grupo como `priceMissing`.
//
// O índice também guarda metadados do PROVEDOR (campo `name` do `models.json`)
// em `index.providers` (id → ProviderMeta), expostos para o Snapshot.provider
// label e para a busca do catálogo.

import type { TokenSet } from "./types";

export type ModelCost = {
  /** USD por 1M tokens de input (texto). */
  input: number;
  /** USD por 1M tokens de output (texto). */
  output: number;
  /** USD por 1M tokens de leitura de cache. */
  cacheRead: number;
  /** USD por 1M tokens de escrita de cache. */
  cacheWrite: number;
};

export type ModelEntry = {
  providerId: string;
  modelId: string;
  cost: ModelCost;
};

export type ProviderMeta = {
  id: string;
  /** Campo "name" do `models.json`. `null` quando ausente. */
  name: string | null;
};

/**
 * Índice em memória de preços. API compatível com `Map<string, ModelEntry>`
 * (mesmo `size`/`get`/`has`/iteração) — subclasses foram trocadas por uma
 * classe enxuta para que `index.providers` (metadados do provedor) viaje junto.
 */
export class ModelIndex {
  readonly #entries: Map<string, ModelEntry>;
  /** id → ProviderMeta (inclui provedores sem modelos, úteis para o label). */
  readonly providers: Map<string, ProviderMeta>;

  constructor(
    entries: Map<string, ModelEntry>,
    providers: Map<string, ProviderMeta>,
  ) {
    this.#entries = entries;
    this.providers = providers;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): ModelEntry | undefined {
    return this.#entries.get(key);
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  values(): IterableIterator<ModelEntry> {
    return this.#entries.values();
  }

  keys(): IterableIterator<string> {
    return this.#entries.keys();
  }

  entries(): IterableIterator<[string, ModelEntry]> {
    return this.#entries.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, ModelEntry]> {
    return this.#entries.entries();
  }
}

/**
 * Mapa de providers de assinatura → lista de providers pay-as-you-go
 * candidatos. Ajuste baseado nos providers reais que existem no
 * `models.json` deste host.
 */
export const FALLBACK_PROVIDERS: Record<string, string[]> = {
  "minimax-coding-plan": ["minimax", "minimax-cn", "minimax-cn-coding-plan"],
  "alibaba-coding-plan": ["alibaba", "alibaba-cn"],
  "alibaba-token-plan": ["alibaba", "alibaba-cn"],
  "kimi-code-plan-global": ["moonshotai", "kimi-code-plan-cn"],
  "tencent-coding-plan": ["tencent-token-plan", "tencent-tokenhub"],
  "tencent-token-plan": ["tencent-tokenhub"],
  "zai-coding-plan": ["zai"],
  "xiaomi-token-plan-ams": ["xiaomi", "openai"],
  "xiaomi-token-plan-cn": ["xiaomi"],
  "xiaomi-token-plan-sgp": ["xiaomi"],
  "zhipuai-coding-plan": ["zhipuai"],
  "scnet-token-plan": ["alibaba"],
  "stepfun-step-plan": ["stepfun", "stepfun-ai"],
  "stepfun-ai-step-plan": ["stepfun-ai", "stepfun"],
  "volcengine-coding-plan": ["volcengine"],
  "umans-ai-coding-plan": ["umans-ai"],
};

/** Faz o parse do `models.json` e devolve um índice enxuto. */
export function buildModelIndex(rawJson: string): ModelIndex {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const entries = new Map<string, ModelEntry>();
  const providers = new Map<string, ProviderMeta>();
  for (const [providerId, providerVal] of Object.entries(parsed)) {
    if (!providerVal || typeof providerVal !== "object") continue;
    const provObj = providerVal as { models?: Record<string, unknown>; name?: unknown };
    // Coleta o `name` (legível) do provedor mesmo se ele não tiver modelos.
    const name = typeof provObj.name === "string" ? provObj.name : null;
    providers.set(providerId, { id: providerId, name });
    const models = provObj.models;
    if (!models || typeof models !== "object") continue;
    for (const [modelId, modelVal] of Object.entries(models)) {
      if (!modelVal || typeof modelVal !== "object") continue;
      const cost = (modelVal as { cost?: Record<string, unknown> }).cost;
      if (!cost || typeof cost !== "object") continue;
      const inNum = numOr(cost.input);
      const outNum = numOr(cost.output);
      const crNum = numOr(cost.cache_read);
      const cwNum = numOr(cost.cache_write);
      if (inNum === null || outNum === null) continue;
      entries.set(indexKey(providerId, modelId), {
        providerId,
        modelId,
        cost: {
          input: inNum,
          output: outNum,
          cacheRead: crNum ?? 0,
          cacheWrite: cwNum ?? 0,
        },
      });
    }
  }
  return new ModelIndex(entries, providers);
}

function numOr(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function indexKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

/** Procura o preço do par (providerId, modelId). */
export type PriceLookup =
  | { via: "exact"; entry: ModelEntry }
  | { via: "fallback"; entry: ModelEntry; fallbackProvider: string }
  | { via: "missing" };

export function findPrice(
  idx: ModelIndex,
  providerId: string,
  modelId: string,
): PriceLookup {
  const exactKey = indexKey(providerId, modelId);
  const exact = idx.get(exactKey);
  if (exact && (exact.cost.input > 0 || exact.cost.output > 0)) {
    return { via: "exact", entry: exact };
  }
  // Tenta exato "mesmo se for zero" só para extrair providerId/modelId canônicos
  // usados no fallback (alguns providers do arquivos publicam cost=0 mas mantêm
  // modelos idênticos ao pay-as-you-go).
  const fallbacks = FALLBACK_PROVIDERS[providerId] ?? [];
  const targetLower = modelId.toLowerCase();
  for (const fb of fallbacks) {
    // Match exato, depois case-insensitive.
    for (const [key, entry] of idx) {
      const [entryPid, entryMid] = key.split("\u0000");
      if (entryPid !== fb) continue;
      if (entryMid === modelId && (entry.cost.input > 0 || entry.cost.output > 0)) {
        return { via: "fallback", entry, fallbackProvider: fb };
      }
    }
    for (const [key, entry] of idx) {
      const [entryPid, entryMid] = key.split("\u0000");
      if (entryPid !== fb) continue;
      if (entryMid.toLowerCase() === targetLower && (entry.cost.input > 0 || entry.cost.output > 0)) {
        return { via: "fallback", entry, fallbackProvider: fb };
      }
    }
  }
  // Se havia um exato (mesmo com cost 0), retornamos ele para que o caller
  // possa distinguir "assinatura, sem fallback" de "verdadeiramente sem preço".
  if (exact) return { via: "missing" };
  return { via: "missing" };
}

/**
 * Calcula o custo em USD para um conjunto de tokens usando o `ModelCost`.
 * `reasoning` é cobrado como output (mesmo preço).
 */
export function priceTokens(cost: ModelCost, tokens: TokenSet): number {
  const inCost = (tokens.input / 1_000_000) * cost.input;
  const outCost = ((tokens.output + tokens.reasoning) / 1_000_000) * cost.output;
  const crCost = (tokens.cacheRead / 1_000_000) * cost.cacheRead;
  const cwCost = (tokens.cacheWrite / 1_000_000) * cost.cacheWrite;
  return inCost + outCost + crCost + cwCost;
}

/** Extrai o par `providerId`/`modelId` de uma chave completa (`"anthropic/claude-sonnet-5-5"`). */
export function splitModelKey(qualified: string): { providerId: string; modelId: string } {
  const idx = qualified.indexOf("/");
  if (idx < 0) return { providerId: "", modelId: qualified };
  return { providerId: qualified.slice(0, idx), modelId: qualified.slice(idx + 1) };
}

/** Cache TTL para o `models.json` em memória. */
export const MODELS_RELOAD_MS = 6 * 60 * 60 * 1000; // 6h
