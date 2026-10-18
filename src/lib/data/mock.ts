import { addDays, format } from "date-fns";
import type {
  Aggregate,
  Breakdown,
  DailyPoint,
  PeriodKey,
  SessionInfo,
  Snapshot,
  TokenSet,
} from "./types";
import type { DataSource, DbRow } from "./api";

// ---------- helpers ----------

function emptyTokens(): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function makeAggregate(
  input: number,
  output: number,
  cost: number,
  messages = 0,
  sessions = 0,
  reasoning = 0,
  cacheRead = 0,
  cacheWrite = 0,
): Aggregate {
  const tokens: TokenSet = {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
  };
  // Para uso o conjunto: o custo de referência (Sonnet 5.5) é aproximadamente
  // 3.75x o custo médio aqui (heurística para o mock).
  const apiEquivalent = cost * 0.55;
  const reference = cost * 1.4;
  return {
    cost,
    apiEquivalentCost: apiEquivalent,
    referenceCost: reference,
    tokens,
    messages,
    sessions,
  };
}

function addAggregate(a: Aggregate, b: Aggregate): Aggregate {
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
};

const MODELS: ModelInfo[] = [
  { id: "anthropic/claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerM: 3, outputPerM: 15 },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", inputPerM: 0.8, outputPerM: 4 },
  { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", inputPerM: 15, outputPerM: 75 },
  { id: "minimax-coding-plan/coding-mini", label: "Coding Mini", inputPerM: 0.4, outputPerM: 2 },
  { id: "minimax-coding-plan/coding-pro", label: "Coding Pro", inputPerM: 1, outputPerM: 5 },
];

function modelById(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

function modelCost(id: string, input: number, output: number): number {
  const m = modelById(id);
  return (input / 1_000_000) * m.inputPerM + (output / 1_000_000) * m.outputPerM;
}

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

  // 15 sessões espalhadas pelos últimos 30 dias.
  for (let i = 0; i < 15; i++) {
    const agent = AGENTS[Math.floor(rnd() * AGENTS.length)];
    const model = MODELS[Math.floor(rnd() * MODELS.length)].id;
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
      model: "minimax-coding-plan/coding-mini",
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

function aggregateFor(s: RawSession): Aggregate {
  const cost = modelCost(s.model, s.inputTokens, s.outputTokens);
  return makeAggregate(
    s.inputTokens,
    s.outputTokens,
    cost,
    s.messages,
    1,
  );
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

    return {
      generatedAt: new Date().toISOString(),
      opencodeRunning: true,
      usdBrl: { rate: 5.32, updatedAt: new Date().toISOString() },
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
    };
  }
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