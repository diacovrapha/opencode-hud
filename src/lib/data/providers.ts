// Lógica de cobrança (billing) e construção da lista de provedores detectados.
//
// Camada pura: recebe `AggRow[]`, o `ModelIndex` e as `Settings`, e devolve:
//   - `inferBilling(providerId, models)`: palpite inicial do tipo de cobrança
//     ("api" | "subscription" | "free") para um provedor.
//   - `BillingContext`: snapshot pré-computado da decisão por provedor + tabelas
//     de preços manuais e do `models.json`. Usado por `aggregate.ts` para
//     aplicar a cobrança em cada linha sem reler tudo.
//   - `rowBillableCost(...)`: aplica a cobrança a uma linha individual
//     (`recordedCost` / tokens) e devolve `cost`, `apiEquivalentCost`,
//     `referenceCost`, `recordedCost`, `priceMissing`.
//
// O efeito já estava descrito em `types.ts` (Aggregate.cost é o "gasto
// variável"; Aggregate.recordedCost é o que o opencode registrou). Esta
// camada é a única autorizada a aplicar a tabela de cobrança.

import type {
  Aggregate,
  BillingType,
  CustomPrice,
  ProviderSetting,
  ProviderInfo,
  Settings,
  TokenSet,
} from "./types";
import type { AggRow } from "./aggregate";
import type { ModelCost, ModelIndex, ProviderMeta } from "./pricing";
import {
  findPrice,
  priceTokens,
  splitModelKey,
} from "./pricing";

// ---------- tipos públicos ----------

export type ResolvedPrice = {
  cost: ModelCost;
  via: "custom" | "exact" | "fallback" | "missing";
  /** Quando `via === "fallback"`, qual provider pay-as-you-go foi usado. */
  fallbackProvider?: string;
};

/**
 * Snapshot pré-computado da decisão de billing por provedor + tabelas de
 * preço usadas pelas funções de `aggregate.ts` e para construir `ProviderInfo`.
 *
 * Importante: este tipo NÃO é substituído por tick — é calculado UMA vez
 * por snapshot (no `real.ts`), pois o polling roda a cada 5s.
 */
export type BillingContext = {
  /** providerId → BillingType efetivo (configurado pelo usuário OU palpite). */
  billingByProvider: ReadonlyMap<string, BillingType>;
  /** providerId → ProviderSetting cru (sem mesclagem), útil pra saber `inferred`. */
  providerSettings: ReadonlyMap<string, ProviderSetting | undefined>;
  /** "provider/model" → CustomPrice (preço manual do usuário). */
  customPrices: ReadonlyMap<string, CustomPrice>;
  /** ResolvedPrice do modelo de referência (cache). */
  referenceResolved: ResolvedPrice;
  /** ResolvedPrice para um par (provider, model). Custom > models.json > fallback. */
  resolvePrice(providerId: string, modelId: string): ResolvedPrice;
  models: ModelIndex;
  referenceModel: string;
};

// ---------- palpite ----------

const LOCAL_HINTS = ["ollama", "lmstudio", "llama.cpp", "local"] as const;
const PLAN_HINTS = ["coding-plan", "token-plan", "copilot"] as const;

/**
 * Palpite inicial do tipo de cobrança. NÃO leva em conta `Settings.providers`
 * (chamada pura); o caller faz `configured ?? inferBilling(...)`.
 *
 * - "free": id de execução local (ollama, lmstudio, llama.cpp, ...local)
 *   OU todos os modelos do provedor no `models.json` têm preço 0 E não há
 *   fallback pay-as-you-go conhecido.
 * - "subscription": id contém "coding-plan"/"token-plan"/"copilot" ou
 *   termina em "-plan", OU todos os modelos têm preço 0 MAS há fallback
 *   pay-as-you-go (caso do `minimax-coding-plan` etc.).
 * - "api": o resto (incluindo provedores desconhecidos / sem `models.json`).
 */
export function inferBilling(providerId: string, models: ModelIndex): BillingType {
  const lower = providerId.toLowerCase();
  for (const hint of LOCAL_HINTS) {
    if (lower.includes(hint)) return "free";
  }
  for (const hint of PLAN_HINTS) {
    if (lower.includes(hint)) return "subscription";
  }
  // "-plan" (curinga para `xxx-plan`): capturado pelo loop acima + heurística extra
  // para `-plan` solto (sem `coding`/`token`).
  if (lower.includes("-plan")) return "subscription";

  // Inspeção do models.json: categoria o provedor pelo preço.
  let seenAny = false;
  let allZero = true;
  for (const [, entry] of models) {
    if (entry.providerId !== providerId) continue;
    seenAny = true;
    if (entry.cost.input > 0 || entry.cost.output > 0) {
      allZero = false;
      break;
    }
  }
  // Sem entries (provedor desconhecido do models.json): palpite conservador → "api".
  if (!seenAny || !allZero) return "api";
  // Todos os modelos têm preço 0. Há fallback pay-as-you-go?
  for (const [, entry] of models) {
    if (entry.providerId !== providerId) continue;
    const fb = findPrice(models, providerId, entry.modelId);
    if (fb.via === "fallback") return "subscription";
  }
  return "free";
}

// ---------- builders ----------

export type ComputeBillingContextArgs = {
  rows: Iterable<AggRow>;
  models: ModelIndex;
  settings: Settings;
  referenceModel: string;
  /** Preço manual do modelo de referência (chave "provider/model"). Opcional. */
  referenceCustomPrice?: CustomPrice | null;
};

/**
 * Constrói o `BillingContext` para o snapshot atual. Pré-computa o
 * `billingByProvider` (uma chamada de `inferBilling` por provedor visto) e
 * `resolvePrice` (lazy por linha).
 */
export function computeBillingContext(args: ComputeBillingContextArgs): BillingContext {
  const seen = new Set<string>();
  for (const r of args.rows) {
    if (r.providerId) seen.add(r.providerId);
  }
  // Inclui também os provedores que o usuário CONFIGUROU (mesmo que não tenham
  // linhas no período atual). Isso evita que `inferBilling` recalcule com
  // default "api" quando o usuário já declarou "subscription" no settings.
  if (args.settings.providers) {
    for (const pid of Object.keys(args.settings.providers)) {
      seen.add(pid);
    }
  }

  const billingByProvider = new Map<string, BillingType>();
  const providerSettings = new Map<string, ProviderSetting | undefined>();
  for (const pid of seen) {
    const setting = args.settings.providers?.[pid];
    providerSettings.set(pid, setting);
    billingByProvider.set(
      pid,
      setting?.billing ?? inferBilling(pid, args.models),
    );
  }

  const customPrices = new Map<string, CustomPrice>();
  for (const [k, v] of Object.entries(args.settings.customPrices ?? {})) {
    if (v) customPrices.set(k, v);
  }

  const resolvePrice = (providerId: string, modelId: string): ResolvedPrice => {
    const key = `${providerId}/${modelId}`;
    const custom = customPrices.get(key);
    if (custom) {
      return {
        cost: {
          input: Number(custom.input) || 0,
          output: Number(custom.output) || 0,
          cacheRead: custom.cacheRead ?? 0,
          cacheWrite: custom.cacheWrite ?? 0,
        },
        via: "custom",
      };
    }
    const lookup = findPrice(args.models, providerId, modelId);
    if (lookup.via === "missing") {
      return { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, via: "missing" };
    }
    return {
      cost: lookup.entry.cost,
      via: lookup.via,
      fallbackProvider: lookup.via === "fallback" ? lookup.fallbackProvider : undefined,
    };
  };

  // Modelo de referência resolvido uma vez (reusado por linha).
  let referenceResolved: ResolvedPrice;
  if (args.referenceCustomPrice) {
    const c = args.referenceCustomPrice;
    referenceResolved = {
      cost: {
        input: Number(c.input) || 0,
        output: Number(c.output) || 0,
        cacheRead: c.cacheRead ?? 0,
        cacheWrite: c.cacheWrite ?? 0,
      },
      via: "custom",
    };
  } else {
    const parts = splitModelKey(args.referenceModel ?? "");
    referenceResolved = resolvePrice(parts.providerId, parts.modelId);
  }

  return {
    billingByProvider,
    providerSettings,
    customPrices,
    referenceResolved,
    resolvePrice,
    models: args.models,
    referenceModel: args.referenceModel,
  };
}

// ---------- custo por linha ----------

export type RowBillableCost = {
  /** Custo VARIÁVEL (o que entra em Aggregate.cost). Zero para subscription/free. */
  cost: number;
  /** Equivalente na API (o que entraria em Aggregate.apiEquivalentCost). */
  api: number;
  /** Custo no modelo de referência. */
  ref: number;
  /** O que o opencode registrou (original). */
  recorded: number;
  /** true = sem preço conhecido para esse modelo neste provedor. */
  priceMissing: boolean;
};

/**
 * Aplica a tabela de cobrança para uma linha `AggRow`.
 *
 * Regras (do prompt):
 * - `recorded = r.cost` (o que o opencode escreveu).
 * - `cost` (variável) = recorded se billing = "api"; 0 se "subscription"/"free".
 *   Exceção: billing "api" + recorded = 0 + preço conhecido → `tokens × price`.
 * - `api` = recorded se > 0; senão `tokens × price` (custom > json > fallback).
 * - `ref`  = `tokens × price_of_resolved_reference` (cache em `ctx.referenceResolved`).
 */
export function rowBillableCost(
  r: Pick<AggRow, "providerId" | "modelId" | "tokens" | "cost">,
  ctx: BillingContext,
): RowBillableCost {
  const recorded = Number(r.cost) || 0;
  const billing = ctx.billingByProvider.get(r.providerId) ?? "api";
  const priceRes = ctx.resolvePrice(r.providerId, r.modelId);
  const hasPrice = priceRes.via !== "missing";
  const tokenPrice = hasPrice ? priceTokens(priceRes.cost, r.tokens) : 0;

  let cost: number;
  if (billing === "api") {
    cost = recorded > 0
      ? recorded
      : (hasPrice ? tokenPrice : 0);
  } else {
    cost = 0;
  }

  const api = recorded > 0
    ? recorded
    : (hasPrice ? tokenPrice : 0);

  const ref = ctx.referenceResolved.via === "missing"
    ? 0
    : priceTokens(ctx.referenceResolved.cost, r.tokens);

  return {
    cost,
    api,
    ref,
    recorded,
    priceMissing: priceRes.via === "missing",
  };
}

// ---------- agregação pura por linha (helper) ----------

/**
 * Soma uma lista de linhas em um único Aggregate já com a billing aplicada.
 * Usado para construir `monthAggregate` e `allTimeAggregate` por provedor.
 *
 * Sessões distintas são contadas por `sessions.size` SOMADO, mas como o `Set`
 * compartilhado entre linhas não é viável aqui, expomos o número real através
 * da união — ordem O(N) — apenas quando o caller pede via `countSessions=true`.
 */
export function aggregateRows(
  rows: AggRow[],
  ctx: BillingContext,
): Aggregate {
  let cost = 0;
  let api = 0;
  let ref = 0;
  let recorded = 0;
  let messages = 0;
  let tokens: TokenSet = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let priceMissing = false;
  const sessionIds = new Set<string>();
  for (const r of rows) {
    const c = rowBillableCost(r, ctx);
    cost += c.cost;
    api += c.api;
    ref += c.ref;
    recorded += c.recorded;
    messages += r.messages;
    tokens = {
      input: tokens.input + r.tokens.input,
      output: tokens.output + r.tokens.output,
      reasoning: tokens.reasoning + r.tokens.reasoning,
      cacheRead: tokens.cacheRead + r.tokens.cacheRead,
      cacheWrite: tokens.cacheWrite + r.tokens.cacheWrite,
    };
    for (const sid of r.sessions) sessionIds.add(sid);
    if (c.priceMissing) priceMissing = true;
  }
  return {
    cost,
    apiEquivalentCost: api,
    referenceCost: ref,
    recordedCost: recorded,
    tokens,
    messages,
    sessions: sessionIds.size,
    priceMissing,
  } as Aggregate;
}

// ---------- ProviderInfo ----------

export type BuildProvidersArgs = {
  /** Todas as linhas (período atual, geralmente). Para `allTimeAggregate`. */
  rows: AggRow[];
  /** Linhas do mês corrente (para `monthAggregate`). */
  monthRows: AggRow[];
  models: ModelIndex;
  ctx: BillingContext;
  /** Cotação USD/BRL (para converter `monthlyFee`). null → mensalidade fica USD crua. */
  usdBrlRate: number | null;
};

/**
 * Constrói a lista `Snapshot.providers` a partir das linhas agregadas. Ordena
 * por último uso descendente e inclui:
 *  - label (campo "name" do `models.json` ou o próprio id);
 *  - billing efetivo (configurado OU palpite);
 *  - inferred (true = ainda não configurado pelo usuário);
 *  - monthlyFeeUsd (mensalidade convertida);
 *  - models usados;
 *  - monthAggregate (mês corrente, billing aplicada);
 *  - allTimeAggregate (todo o histórico passado, billing aplicada);
 *  - lastUsed (epoch ms do último dia com uso).
 */
export function buildProvidersList(args: BuildProvidersArgs): ProviderInfo[] {
  const allByProvider = groupByProvider(args.rows);
  const monthByProvider = groupByProvider(args.monthRows);

  const out: ProviderInfo[] = [];
  for (const [pid, allRows] of allByProvider) {
    const monthRows = monthByProvider.get(pid) ?? [];
    const allAgg = aggregateRows(allRows, args.ctx);
    const monthAgg = aggregateRows(monthRows, args.ctx);

    const modelsUsed = new Set<string>();
    let lastUsed = 0;
    for (const r of allRows) {
      if (r.modelId) modelsUsed.add(r.modelId);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date);
      if (m) {
        const ms = new Date(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          23,
          59,
          59,
          999,
        ).getTime();
        if (ms > lastUsed) lastUsed = ms;
      }
    }
    // Fallback: se nunca apareceu um modelo, lastUsed = 0 — a UI pode decidir
    // esconder essa coluna nesse caso.

    const billing = args.ctx.billingByProvider.get(pid) ?? "api";
    const setting = args.ctx.providerSettings.get(pid);
    const inferred = !setting;

    // Mensalidade: só para assinaturas.
    let monthlyFeeUsd: number | undefined;
    if (
      billing === "subscription" &&
      setting?.monthlyFee !== undefined &&
      setting.monthlyFee > 0
    ) {
      if (setting.feeCurrency === "BRL" && args.usdBrlRate && args.usdBrlRate > 0) {
        monthlyFeeUsd = setting.monthlyFee / args.usdBrlRate;
      } else {
        monthlyFeeUsd = setting.monthlyFee;
      }
    }

    const providerMeta: ProviderMeta | undefined = args.models.providers.get(pid);
    const label = providerMeta?.name ?? pid;

    out.push({
      id: pid,
      label,
      billing,
      inferred,
      monthlyFeeUsd,
      models: [...modelsUsed].sort(),
      monthAggregate: monthAgg,
      allTimeAggregate: allAgg,
      lastUsed,
    });
  }

  out.sort((a, b) => b.lastUsed - a.lastUsed);
  return out;
}

function groupByProvider(rows: AggRow[]): Map<string, AggRow[]> {
  const out = new Map<string, AggRow[]>();
  for (const r of rows) {
    if (!r.providerId) continue;
    const arr = out.get(r.providerId);
    if (arr) arr.push(r);
    else out.set(r.providerId, [r]);
  }
  return out;
}
