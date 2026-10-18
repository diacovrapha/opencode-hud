// Funções puras de agregação a partir das linhas do SQL.
// Recebe uma lista de "linhas de agregação" e produz os Breakdowns /
// DailyPoints / Sessions / Totals.

import type {
  Aggregate,
  Breakdown,
  DailyPoint,
  SessionInfo,
  TokenSet,
} from "./types";
import {
  dayKey,
  listDailyDays,
  periodStart,
  todayStart,
} from "./periods";
import type { ModelIndex, PriceLookup } from "./pricing";
import {
  findPrice,
  priceTokens,
  splitModelKey,
} from "./pricing";

// ----- Tipos de linha -----

export type AggRow = {
  date: string; // "YYYY-MM-DD" local
  providerId: string;
  modelId: string;
  agent: string;
  directory: string; // normalizado (backslashes -> "/")
  cost: number;
  tokens: TokenSet;
  messages: number;
  sessions: Set<string>; // ids distintos de sessões tocadas nessa linha
};

// ----- Aggregate helpers -----

export function emptyTokens(): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

export function emptyAggregate(): Aggregate {
  return {
    cost: 0,
    apiEquivalentCost: 0,
    referenceCost: 0,
    tokens: emptyTokens(),
    messages: 0,
    sessions: 0,
  };
}

export function addAggregate(a: Aggregate, b: Aggregate): Aggregate {
  return {
    cost: a.cost + b.cost,
    apiEquivalentCost: a.apiEquivalentCost + b.apiEquivalentCost,
    referenceCost: a.referenceCost + b.referenceCost,
    tokens: {
      input: a.tokens.input + b.tokens.input,
      output: a.tokens.output + b.tokens.output,
      reasoning: a.tokens.reasoning + b.tokens.reasoning,
      cacheRead: a.tokens.cacheRead + b.tokens.cacheRead,
      cacheWrite: a.tokens.cacheWrite + b.tokens.cacheWrite,
    },
    messages: a.messages + b.messages,
    sessions: a.sessions + b.sessions,
  };
}

export function makeAggregate(
  cost: number,
  tokens: TokenSet,
  messages: number,
  sessions: number,
): Aggregate {
  return { cost, apiEquivalentCost: 0, referenceCost: 0, tokens, messages, sessions };
}

/** Converte a linha SQL crua em um `AggRow` com a data já normalizada. */
export function rowToAggRow(
  r: RawRow,
  // session_id pode vir como `session_id` ou `sessionId` dependendo do SQL
  sessionIdOf: (r: RawRow) => string,
): AggRow {
  const date = localDateKeyFromMs(r.dayMs);
  const directory = normalizeDir(r.directory);
  return {
    date,
    providerId: r.providerId ?? "",
    modelId: r.modelId ?? "",
    agent: r.agent ?? "",
    directory,
    cost: r.cost,
    tokens: {
      input: r.tokens.input,
      output: r.tokens.output,
      reasoning: r.tokens.reasoning,
      cacheRead: r.tokens.cacheRead,
      cacheWrite: r.tokens.cacheWrite,
    },
    messages: r.messages,
    sessions: new Set([sessionIdOf(r)]),
  };
}

export type RawRow = {
  dayMs: number;
  providerId: string;
  modelId: string;
  agent: string;
  directory: string;
  cost: number;
  tokens: TokenSet;
  messages: number;
};

function localDateKeyFromMs(ms: number): string {
  // SQLite devolve o ms epoch; calculamos o dia local.
  return dayKey(new Date(ms));
}

export function normalizeDir(p: string): string {
  if (!p) return "";
  // O opencode grava com `/` mesmo no Windows; ainda assim, aceitamos `\\`.
  return p.replace(/\\/g, "/");
}

// ----- Sessões (a partir de linhas de mensagem) -----

export type SessionRawRow = {
  id: string;
  title: string;
  agent: string;
  providerId: string;
  modelId: string;
  directory: string;
  parentId: string | null;
  timeCreated: number;
  timeUpdated: number;
  archived: boolean;
  // agrega a própria sessão (mensagens atribuídas diretamente a ela).
  selfAggregate: Aggregate;
};

/**
 * Reduz uma lista de `SessionRawRow` em uma árvore de `SessionInfo`,
 * onde o aggregate de cada raiz inclui a si mesma + descendentes.
 *
 * Cada `SessionRawRow` carrega apenas o aggregate PRÓPRIO (mensagens cuja
 * session_id == id). Aqui somamos recursivamente para a raiz.
 */
export function buildSessionTree(
  sessions: SessionRawRow[],
): { roots: SessionInfo[]; byId: Map<string, SessionInfo> } {
  const byId = new Map<string, SessionInfo>();
  for (const s of sessions) {
    byId.set(s.id, {
      id: s.id,
      title: s.title,
      agent: s.agent,
      model: `${s.providerId}/${s.modelId}`,
      providerId: s.providerId,
      directory: s.directory,
      parentId: s.parentId,
      timeCreated: s.timeCreated,
      timeUpdated: s.timeUpdated,
      aggregate: { ...s.selfAggregate, sessions: 1 },
      children: [],
    });
  }
  const roots: SessionInfo[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  // Agrega self + descendentes nas raízes. Importante: cada nó contribui
  // o SEU próprio aggregate (não o da subárvore), evitando dupla contagem.
  for (const root of roots) {
    const acc = emptyAggregate();
    const stack: SessionInfo[] = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      const node = byId.get(cur.id)!;
      node.aggregate = addAggregate(node.aggregate, emptyAggregate());
      // Cada nó na pilha já tem o aggregate próprio. Somamos o self.
      acc.cost += node.aggregate.cost;
      acc.apiEquivalentCost += node.aggregate.apiEquivalentCost;
      acc.referenceCost += node.aggregate.referenceCost;
      acc.tokens.input += node.aggregate.tokens.input;
      acc.tokens.output += node.aggregate.tokens.output;
      acc.tokens.reasoning += node.aggregate.tokens.reasoning;
      acc.tokens.cacheRead += node.aggregate.tokens.cacheRead;
      acc.tokens.cacheWrite += node.aggregate.tokens.cacheWrite;
      acc.messages += node.aggregate.messages;
      // sessions: conta cada nó da subárvore uma vez.
      acc.sessions += 1;
      for (const c of node.children ?? []) stack.push(c);
    }
    root.aggregate = acc;
  }
  // Ordena filhos por timeUpdated desc para a UI ficar previsível.
  function sortChildren(node: SessionInfo): void {
    if (!node.children) return;
    node.children.sort((a, b) => b.timeUpdated - a.timeUpdated);
    for (const c of node.children) sortChildren(c);
  }
  for (const r of roots) sortChildren(r);
  return { roots, byId };
}

// ----- Breakdowns por modelo / agente / projeto -----

/** Agrega as linhas em `byModel`, `byAgent`, `byProject`. */
export function buildBreakdowns(
  rows: AggRow[],
  models: ModelIndex,
  referenceModel: string,
): { byModel: Breakdown[]; byAgent: Breakdown[]; byProject: Breakdown[] } {
  const refLookup = lookupRef(models, referenceModel);
  const modelMap = new Map<string, { label: string; cost: number; api: number; ref: number; tokens: TokenSet; msgs: number; sessionIds: Set<string>; priceMissing: boolean }>();
  const agentMap = new Map<string, { label: string; cost: number; api: number; ref: number; tokens: TokenSet; msgs: number; sessionIds: Set<string>; priceMissing: boolean }>();
  const projMap = new Map<string, { label: string; path: string; cost: number; api: number; ref: number; tokens: TokenSet; msgs: number; sessionIds: Set<string>; priceMissing: boolean }>();

  for (const r of rows) {
    const lookup = findPrice(models, r.providerId, r.modelId);
    const apiCost = lookup.via === "missing"
      ? 0
      : priceTokens(lookup.entry.cost, r.tokens);
    const refCost = priceWithLookup(refLookup, r.tokens);
    const priceMissing = lookup.via === "missing";

    // byModel: chave = "provider/modelId" canônico. Quando há fallback, usamos
    // o ID do fallback para a chave ficar estável.
    const modelKey = (lookup.via === "fallback")
      ? `${lookup.entry.providerId}/${lookup.entry.modelId}`
      : `${r.providerId}/${r.modelId}`;
    const modelLabel = (lookup.via === "fallback")
      ? `${lookup.entry.providerId}/${lookup.entry.modelId}`
      : modelKey;
    accumulateGroup(modelMap, modelKey, modelLabel, r, apiCost, refCost, priceMissing);

    accumulateGroup(agentMap, r.agent, r.agent || "(sem agente)", r, apiCost, refCost, priceMissing);
    accumulateGroup(
      projMap,
      r.directory,
      labelOfDir(r.directory),
      r,
      apiCost,
      refCost,
      priceMissing,
      { path: r.directory },
    );
  }

  return {
    byModel: finalize(modelMap, (v) => v.label, undefined),
    byAgent: finalize(agentMap, (v) => v.label, undefined),
    byProject: finalize(projMap, (v) => v.label, (v) => v.path),
  };
}

function lookupRef(models: ModelIndex, refModel: string): PriceLookup {
  if (!refModel) return { via: "missing" };
  const { providerId, modelId } = splitModelKey(refModel);
  return findPrice(models, providerId, modelId);
}

function priceWithLookup(lk: PriceLookup, t: TokenSet): number {
  return lk.via === "missing" ? 0 : priceTokens(lk.entry.cost, t);
}

function labelOfDir(d: string): string {
  if (!d) return "(sem projeto)";
  // Normalizado para "/". Pega a última pasta.
  const parts = d.split("/").filter(Boolean);
  return parts.length === 0 ? d : parts[parts.length - 1]!;
}

function accumulateGroup(
  map: Map<string, { label: string; cost: number; api: number; ref: number; tokens: TokenSet; msgs: number; sessionIds: Set<string>; priceMissing: boolean }>,
  key: string,
  label: string,
  r: AggRow,
  api: number,
  ref: number,
  priceMissing: boolean,
  extra?: { path: string },
): void {
  let g = map.get(key);
  if (!g) {
    g = {
      label,
      cost: 0,
      api: 0,
      ref: 0,
      tokens: emptyTokens(),
      msgs: 0,
      sessionIds: new Set<string>(),
      priceMissing: false,
    };
    map.set(key, g);
  }
  if (extra) (g as { path?: string }).path = extra.path;
  g.cost += r.cost;
  g.api += api;
  g.ref += ref;
  g.tokens = {
    input: g.tokens.input + r.tokens.input,
    output: g.tokens.output + r.tokens.output,
    reasoning: g.tokens.reasoning + r.tokens.reasoning,
    cacheRead: g.tokens.cacheRead + r.tokens.cacheRead,
    cacheWrite: g.tokens.cacheWrite + r.tokens.cacheWrite,
  };
  g.msgs += r.messages;
  for (const sid of r.sessions) g.sessionIds.add(sid);
  if (priceMissing) g.priceMissing = true;
}

type FinalInput = {
  label: string;
  cost: number;
  api: number;
  ref: number;
  tokens: TokenSet;
  msgs: number;
  sessionIds: Set<string>;
  priceMissing: boolean;
  path?: string;
};

function finalize(
  map: Map<string, FinalInput>,
  labelOf: (v: FinalInput) => string,
  pathOf?: (v: FinalInput) => string | undefined,
): Breakdown[] {
  const out: Breakdown[] = [];
  for (const [key, v] of map) {
    const b: Breakdown = {
      key,
      label: labelOf(v),
      aggregate: {
        cost: v.cost,
        apiEquivalentCost: v.api,
        referenceCost: v.ref,
        tokens: v.tokens,
        messages: v.msgs,
        sessions: v.sessionIds.size,
      },
      priceMissing: v.priceMissing,
    };
    const p = pathOf?.(v);
    if (p !== undefined) b.path = p;
    out.push(b);
  }
  out.sort((a, b) => b.aggregate.cost - a.aggregate.cost);
  return out;
}

// ----- Daily -----

/**
 * Constrói o array `daily` cobrindo exatamente os dias do período (sem buracos).
 * Cada ponto recebe os dados daquele dia (somando todas as linhas com a mesma
 * chave de data). Se o período é "all", o tamanho é limitado.
 */
export function buildDaily(
  rows: AggRow[],
  models: ModelIndex,
  referenceModel: string,
  periodKey: import("./types").PeriodKey,
  now: Date = new Date(),
): DailyPoint[] {
  const days = listDailyDays(periodKey, now);
  const refLookup = lookupRef(models, referenceModel);
  const dayMap = new Map<string, {
    cost: number; api: number; ref: number;
    tokens: TokenSet; msgs: number; sessionIds: Set<string>;
  }>();
  for (const d of days) dayMap.set(dayKey(d), blankDay());

  for (const r of rows) {
    const bucket = dayMap.get(r.date);
    if (!bucket) continue;
    const lookup = findPrice(models, r.providerId, r.modelId);
    const api = lookup.via === "missing" ? 0 : priceTokens(lookup.entry.cost, r.tokens);
    const ref = priceWithLookup(refLookup, r.tokens);
    bucket.cost += r.cost;
    bucket.api += api;
    bucket.ref += ref;
    bucket.tokens.input += r.tokens.input;
    bucket.tokens.output += r.tokens.output;
    bucket.tokens.reasoning += r.tokens.reasoning;
    bucket.tokens.cacheRead += r.tokens.cacheRead;
    bucket.tokens.cacheWrite += r.tokens.cacheWrite;
    bucket.msgs += r.messages;
    for (const sid of r.sessions) bucket.sessionIds.add(sid);
  }

  return days.map((d) => {
    const k = dayKey(d);
    const b = dayMap.get(k)!;
    return {
      date: k,
      aggregate: {
        cost: b.cost,
        apiEquivalentCost: b.api,
        referenceCost: b.ref,
        tokens: b.tokens,
        messages: b.msgs,
        sessions: b.sessionIds.size,
      },
    };
  });
}

function blankDay(): {
  cost: number; api: number; ref: number;
  tokens: TokenSet; msgs: number; sessionIds: Set<string>;
} {
  return { cost: 0, api: 0, ref: 0, tokens: emptyTokens(), msgs: 0, sessionIds: new Set<string>() };
}

// ----- Helpers para Snapshot -----

/** Soma uma lista de Aggregate (útil para `totals` e `today`). */
export function sumAggregates(items: Iterable<Aggregate>): Aggregate {
  const acc = emptyAggregate();
  for (const a of items) {
    acc.cost += a.cost;
    acc.apiEquivalentCost += a.apiEquivalentCost;
    acc.referenceCost += a.referenceCost;
    acc.tokens.input += a.tokens.input;
    acc.tokens.output += a.tokens.output;
    acc.tokens.reasoning += a.tokens.reasoning;
    acc.tokens.cacheRead += a.tokens.cacheRead;
    acc.tokens.cacheWrite += a.tokens.cacheWrite;
    acc.messages += a.messages;
    acc.sessions += a.sessions;
  }
  return acc;
}

/** Filtra linhas para um intervalo: do início do período até o fim do dia de hoje (inclusive). */
export function filterRowsByPeriod(
  rows: AggRow[],
  period: import("./types").PeriodKey,
  now: Date = new Date(),
): AggRow[] {
  const start = periodStart(period, now);
  const startMs = start ? start.getTime() : Number.NEGATIVE_INFINITY;
  const todayEnd = todayStart(now).getTime() + 24 * 60 * 60 * 1000 - 1;
  return rows.filter((r) => {
    const ms = parseDayKeyMs(r.date);
    return ms >= startMs && ms <= todayEnd;
  });
}

/** Linhas apenas do dia de hoje. */
export function rowsForToday(rows: AggRow[], now: Date = new Date()): AggRow[] {
  const today = dayKey(todayStart(now));
  return rows.filter((r) => r.date === today);
}

function parseDayKeyMs(k: string): number {
  // k = "YYYY-MM-DD" no fuso local. Constrói um Date local no início do dia.
  const [y, m, d] = k.split("-").map((s) => parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}