// Implementação "real" do DataSource: consome o SQLite via `dbQuery`,
// carrega o `models.json`/`opencode.jsonc`/`agents/*.md` via
// `readOpencode_file`, e consulta a cotação USD→BRL.
//
// Performance:
//   - Cache dos dias PASSADOS (não-hoje) por período + dia, com TTL de 5min
//     ou invalidado por troca de período.
//   - A cada tick (~5s), reconsulta só o dia de hoje e a sessão atual.
//   - O `models.json` (~6 MB) é parseado UMA vez e o índice é mantido em
//     memória, recarregado a cada 6h.

import {
  dbPathInfo,
  dbQuery,
  opencodeRunning,
  readOpencodeFile,
} from "./api";
import type { DataSource, DbRow } from "./api";
import type {
  Aggregate,
  AgentConfig,
  Breakdown,
  DailyPoint,
  PeriodKey,
  SessionInfo,
  Settings,
  Snapshot,
  SubscriptionsSummary,
  UsdBrlRate,
} from "./types";
import {
  periodStartMs,
  todayStart,
} from "./periods";
import {
  buildBreakdowns,
  buildDaily,
  addAggregate,
  buildSessionTree,
  emptyAggregate,
  priceFor,
  totalAggregate,
  filterRowsByPeriod,
  normalizeDir,
  rowToAggRow,
  rowsForToday,
  type AggRow,
  type SessionRawRow,
} from "./aggregate";
import {
  MODELS_RELOAD_MS,
  buildModelIndex,
  ModelIndex,
} from "./pricing";
import { extractAgentsConfig } from "./agents";
import { fetchUsdBrl } from "./usdbrl";
import { loadSettings } from "./settings";
import { monthProjection } from "./budget";
import {
  buildProvidersList,
  computeBillingContext,
  type BillingContext,
  rowBillableCost,
} from "./providers";
import { resolveReference } from "./reference";
import { _setCatalogSource } from "./catalog";
import { DEFAULT_SETTINGS } from "./types";

const HISTORY_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 5 * 1000;

// ----- Helpers de tipos das linhas do DB -----

type Num = number;

function num(v: unknown, fallback = 0): Num {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** "YYYY-MM-DD" (dia local vindo do SQLite) → epoch ms da meia-noite local. */
export function localDayToMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function asRows(r: DbRow[]): Array<Record<string, unknown>> {
  return r as unknown as Array<Record<string, unknown>>;
}

// ----- Cache -----

type CacheEntry = {
  rows: AggRow[];
  fetchedAt: number;
};

class SnapshotCache {
  private byPeriod = new Map<PeriodKey, CacheEntry>();

  get(period: PeriodKey): CacheEntry | null {
    const e = this.byPeriod.get(period);
    return e ?? null;
  }

  set(period: PeriodKey, entry: CacheEntry): void {
    this.byPeriod.set(period, entry);
  }

  clear(): void {
    this.byPeriod.clear();
  }
}

class ModelsCache {
  private idx: ModelIndex | null = null;
  private fetchedAt = 0;
  private raw: string | null = null;
  constructor() {}
  get(): ModelIndex {
    const stale = !this.idx || Date.now() - this.fetchedAt > MODELS_RELOAD_MS;
    if (stale && this.raw) {
      try {
        this.idx = buildModelIndex(this.raw);
        this.fetchedAt = Date.now();
      } catch {
        if (!this.idx) this.idx = null;
      }
    }
    return this.idx ?? new ModelIndex(new Map(), new Map());
  }
  setRaw(raw: string | null): void {
    this.raw = raw;
    this.idx = null;
    this.fetchedAt = 0;
  }
  /** Devolve o índice atual (ou `null` se nunca carregado) — usado pelo catálogo. */
  peek(): ModelIndex | null {
    return this.idx;
  }
}

// ----- RealDataSource -----

export class RealDataSource implements DataSource {
  private history = new SnapshotCache();
  private currentSessionCache: { tree: { roots: SessionInfo[]; byId: Map<string, SessionInfo> }; fetchedAt: number } = {
    tree: { roots: [], byId: new Map() },
    fetchedAt: 0,
  };
  private models = new ModelsCache();
  private usdBrlCache: { value: UsdBrlRate | null; fetchedAt: number } = {
    value: null,
    fetchedAt: 0,
  };
  private lastPeriod: PeriodKey | null = null;
  private referenceModel: string = DEFAULT_SETTINGS.referenceModel;
  /** BillingContext mais recente — reusado em `fetchSessionSelfAggregates`. */
  private _lastBillingCtx: BillingContext | null = null;

  async getSnapshot(period: PeriodKey): Promise<Snapshot> {
    if (this.lastPeriod !== period) {
      this.history.clear();
      this.rowsForCurrentMonthCache = null;
      this.lastPeriod = period;
    }
    // 1) USD/BRL — cache 6h; se falhou a última vez, re-tenta sem bloquear.
    const usdBrl = await this.fetchUsdBrl().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] fetchUsdBrl falhou:", e);
      return null;
    });

    // 2) Settings (autostart sync acontece em `settings.ts`).
    const settings = await loadSettings().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] loadSettings falhou:", e);
      return { ...DEFAULT_SETTINGS };
    });
    if (settings.referenceModel !== this.referenceModel) {
      // Os custos das sessões dependem do modelo de referência: refaz o cache.
      this.referenceModel = settings.referenceModel;
      this.currentSessionCache.fetchedAt = 0;
    }

    // 3) Verifica se o banco existe.
    let dbExists = true;
    try {
      const info = await dbPathInfo();
      dbExists = info.exists;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] dbPathInfo falhou:", e);
      dbExists = false;
    }
    if (!dbExists) {
      return this.buildEmptySnapshot(
        period,
        settings,
        usdBrl,
        "Banco do opencode não encontrado em %USERPROFILE%\\.local\\share\\opencode\\opencode.db.",
      );
    }

    // 4) Recarrega models.json periodicamente.
    try {
      await this.refreshModelsIfStale();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] refreshModelsIfStale falhou:", e);
    }

    // 5) Cache dos dias passados (histórico do período, sem hoje).
    let histRows: AggRow[] = [];
    try {
      const cached = this.history.get(period);
      if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) {
        histRows = cached.rows;
      } else {
        histRows = await this.queryPeriod(period, false);
        this.history.set(period, { rows: histRows, fetchedAt: Date.now() });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[RealDataSource] queryPeriod falhou:", e);
      throw new Error(`Falha ao consultar o banco: ${(e as Error).message}`);
    }

    // 6) Dia de hoje — sempre re-consultado.
    let todayRows: AggRow[] = [];
    try {
      todayRows = await this.queryToday();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[RealDataSource] queryToday falhou:", e);
      throw new Error(`Falha ao consultar o dia de hoje: ${(e as Error).message}`);
    }
    const combinedRows = [...histRows, ...todayRows];
    const filtered = filterRowsByPeriod(combinedRows, period);

    // 7) Sessão atual — cache curto.
    let currentSession: {
      roots: SessionInfo[];
      byId: Map<string, SessionInfo>;
    };
    try {
      currentSession = await this.fetchCurrentSession();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] fetchCurrentSession falhou:", e);
      currentSession = { roots: [], byId: new Map() };
    }

    // 8) Filtra sessões para o período também (mantém só raízes com
    // atividade ou descendentes no período).
    const periodRoots = this.filterRootsByPeriod(currentSession.roots, period);

    // 9) agentsConfig + opencode.jsonc (necessários para a referência AUTO)
    let agentsConfig: AgentConfig[] = [];
    let agentsJson = "{}";
    let configJson = "";
    try {
      const [a, c] = await Promise.all([
        readOpencodeFile("agents").catch(() => "{}"),
        readOpencodeFile("config").catch(() => ""),
      ]);
      agentsJson = a;
      configJson = c;
      agentsConfig = extractAgentsConfig(agentsJson, configJson);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] loadAgentsConfig falhou:", e);
      agentsConfig = [];
    }
    const running = await opencodeRunning().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] opencodeRunning falhou:", e);
      return false;
    });

    // 10) Modelo de referência RESOLVIDO. Em modo "manual" usa `referenceModel`
    // cru do settings; em modo "auto" consulta `default_agent` etc. O resultado
    // entra no `BillingContext` para ser usado nos preços de referência.
    const reference = resolveReference({
      mode: settings.referenceMode,
      manualModel: settings.referenceModel,
      agentsJson,
      configJson,
      agentsConfig,
      rows: combinedRows,
      models: this.models.peek() ?? new ModelIndex(new Map(), new Map()),
      now: new Date(),
    });
    // Cache local só para `fetchSessionSelfAggregates` usar a referência atual.
    this.referenceModel = reference.model || DEFAULT_SETTINGS.referenceModel;

    // 11) BillingContext pré-computado UMA vez por snapshot (não por linha).
    const models = this.models.get();
    const billingCtx = computeBillingContext({
      rows: combinedRows,
      models,
      settings,
      referenceModel: this.referenceModel,
    });
    this._lastBillingCtx = billingCtx;
    // Registra o índice no catálogo para a busca via Settings usar o índice já
    // carregado pelo data source (sem reler models.json a cada query).
    this.registerCatalogSource();

    // 12) Build breakdowns / daily / totals AGORA COM BILLING APLICADA.
    let breakdowns = { byModel: [] as Breakdown[], byAgent: [] as Breakdown[], byProject: [] as Breakdown[] };
    let daily: DailyPoint[] = [];
    try {
      breakdowns = buildBreakdowns(filtered, models, this.referenceModel, billingCtx);
      daily = buildDaily(filtered, models, this.referenceModel, period, new Date(), billingCtx);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[RealDataSource] buildBreakdowns/buildDaily falhou:", e);
    }
    const byModel: Breakdown[] = breakdowns.byModel;
    const byAgent: Breakdown[] = breakdowns.byAgent;
    const byProject: Breakdown[] = breakdowns.byProject;

    const totalsAgg = totalAggregate(filtered, models, this.referenceModel, billingCtx);
    const todayAgg = totalAggregate(rowsForToday(combinedRows), models, this.referenceModel, billingCtx);

    // 13) Projeção do mês (somente o GASTO VARIÁVEL do mês corrente).
    let projection = { monthCost: 0 };
    try {
      const monthRows = await this.rowsForCurrentMonth();
      // monthProjection consome o `cost` JÁ COM BILLING APLICADA.
      const monthAgg = aggregateRowsBare(monthRows, billingCtx);
      projection = { monthCost: monthProjection(monthAgg.cost) };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] rowsForCurrentMonth falhou:", e);
    }

    // 14) Provedores detectados + assinaturas.
    let providers: import("./types").ProviderInfo[] = [];
    let subscriptions: SubscriptionsSummary = { monthlyTotalUsd: 0, apiEquivalentMonthUsd: 0, items: [] };
    try {
      const monthRows = await this.rowsForCurrentMonth();
      providers = buildProvidersList({
        rows: combinedRows,
        monthRows,
        models,
        ctx: billingCtx,
        usdBrlRate: usdBrl?.rate ?? null,
      });
      subscriptions = buildSubscriptionsSummary(providers);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[RealDataSource] buildProvidersList falhou:", e);
    }

    return {
      generatedAt: new Date().toISOString(),
      opencodeRunning: running,
      usdBrl,
      period,
      totals: totalsAgg,
      today: todayAgg,
      currentSession: pickCurrentSessionRoot(currentSession.roots),
      byModel,
      byAgent,
      byProject,
      daily,
      sessions: periodRoots,
      agentsConfig,
      budget: {
        currency: settings.currency,
        daily: settings.budgetDaily,
        monthly: settings.budgetMonthly,
      },
      projection,
      providers,
      subscriptions,
      reference,
      needsOnboarding: !settings.onboardingDone,
    };
  }

  // ---------- helpers ----------

  private buildEmptySnapshot(
    period: PeriodKey,
    settings: Settings,
    usdBrl: UsdBrlRate | null,
    error: string,
  ): Snapshot {
    return {
      generatedAt: new Date().toISOString(),
      opencodeRunning: false,
      usdBrl,
      period,
      totals: emptyAggregate(),
      today: emptyAggregate(),
      currentSession: null,
      byModel: [],
      byAgent: [],
      byProject: [],
      daily: [],
      sessions: [],
      agentsConfig: [],
      budget: {
        currency: settings.currency,
        daily: settings.budgetDaily,
        monthly: settings.budgetMonthly,
      },
      projection: { monthCost: 0 },
      providers: [],
      subscriptions: { monthlyTotalUsd: 0, apiEquivalentMonthUsd: 0, items: [] },
      reference: {
        model: settings.referenceModel,
        label: settings.referenceModel.split("/").pop() ?? settings.referenceModel,
        mode: settings.referenceMode,
        priceMissing: true,
      },
      needsOnboarding: !settings.onboardingDone,
      error,
    };
  }

  /**
   * Registra o índice do `models.json` e o conjunto de chaves usadas como
   * "fonte" para `searchCatalog` (em `catalog.ts`). Chamado uma vez por
   * snapshot — basta passar a referência; o catálogo só consome quando a UI
   * precisar.
   */
  private registerCatalogSource(): void {
    const idx = this.models.peek();
    if (!idx || idx.size === 0) {
      _setCatalogSource(null);
      return;
    }
    _setCatalogSource({
      getModels: () => this.models.peek(),
      getUsedKeys: async () => {
        // Cache simples: guarda o Set entre chamadas.
        if (this._usedKeysCache && Date.now() - this._usedKeysCache.fetchedAt < 5 * 60 * 1000) {
          return this._usedKeysCache.keys;
        }
        const allRows = await this.fetchAllKnownProviderModelKeys();
        const keys = new Set<string>();
        for (const k of allRows) keys.add(k);
        this._usedKeysCache = { keys, fetchedAt: Date.now() };
        return keys;
      },
    });
  }

  private _usedKeysCache: { keys: Set<string>; fetchedAt: number } | null = null;

  /**
   * Devolve `provider/model` distintos já vistos em qualquer mensagem
   * (não cacheado por período). Implementação: GROUP BY no SQLite.
   */
  private async fetchAllKnownProviderModelKeys(): Promise<string[]> {
    try {
      const rows = await dbQuery(
        `SELECT DISTINCT
          json_extract(m.data, '$.providerID') AS provider_id,
          json_extract(m.data, '$.modelID') AS model_id
         FROM message m
         WHERE json_extract(m.data, '$.role') = 'assistant'
           AND json_extract(m.data, '$.providerID') IS NOT NULL
           AND json_extract(m.data, '$.modelID') IS NOT NULL`,
      );
      const out: string[] = [];
      for (const r of asRows(rows)) {
        const pid = str(r["provider_id"]);
        const mid = str(r["model_id"]);
        if (pid && mid) out.push(`${pid}/${mid}`);
      }
      return out;
    } catch {
      return [];
    }
  }

  private async fetchUsdBrl(): Promise<UsdBrlRate | null> {
    // Cache em memória: 5 min. A função fetchUsdBrl já tem cache de 6h no store.
    if (this.usdBrlCache.value && Date.now() - this.usdBrlCache.fetchedAt < 5 * 60 * 1000) {
      return this.usdBrlCache.value;
    }
    const v = await fetchUsdBrl().catch(() => null);
    this.usdBrlCache = { value: v, fetchedAt: Date.now() };
    return v;
  }

  private async refreshModelsIfStale(): Promise<void> {
    // Só recarrega se a cache em memória passou do TTL E ainda não temos raw.
    try {
      const idx = this.models.get();
      if (idx.size > 0) return;
      const raw = await readOpencodeFile("models");
      this.models.setRaw(raw);
    } catch {
      // mantém cache anterior (vazio)
    }
  }

  /**
   * Linhas agregadas (dia × provider × modelo × agente × diretório × sessão)
   * com mensagens a partir de `sinceMs` (inclusive). O filtro vai para o SQL,
   * então o tick de "hoje" só lê as mensagens de hoje.
   */
  private async queryAggRows(sinceMs: number, untilMs = Number.MAX_SAFE_INTEGER): Promise<AggRow[]> {
    const rows = await dbQuery(PERIOD_AGG_SQL, [Math.floor(sinceMs), Math.floor(untilMs)]);
    const out: AggRow[] = [];
    for (const r of asRows(rows)) {
      const dayMs = localDayToMs(str(r["day"]));
      if (dayMs === null) continue;
      const sessionId = str(r["session_id"]);
      out.push(
        rowToAggRow(
          {
            dayMs,
            providerId: str(r["provider_id"]),
            modelId: str(r["model_id"]),
            agent: str(r["agent"]),
            directory: str(r["directory"]),
            cost: num(r["cost"]),
            tokens: {
              input: num(r["tokens_input"]),
              output: num(r["tokens_output"]),
              reasoning: num(r["tokens_reasoning"]),
              cacheRead: num(r["tokens_cache_read"]),
              cacheWrite: num(r["tokens_cache_write"]),
            },
            messages: num(r["messages"]),
          },
          () => sessionId,
        ),
      );
    }
    return out;
  }

  /** Histórico do período SEM o dia de hoje (vai para o cache). */
  private async queryPeriod(period: PeriodKey, includeToday: boolean): Promise<AggRow[]> {
    const startMs = periodStartMs(period) ?? 0;
    const todayStartMs = todayStart().getTime();
    return includeToday
      ? this.queryAggRows(startMs)
      : startMs >= todayStartMs
        ? []
        : this.queryAggRows(startMs, todayStartMs);
  }

  /** Só o dia de hoje (reconsultado a cada tick). */
  private async queryToday(): Promise<AggRow[]> {
    return this.queryAggRows(todayStart().getTime());
  }

  private rowsForCurrentMonthCache: { rows: AggRow[]; fetchedAt: number } | null = null;
  private async rowsForCurrentMonth(): Promise<AggRow[]> {
    if (
      this.rowsForCurrentMonthCache &&
      Date.now() - this.rowsForCurrentMonthCache.fetchedAt < SESSION_TTL_MS * 6
    ) {
      return this.rowsForCurrentMonthCache.rows;
    }
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const out = await this.queryAggRows(start.getTime());
    this.rowsForCurrentMonthCache = { rows: out, fetchedAt: Date.now() };
    return out;
  }

  private async fetchCurrentSession(): Promise<{
    roots: SessionInfo[];
    byId: Map<string, SessionInfo>;
  }> {
    const now = Date.now();
    if (now - this.currentSessionCache.fetchedAt < SESSION_TTL_MS) {
      return this.currentSessionCache.tree;
    }
    // 1) Identifica a raiz (parent_id IS NULL, não-arquivada) cuja subárvore
    //    tem o maior `time_updated` considerando descendentes. Empates: todos.
    const rootsRows = await dbQuery(BEST_ROOT_SQL);
    const rootIds: string[] = [];
    for (const r of asRows(rootsRows)) {
      const id = str(r["root_id"]);
      if (id) rootIds.push(id);
    }
    if (rootIds.length === 0) {
      this.currentSessionCache = { tree: { roots: [], byId: new Map() }, fetchedAt: now };
      return this.currentSessionCache.tree;
    }

    // 2) Pega TODOS os descendentes (qualquer profundidade) dessas raízes.
    const subRows = await dbQuery(SESSION_TREE_SQL_PARAM(rootIds.length), rootIds);
    const sessions: SessionRawRow[] = [];
    for (const r of asRows(subRows)) {
      sessions.push(parseSessionRow(r));
    }
    // Carrega os self-aggregates (mensagens próprias de cada sessão).
    const ids = sessions.map((s) => s.id);
    const aggMap = await this.fetchSessionSelfAggregates(ids);
    for (const s of sessions) s.selfAggregate = aggMap.get(s.id) ?? emptyAggregate();

    const tree = buildSessionTree(sessions);
    // Mantém a ordem "última atividade primeiro" vinda do BEST_ROOT_SQL:
    // roots[0] é a sessão atual.
    const order = new Map(rootIds.map((id, i) => [id, i]));
    tree.roots.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    this.currentSessionCache = { tree, fetchedAt: now };
    return tree;
  }

  private async fetchSessionSelfAggregates(ids: string[]): Promise<Map<string, Aggregate>> {
    const out = new Map<string, Aggregate>();
    if (ids.length === 0) return out;
    // Chunk para não estourar limite de parâmetros.
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = SESSION_SELF_AGG_SQL_TEMPLATE(placeholders);
      const rows = await dbQuery(sql, chunk);
      const models = this.models.get();
      const referenceModel = this.referenceModel;
      // ctx é construído aqui para a sessão (mesma definição do snapshot).
      // Não usamos o billingCtx do snapshot porque ele pode ter sido cacheado
      // — em vez disso, recalculamos de forma rápida pois a inferência de
      // billing depende das settings e do models.json (ambos estáveis).
      const ctx: BillingContext | null | undefined = this._lastBillingCtx;
      // Uma linha por (sessão, provider, modelo): precificamos cada uma e somamos.
      for (const r of asRows(rows)) {
        const id = str(r["session_id"]);
        const tokens = {
          input: num(r["tokens_input"]),
          output: num(r["tokens_output"]),
          reasoning: num(r["tokens_reasoning"]),
          cacheRead: num(r["tokens_cache_read"]),
          cacheWrite: num(r["tokens_cache_write"]),
        };
        const recordedCost = num(r["cost"]);
        const price = priceFor(
          models,
          referenceModel,
          str(r["provider_id"]),
          str(r["model_id"]),
          tokens,
          recordedCost,
          ctx,
        );
        const part: Aggregate = {
          cost: price.cost,
          apiEquivalentCost: price.api,
          referenceCost: price.ref,
          recordedCost: price.recorded,
          tokens,
          messages: num(r["messages"]),
          sessions: 1,
        };
        const prev = out.get(id);
        out.set(id, prev ? { ...addAggregate(prev, part), sessions: 1 } : part);
      }
    }
    return out;
  }

  private filterRootsByPeriod(roots: SessionInfo[], period: PeriodKey): SessionInfo[] {
    if (period === "all") return roots;
    const startMs = periodStartMs(period) ?? Number.NEGATIVE_INFINITY;
    function touchesPeriod(node: SessionInfo): boolean {
      if (node.timeUpdated >= startMs) return true;
      return (node.children ?? []).some(touchesPeriod);
    }
    return roots.filter(touchesPeriod);
  }
}

// ----- Helpers -----

/** Helper local: `aggregateRows` reaproveitado para a projeção do mês. */
function aggregateRowsBare(rows: AggRow[], ctx: BillingContext): Aggregate {
  let cost = 0;
  let api = 0;
  let ref = 0;
  let recorded = 0;
  let messages = 0;
  const tokens = {
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  };
  let priceMissing = false;
  const sessionIds = new Set<string>();
  for (const r of rows) {
    const c = rowBillableCost(r, ctx);
    cost += c.cost;
    api += c.api;
    ref += c.ref;
    recorded += c.recorded;
    messages += r.messages;
    tokens.input += r.tokens.input;
    tokens.output += r.tokens.output;
    tokens.reasoning += r.tokens.reasoning;
    tokens.cacheRead += r.tokens.cacheRead;
    tokens.cacheWrite += r.tokens.cacheWrite;
    for (const sid of r.sessions) sessionIds.add(sid);
    if (c.priceMissing) priceMissing = true;
  }
  return {
    cost, apiEquivalentCost: api, referenceCost: ref, recordedCost: recorded,
    tokens, messages, sessions: sessionIds.size, priceMissing,
  } as Aggregate;
}

/**
 * Resumo de assinaturas: pega só provedores com `billing === "subscription"`
 * que tiveram uso no mês OU mensalidade definida, e calcula `multiple` (quanto
 * o uso vale em pay-as-you-go ÷ mensalidade).
 */
function buildSubscriptionsSummary(providers: import("./types").ProviderInfo[]): SubscriptionsSummary {
  const items: import("./types").SubscriptionValue[] = [];
  let monthlyTotalUsd = 0;
  let apiEquivalentMonthUsd = 0;
  for (const p of providers) {
    if (p.billing !== "subscription") continue;
    const hasUsage = (p.monthAggregate.messages ?? 0) > 0 ||
      (p.monthAggregate.tokens.input ?? 0) > 0 ||
      (p.monthAggregate.tokens.output ?? 0) > 0 ||
      (p.monthAggregate.tokens.reasoning ?? 0) > 0;
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

function pickCurrentSessionRoot(
  roots: SessionInfo[],
): SessionInfo | null {
  if (roots.length === 0) return null;
  // Já filtramos no `fetchCurrentSession` para a raiz com maior last_upd
  // descendente — pegamos o primeiro.
  return roots[0] ?? null;
}

function parseSessionRow(r: Record<string, unknown>): SessionRawRow {
  const id = str(r["id"]);
  const title = str(r["title"]);
  const agent = str(r["agent"]);
  const directory = normalizeDir(str(r["directory"]));
  const parentIdRaw = r["parent_id"];
  const parentId = typeof parentIdRaw === "string" && parentIdRaw.length > 0 ? parentIdRaw : null;
  const timeCreated = num(r["time_created"]);
  const timeUpdated = num(r["time_updated"]);
  const archivedRaw = r["time_archived"];
  const archived =
    typeof archivedRaw === "number" ? archivedRaw > 0 :
    typeof archivedRaw === "string" ? parseFloat(archivedRaw) > 0 :
    false;

  const { providerId, modelId } = parseModelColumn(r["model"]);

  return {
    id,
    title,
    agent,
    providerId,
    modelId,
    directory,
    parentId,
    timeCreated,
    timeUpdated,
    archived,
    selfAggregate: emptyAggregate(), // preenchido depois
  };
}

function parseModelColumn(raw: unknown): { providerId: string; modelId: string } {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return { providerId: "", modelId: "" };
  try {
    const parsed = JSON.parse(s) as { id?: string; providerID?: string };
    return {
      providerId: typeof parsed.providerID === "string" ? parsed.providerID : "",
      modelId: typeof parsed.id === "string" ? parsed.id : "",
    };
  } catch {
    // Pode vir como "provider/model".
    const idx = s.indexOf("/");
    if (idx > 0) return { providerId: s.slice(0, idx), modelId: s.slice(idx + 1) };
    return { providerId: "", modelId: s };
  }
}

// ----- SQL -----

/**
 * Agrega por (dia local, provider, model, agent, directory, session) a partir
 * de `message`. Retorna também o session_id para podermos contar sessões
 * distintas por linha. Usamos `GROUP BY` no nível (date, provider, model,
 * agent, directory, session) — o que é suficiente para reconstruir tudo no TS.
 */
const PERIOD_AGG_SQL = `
SELECT
  date(m.time_created/1000, 'unixepoch', 'localtime') AS day,
  json_extract(m.data, '$.providerID') AS provider_id,
  json_extract(m.data, '$.modelID') AS model_id,
  json_extract(m.data, '$.agent') AS agent,
  s.directory AS directory,
  m.session_id AS session_id,
  SUM(COALESCE(json_extract(m.data, '$.cost'), 0)) AS cost,
  SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0)) AS tokens_input,
  SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0)) AS tokens_output,
  SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0)) AS tokens_reasoning,
  SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0)) AS tokens_cache_read,
  SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0)) AS tokens_cache_write,
  COUNT(*) AS messages
FROM message m
JOIN session s ON s.id = m.session_id
WHERE m.time_created >= ?1 AND m.time_created < ?2
  AND json_extract(m.data, '$.role') = 'assistant'
GROUP BY day, provider_id, model_id, agent, directory, m.session_id
`;

/**
 * 1) Raízes (parent_id IS NULL, não arquivadas) ordenadas pela última
 *    atividade da subárvore inteira (a raiz ou qualquer descendente).
 *    A primeira é a "sessão atual". O CTE carrega o id do NÓ (`id`) além da
 *    raiz: descer por `s.parent_id = t.id` termina quando acabam os filhos.
 *    (A versão antiga descia por `parent_id = root_id` e entrava em loop
 *    infinito, porque os mesmos filhos eram reencontrados a cada iteração.)
 */
const BEST_ROOT_SQL = `
WITH RECURSIVE tree(root_id, id, time_updated, depth) AS (
    SELECT id, id, time_updated, 0
      FROM session
      WHERE parent_id IS NULL AND COALESCE(time_archived, 0) = 0
    UNION ALL
    SELECT t.root_id, s.id, s.time_updated, t.depth + 1
      FROM session s JOIN tree t ON s.parent_id = t.id
      WHERE t.depth < 50
)
SELECT root_id, MAX(time_updated) AS last_upd
  FROM tree
 GROUP BY root_id
 ORDER BY last_upd DESC
 LIMIT 300
`;

/**
 * 2) Carrega TODOS os descendentes (qualquer profundidade) de uma lista de raízes.
 */
function SESSION_TREE_SQL_PARAM(n: number): string {
  if (n === 0) return "SELECT * FROM session WHERE 1=0";
  const placeholders = Array.from({ length: n }, () => "?").join(",");
  return `
WITH RECURSIVE walk(id, depth) AS (
    SELECT id, 0 FROM session WHERE id IN (${placeholders})
    UNION ALL
    SELECT s.id, w.depth + 1 FROM session s JOIN walk w ON s.parent_id = w.id
     WHERE w.depth < 50
)
SELECT s.* FROM session s WHERE s.id IN (SELECT id FROM walk) ORDER BY s.time_created
`;
}

function SESSION_SELF_AGG_SQL_TEMPLATE(placeholders: string): string {
  return `
SELECT
  m.session_id,
  json_extract(m.data, '$.providerID') AS provider_id,
  json_extract(m.data, '$.modelID') AS model_id,
  SUM(COALESCE(json_extract(m.data, '$.cost'), 0)) AS cost,
  SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0)) AS tokens_input,
  SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0)) AS tokens_output,
  SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0)) AS tokens_reasoning,
  SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0)) AS tokens_cache_read,
  SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0)) AS tokens_cache_write,
  COUNT(*) AS messages
FROM message m
WHERE json_extract(m.data, '$.role') = 'assistant'
  AND m.session_id IN (${placeholders})
GROUP BY m.session_id, provider_id, model_id
`;
}

// Re-exporta para testes.
export {
  SESSION_TREE_SQL_PARAM,
  BEST_ROOT_SQL,
  PERIOD_AGG_SQL,
};