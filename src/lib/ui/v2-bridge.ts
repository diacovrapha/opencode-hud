/**
 * Bridge v2: adapta a camada `src/lib/data` ao que esta tarefa precisa, mesmo
 * enquanto a outra tarefa ainda está implementando provedores/assinaturas/
 * referência/catálogo.
 *
 * Estratégia:
 *   - Tudo que esta tarefa consome da camada de dados é lido daqui, NÃO
 *     direto de `@/lib/data`. Isso permite compilar e rodar com a UI mesmo
 *     se os novos campos ainda não chegaram.
 *   - A função `searchCatalog` (reexportada pela outra tarefa em
 *     `@/lib/data`) é acessada via cast tolerante. Quando ela ainda não
 *     existe, devolvemos array vazio.
 *   - Para os campos opcionais do `Snapshot` (`providers`, `subscriptions`,
 *     `reference`), tratamos a ausência com fallbacks seguros — listas vazias
 *     ou null — em vez de quebrar.
 *
 * Esta bridge é APENAS para a UI — a outra tarefa pode mexer em
 * `src/lib/data/**` sem nos coordenar, contanto que mantenha o contrato
 * publicado em `src/lib/data/types.ts`.
 */

import type {
  BillingType,
  CatalogModel,
  ProviderInfo,
  ResolvedReference,
  Settings,
  Snapshot,
  SubscriptionsSummary,
} from "@/lib/data/types";

// Importamos o módulo inteiro como namespace. Em runtime, Vite/TS resolve
// normalmente; em compilação, usamos casts para tolerar funções que ainda
// não foram adicionadas pela outra tarefa.
import * as DataMod from "@/lib/data";

// ---------- catálogo ----------

/**
 * `searchCatalog` exposto pela outra tarefa. Faz debounce no caller.
 * Quando a função ainda não foi publicada, devolve array vazio.
 */
export async function searchCatalog(
  query: string,
  limit = 30,
): Promise<CatalogModel[]> {
  const fn = (DataMod as { searchCatalog?: unknown }).searchCatalog;
  if (typeof fn !== "function") return [];
  try {
    const out = await (fn as (q: string, l?: number) => Promise<CatalogModel[]>)(
      query,
      limit,
    );
    return Array.isArray(out) ? out : [];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[v2-bridge] searchCatalog falhou:", e);
    return [];
  }
}

// ---------- helpers de leitura tolerante ----------

export function getProviders(snapshot: Snapshot | null | undefined): ProviderInfo[] {
  return snapshot?.providers ?? [];
}

export function getSubscriptions(
  snapshot: Snapshot | null | undefined,
): SubscriptionsSummary | null {
  return snapshot?.subscriptions ?? null;
}

export function getReference(
  snapshot: Snapshot | null | undefined,
): ResolvedReference | null {
  return snapshot?.reference ?? null;
}

/** Soma das mensalidades conhecidas (em USD). */
export function totalMonthlyUsd(sub: SubscriptionsSummary | null): number {
  return sub?.monthlyTotalUsd ?? 0;
}

/** Soma do que o uso das assinaturas custaria se fosse por token (mês). */
export function subscriptionsApiEquivalentUsd(
  sub: SubscriptionsSummary | null,
): number {
  return sub?.apiEquivalentMonthUsd ?? 0;
}

/**
 * Mapa providerId → billing efetivo, para que o BreakdownTable saiba se um
 * modelo deve receber a badge "assinatura" / "gratuito/local".
 */
export function providerBillingById(
  providers: ProviderInfo[],
): Record<string, BillingType> {
  const out: Record<string, BillingType> = {};
  for (const p of providers) out[p.id] = p.billing;
  return out;
}

// ---------- helpers de escrita tolerante ----------

/**
 * Faz merge de um provedor em `Settings.providers`, preservando os demais.
 * Encapsula a regra "update com providers/customPrices faz merge" combinada:
 * shallow dos providers, deep dos customPrices.
 */
export async function patchProviders(
  update: (p: Partial<Settings>) => Promise<void>,
  current: Settings,
  providerId: string,
  patch: {
    billing?: BillingType;
    monthlyFee?: number | null;
    feeCurrency?: "BRL" | "USD";
  },
): Promise<void> {
  const prev = current.providers[providerId] ?? { billing: "api" as const };
  const nextEntry: Settings["providers"][string] = { ...prev };
  if (patch.billing !== undefined) nextEntry.billing = patch.billing;
  if (patch.monthlyFee !== undefined) {
    if (patch.monthlyFee === null) {
      delete nextEntry.monthlyFee;
    } else {
      nextEntry.monthlyFee = patch.monthlyFee;
    }
  }
  if (patch.feeCurrency !== undefined) nextEntry.feeCurrency = patch.feeCurrency;
  // Limpa campos irrelevantes quando o tipo mudou.
  if (nextEntry.billing !== "subscription") {
    delete nextEntry.monthlyFee;
    delete nextEntry.feeCurrency;
  } else {
    nextEntry.feeCurrency = nextEntry.feeCurrency ?? "BRL";
  }
  await update({
    providers: { ...current.providers, [providerId]: nextEntry },
  });
}

/**
 * Patch de um único customPrice. `null` remove a chave.
 */
export async function patchCustomPrice(
  update: (p: Partial<Settings>) => Promise<void>,
  current: Settings,
  key: string,
  value: Settings["customPrices"][string] | null,
): Promise<void> {
  const next = { ...current.customPrices };
  if (value === null) {
    delete next[key];
  } else {
    next[key] = value;
  }
  await update({ customPrices: next });
}