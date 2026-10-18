import { addDays, format } from "date-fns";
import type {
  Aggregate,
  Breakdown,
  DailyPoint,
  PeriodKey,
  ProviderInfo,
  SessionInfo,
  Snapshot,
  SubscriptionsSummary,
  TokenSet,
} from "./types";
import type { DataSource, DbRow } from "./api";
import { inferBilling } from "./providers";
import {
  buildModelIndex,
  ModelIndex,
} from "./pricing";

// ---------- helpers ----------

function emptyTokens(): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addAggregate(a: Aggregate, b: Aggregate): Aggregate {
  return {
    cost: a.cost + b.cost,
    apiEquivalentCost: a.apiEquivalentCost + b.apiEquivalentCost,
    referenceCost: a.referenceCost + b.referenceCost,
    recordedCost: (a.recordedCost ?? 0) + (b.recordedCost ?? 0),
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

function emptyAggregate(): Aggregate {
  return {
    cost: 0,
    apiEquivalentCost: 0,
    referenceCost: 0,
    tokens: emptyTokens(),
    messages: 0,
    sessions: 0,
  };
}

// ---------- mock models ----------

type ModelInfo = {
  id: string;
  label: string;
  inputPerM: number;
  outputPerM: number;
  /** "api" se o opencode registra custo token-based; "subscription"/"free" caso contrário. */
  billing: "api" | "subscription" | "free";
  /** Mensalidade (USD) quando assinatura. */
  monthlyFeeUsd?: number;
};

const MODELS: ModelInfo[] = [
  { id: "anthropic/claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerM: 3, outputPerM: 15, billing: "api" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", inputPerM: 0.8, outputPerM: 4, billing: "api" },
  { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", inputPerM: 15, outputPerM: 75, billing: "api" },
  { id: "minimax-coding-plan/coding-mini", label: "Coding Mini", inputPerM: 0.4, outputPerM: 2, billing: "subscription", monthlyFeeUsd: 14 },
  { id: "minimax-coding-plan/coding-pro", label: "Coding Pro", inputPerM: 1, outputPerM: 5, billing: "subscription", monthlyFeeUsd: 14 },
  { id: "github-copilot/gpt-4o", label: "Copilot GPT-4o", inputPerM: 2.5, outputPerM: 10, billing: "subscription" },
  { id: "ollama/llama3.2", label: "Llama 3.2 (local)", inputPerM: 0, outputPerM: 0, billing: "free" },
];

function modelById(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

function modelCost(id: string, input: number, output: number): number {
  const m = modelById(id);
  return (input / 1_000_000) * m.inputPerM + (output / 1_000_000) * m.outputPerM;
}

/**
 * Fixture mínima do `models.json` que reproduz as regras de billing que
 * usamos no `real.ts`: o minimax-coding-plan tem custo 0 mas com fallback
 * pay-as-you-go (mesmo comportamento do `pricing.ts`).
 */
const MOCK_MODELS_JSON = JSON.stringify({
  anthropic: {
    name: "Anthropic",
    models: {
      "claude-sonnet-5-5": { cost: { input: 3, output: 15 } },
      "claude-haiku-4-5": { cost: { input: 0.8, output: 4 } },
      "claude-opus-4-7": { cost: { input: 15, output: 75 } },
    },
  },
  minimax: {
    name: "MiniMax",
    models: {
      "coding-mini": { cost: { input: 0.4, output: 2 } },
      "coding-pro": { cost: { input: 1, output: 5 } },
    },
  },
  "minimax-coding-plan": {
    name: "MiniMax Coding Plan",
    models: {
      "coding-mini": { cost: { input: 0, output: 0 } },
      "coding-pro": { cost: { input: 0, output: 0 } },
    },
  },
  ollama: {
    name: "Ollama (local)",
    models: { "llama3.2": { cost: { input: 0, output: 0 } } },
  },
});
const MOCK_MODEL_INDEX: ModelIndex = buildModelIndex(MOCK_MODELS_JSON);

// ---------- mock sessions ----------

type RawSession = {
  id: string;
  title: string;
  agent: string;
  model: string;
  directory: string;
  parentId: string | null;
  startOffsetDays: number;
  durationMin: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
};

const AGENTS = [
  "chefe",
  "ideador",
  "pleno",
  "senior",
  "junior",
  "qa",
  "pesquisador",
  "explore",
];

const PROJECTS = [
  "C:\\projetos\\opencode-hud",
  "C:\\projetos\\portfolio-site",
  "C:\\projetos\\data-pipeline",
];

function pseudoRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function buildSessions(): RawSession[] {
  const rnd = pseudoRandom(42);
  const sessions: RawSession[] = [];

  // Pesos para sortear modelos com providers mistos (anthropic api, subscription
  // MiniMax/Copilot, Ollama local). O índice dos MODELS define a ordem.
  const weighted: Array<{ id: string; w: number }> = [
    { id: "anthropic/claude-sonnet-5-5", w: 4 },
    { id: "anthropic/claude-haiku-4-5", w: 3 },
    { id: "anthropic/claude-opus-4-7", w: 1 },
    { id: "minimax-coding-plan/coding-mini", w: 4 },
    { id: "minimax-coding-plan/coding-pro", w: 2 },
    { id: "github-copilot/gpt-4o", w: 3 },
    { id: "ollama/llama3.2", w: 1 },
  ];
  const totalWeight = weighted.reduce((s, x) => s + x.w, 0);
  const pickWeighted = (): string => {
    let r = rnd() * totalWeight;
    for (const w of weighted) {
      r -= w.w;
      if (r <= 0) return w.id;
    }
    return weighted[0]!.id;
  };

  // 15 sessões espalhadas pelos últimos 30 dias.
  for (let i = 0; i < 15; i++) {
    const agent = AGENTS[Math.floor(rnd() * AGENTS.length)];
    const model = pickWeighted();
    const project = PROJECTS[Math.floor(rnd() * PROJECTS.length)];
    const start = Math.floor(rnd() * 30);
    const dur = 5 + Math.floor(rnd() * 90);
    const msgs = 3 + Math.floor(rnd() * 40);
    const inp = 5_000 + Math.floor(rnd() * 800_000);
    const out = 1_000 + Math.floor(rnd() * 200_000);
    sessions.push({
      id: `s_${i.toString().padStart(3, "0")}`,
      title: titleFor(agent, i),
      agent,
      model,
      directory: project,
      parentId: null,
      startOffsetDays: start,
      durationMin: dur,
      messages: msgs,
      inputTokens: inp,
      outputTokens: out,
    });
  }

  // 4 sessões filhas (sub-agentes) para o chefe/pleno/qa.
  const parents = [sessions[0], sessions[2], sessions[4], sessions[7]];
  parents.forEach((p, idx) => {
    sessions.push({
      id: `s_child_${idx}`,
      title: `Sub-tarefa: ${p.title}`,
      agent: p.agent === "chefe" ? "pleno" : p.agent === "pleno" ? "junior" : "qa",
      model: pickWeighted(),
      directory: p.directory,
      parentId: p.id,
      startOffsetDays: p.startOffsetDays,
      durationMin: 2 + Math.floor(rnd() * 12),
      messages: 1 + Math.floor(rnd() * 8),
      inputTokens: 1_000 + Math.floor(rnd() * 80_000),
      outputTokens: 200 + Math.floor(rnd() * 20_000),
    });
  });

  return sessions;
}

function titleFor(_agent: string, i: number): string {
  const themes = [
    "Revisar dashboard de custos",
    "Investigar alerta de quota",
    "Refatorar coleta de métricas",
    "Planejar sprint Q4",
    "Documentar API de modelos",
    "Migrar provider Anthropic",
    "Otimizar cache de sessões",
    "Adicionar gráfico de tokens",
    "Criar agente pesquisador",
    "Configurar CI para release",
    "Auditoria de segurança",
    "Escrever testes do widget",
    "Implementar notificações",
    "Sincronizar USD/BRL",
    "Limpar logs antigos",
  ];
  return `${themes[i % themes.length]} (#${i + 1})`;
}

/**
 * Aggregate de UMA sessão mock. Aplica as REGRAS DE BILLING da v2 para que
 * `cost` (variável) bata com o que o real.ts produziria:
 *
 * - `recordedCost` = `tokens × price` (o que o opencode registrou).
 * - `cost`         = `recordedCost` se billing = "api"; senão 0.
 * - `apiEquivalent` = `recordedCost` se > 0; senão `tokens × price`
 *                   com fallback (minimax-coding-plan → minimax).
 * - `referenceCost` = `tokens × preço do modelo de referência` (Sonnet 5.5).
 */
function aggregateFor(s: RawSession): Aggregate {
  const tokens: TokenSet = {
    input: s.inputTokens,
    output: s.outputTokens,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const recorded = modelCost(s.model, s.inputTokens, s.outputTokens);
  const billing = modelById(s.model).billing;
  const variable = billing === "api" ? recorded : 0;
  const lookup = lookupModelForMock(s.model);
  const apiEquivalent = recorded > 0
    ? recorded
    : (lookup ? priceTokensFor(lookup.cost, tokens) : 0);
  const reference = computeReferenceCost(tokens);
  return {
    cost: variable,
    recordedCost: recorded,
    apiEquivalentCost: apiEquivalent,
    referenceCost: reference,
    tokens,
    messages: s.messages,
    sessions: 1,
  } as Aggregate;
}

/** Resolve `(provider, modelId)` no índice mock, com fallback para assinatura. */
function lookupModelForMock(qualified: string): { cost: { input: number; output: number; cacheRead: number; cacheWrite: number } } | null {
  const [providerId, modelId = ""] = qualified.split("/");
  const direct = MOCK_MODEL_INDEX.get(`${providerId}\u0000${modelId}`);
  if (direct && (direct.cost.input > 0 || direct.cost.output > 0)) {
    return direct;
  }
  if (providerId === "minimax-coding-plan") {
    const fb = MOCK_MODEL_INDEX.get(`minimax\u0000${modelId}`);
    if (fb) return fb;
  }
  if (providerId === "github-copilot") {
    // Para o mock, caímos no openai genérico (mesma lógica de fallback).
    const fb = MOCK_MODEL_INDEX.get(`openai\u0000${modelId}`);
    if (fb) return fb;
  }
  return direct ?? null;
}

function priceTokensFor(
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number },
  tokens: TokenSet,
): number {
  return (tokens.input / 1_000_000) * cost.input +
    (tokens.output / 1_000_000) * cost.output;
}

function computeReferenceCost(tokens: TokenSet): number {
  const direct = MOCK_MODEL_INDEX.get("anthropic\u0000claude-sonnet-5-5");
  if (!direct) return 0;
  return priceTokensFor(direct.cost, tokens);
}

// ---------- build tree ----------

function buildSessionTree(raw: RawSession[]): {
  roots: SessionInfo[];
  all: SessionInfo[];
} {
  const byId = new Map<string, SessionInfo>();
  for (const s of raw) {
    byId.set(s.id, {
      id: s.id,
      title: s.title,
      agent: s.agent,
      model: s.model,
      providerId: s.model.split("/")[0],
      directory: s.directory,
      parentId: s.parentId,
      timeCreated: Date.now() - s.startOffsetDays * 86_400_000,
      timeUpdated:
        Date.now() - s.startOffsetDays * 86_400_000 + s.durationMin * 60_000,
      aggregate: aggregateFor(s),
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
  return { roots, all: [...byId.values()] };
}

// ---------- snapshot ----------

function buildDaily(all: SessionInfo[]): DailyPoint[] {
  const today = new Date();
  const buckets: DailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = addDays(today, -i);
    const key = format(day, "yyyy-MM-dd");
    buckets.push({ date: key, aggregate: emptyAggregate() });
  }
  const idx = new Map(buckets.map((b, i) => [b.date, i]));
  for (const s of all) {
    const key = format(new Date(s.timeCreated), "yyyy-MM-dd");
    const i = idx.get(key);
    if (i === undefined) continue;
    buckets[i].aggregate = addAggregate(buckets[i].aggregate, s.aggregate);
  }
  // Garante que sessões e mensagens batem.
  for (const b of buckets) {
    b.aggregate.sessions = all.filter(
      (s) => format(new Date(s.timeCreated), "yyyy-MM-dd") === b.date,
    ).length;
  }
  return buckets;
}

function filterByPeriod(
  all: SessionInfo[],
  period: PeriodKey,
): SessionInfo[] {
  if (period === "all") return all;
  const now = Date.now();
  let cutoff = 0;
  switch (period) {
    case "today":
      cutoff = now - 86_400_000;
      break;
    case "7d":
      cutoff = now - 7 * 86_400_000;
      break;
    case "30d":
      cutoff = now - 30 * 86_400_000;
      break;
    case "month": {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      cutoff = d.getTime();
      break;
    }
  }
  return all.filter((s) => s.timeCreated >= cutoff);
}

function groupBy<T>(
  items: T[],
  keyOf: (t: T) => string,
  labelOf: (k: string) => string,
): Breakdown[] {
  const groups = new Map<string, { agg: Aggregate; label: string }>();
  for (const it of items) {
    const k = keyOf(it);
    const label = labelOf(k);
    const cur = groups.get(k) ?? { agg: emptyAggregate(), label };
    cur.agg = addAggregate(cur.agg, (it as unknown as { aggregate: Aggregate }).aggregate);
    groups.set(k, cur);
  }
  return [...groups.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      aggregate: { ...v.agg, sessions: v.agg.sessions > 0 ? 1 : 0 },
    }))
    .sort((a, b) => b.aggregate.cost - a.aggregate.cost);
}

// ---------- DataSource mock ----------

export class MockDataSource implements DataSource {
  private raw = buildSessions();
  private tree = buildSessionTree(this.raw);

  async getSnapshot(period: PeriodKey): Promise<Snapshot> {
    const { all, roots } = this.tree;
    const filtered = filterByPeriod(all, period);

    const totals = filtered.reduce(
      (acc, s) => addAggregate(acc, s.aggregate),
      emptyAggregate(),
    );
    totals.sessions = filtered.length;

    const today = filtered.filter(
      (s) => s.timeCreated >= Date.now() - 86_400_000,
    );
    const todayAgg = today.reduce(
      (acc, s) => addAggregate(acc, s.aggregate),
      emptyAggregate(),
    );
    todayAgg.sessions = today.length;

    const daily = buildDaily(all);
    const byModel = groupBy(
      filtered,
      (s) => s.model,
      (k) => modelById(k).label,
    );
    const byAgent = groupBy(
      filtered,
      (s) => s.agent,
      (k) => k,
    );
    const byProject = groupBy(
      filtered,
      (s) => s.directory,
      (k) => k.split("\\").pop() ?? k,
    );

    // Corrige contagem de "sessions" nos breakdowns (soma de sessões distintas).
    for (const b of byModel) {
      b.aggregate.sessions = filtered.filter((s) => s.model === b.key).length;
    }
    for (const b of byAgent) {
      b.aggregate.sessions = filtered.filter((s) => s.agent === b.key).length;
    }
    for (const b of byProject) {
      b.aggregate.sessions = filtered.filter((s) => s.directory === b.key).length;
    }

    const agentsConfig = [
      "chefe",
      "ideador",
      "pleno",
      "senior",
      "junior",
      "qa",
      "pesquisador",
      "explore",
    ].map((name) => ({
      name,
      model: MODELS[0].id,
      mode: (name === "chefe" || name === "ideador" ? "primary" : "subagent") as
        | "primary"
        | "subagent",
    }));

    // ---- v2: provedores, assinaturas, referência ----
    const usdBrlRate = 5.32;
    const providers = buildMockProviders(all, filtered, agentsConfig, usdBrlRate);
    const subscriptions = buildMockSubscriptions(providers);
    const reference = buildMockReference(all);

    return {
      generatedAt: new Date().toISOString(),
      opencodeRunning: true,
      usdBrl: { rate: usdBrlRate, updatedAt: new Date().toISOString() },
      period,
      totals,
      today: todayAgg,
      currentSession: roots[0] ?? null,
      byModel,
      byAgent,
      byProject,
      daily,
      sessions: roots,
      agentsConfig,
      budget: { currency: "BRL", daily: 50, monthly: 800 },
      projection: { monthCost: todayAgg.cost * 18 },
      providers,
      subscriptions,
      reference,
    };
  }
}

// ---------- helpers v2 (mock-only) ----------

function buildMockReference(
  all: SessionInfo[],
): import("./types").ResolvedReference {
  // Modo AUTO: o agente "chefe" existe em agentsConfig → pegamos o primeiro
  // model dele, ou caímos no modelo mais usado.
  for (const s of all) {
    if (s.agent === "chefe") {
      return {
        model: s.model,
        label: s.model.split("/").pop() ?? s.model,
        mode: "auto",
        source: "agente principal: chefe",
        priceMissing: false,
      };
    }
  }
  return {
    model: REFERENCE_MODEL_VALUE,
    label: "claude-sonnet-5-5",
    mode: "auto",
    source: "modelo padrão do opencode",
    priceMissing: false,
  };
}

const REFERENCE_MODEL_VALUE = "anthropic/claude-sonnet-5-5";

function buildMockProviders(
  all: SessionInfo[],
  filtered: SessionInfo[],
  _agentsConfig: AgentConfigLike[],
  usdBrlRate: number,
): ProviderInfo[] {
  // Agrupa por providerId e constrói ProviderInfo.
  const byProvider = new Map<string, { monthAgg: Aggregate; allAgg: Aggregate; models: Set<string>; lastUsed: number }>();
  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();
  for (const s of all) {
    const pid = s.providerId;
    if (!pid) continue;
    const cur = byProvider.get(pid) ?? {
      monthAgg: emptyAggregate(),
      allAgg: emptyAggregate(),
      models: new Set<string>(),
      lastUsed: 0,
    };
    cur.allAgg = addAggregate(cur.allAgg, s.aggregate);
    if (s.timeCreated >= monthStartMs) {
      cur.monthAgg = addAggregate(cur.monthAgg, s.aggregate);
    }
    cur.models.add(s.model.split("/").pop() ?? s.model);
    if (s.timeUpdated > cur.lastUsed) cur.lastUsed = s.timeUpdated;
    cur.lastUsed = Math.max(cur.lastUsed, now);
    byProvider.set(pid, cur);
  }
  // Filtramos providers sem uso no período selecionado? Não: ProviderInfo
  // também lista provedores "vistos no histórico". Usamos `filtered` apenas
  // para a UI poder mostrar "0 no período" — mas o tipo é mensal aqui.
  void filtered;
  const out: ProviderInfo[] = [];
  for (const [pid, v] of byProvider) {
    const providerMeta = MOCK_MODEL_INDEX.providers.get(pid);
    const label = providerMeta?.name ?? pid;
    const billing = inferBilling(pid, MOCK_MODEL_INDEX);
    const monthlyFeeUsd = inferMockMonthlyFee(pid, usdBrlRate);
    out.push({
      id: pid,
      label,
      billing,
      inferred: true, // mock: nenhum provider configurado pelo user
      monthlyFeeUsd,
      models: [...v.models].sort(),
      monthAggregate: v.monthAgg,
      allTimeAggregate: v.allAgg,
      lastUsed: v.lastUsed,
    });
  }
  out.sort((a, b) => b.lastUsed - a.lastUsed);
  return out;
}

type AgentConfigLike = { name: string; model: string };

function inferMockMonthlyFee(providerId: string, _usdBrlRate: number): number | undefined {
  switch (providerId) {
    case "minimax-coding-plan":
      return 14;
    case "github-copilot":
      return undefined;
    case "ollama":
      return undefined;
    default:
      return undefined;
  }
}

function buildMockSubscriptions(providers: ProviderInfo[]): SubscriptionsSummary {
  const items: import("./types").SubscriptionValue[] = [];
  let monthlyTotalUsd = 0;
  let apiEquivalentMonthUsd = 0;
  for (const p of providers) {
    if (p.billing !== "subscription") continue;
    const hasUsage =
      (p.monthAggregate.messages ?? 0) > 0 ||
      (p.monthAggregate.tokens.input ?? 0) > 0;
    const hasFee = p.monthlyFeeUsd !== undefined;
    if (!hasUsage && !hasFee) continue;
    const item: import("./types").SubscriptionValue = {
      providerId: p.id,
      label: p.label,
      monthlyFeeUsd: p.monthlyFeeUsd,
      apiEquivalentMonthUsd: p.monthAggregate.apiEquivalentCost ?? 0,
    };
    if (p.monthlyFeeUsd !== undefined && p.monthlyFeeUsd > 0) {
      item.multiple = item.apiEquivalentMonthUsd / p.monthlyFeeUsd;
      monthlyTotalUsd += p.monthlyFeeUsd;
    }
    apiEquivalentMonthUsd += item.apiEquivalentMonthUsd;
    items.push(item);
  }
  return { monthlyTotalUsd, apiEquivalentMonthUsd, items };
}

// Pequeno helper exportado para outras tarefas testarem a forma dos dados
// sem precisar montar uma árvore inteira.
export function mockDbProbe(): DbRow[] {
  return [
    { name: "session", count: 15 },
    { name: "message", count: 312 },
    { name: "part", count: 1480 },
  ];
}