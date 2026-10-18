// Tipos compartilhados entre a camada nativa (Rust) e a UI (React/TS).
// Estes tipos descrevem o "contrato" consumido pelo resto do app.
// A lógica que produz esses dados virá em tarefas seguintes; aqui só
// estabelecemos a forma.

export type TokenSet = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export type Aggregate = {
  /**
   * Gasto real VARIÁVEL (USD): só o que é cobrado por token. Mensagens de
   * provedores marcados como "assinatura" ou "gratuito/local" contam 0 aqui,
   * mesmo que o opencode tenha registrado um custo (ex.: Copilot, Claude Max).
   * Mensalidades de assinaturas ficam em `Snapshot.subscriptions`.
   */
  cost: number;
  /** O que o opencode registrou, sem aplicar o tipo de cobrança (USD). */
  recordedCost?: number;
  apiEquivalentCost: number;
  referenceCost: number;
  tokens: TokenSet;
  messages: number;
  sessions: number;
};

export type PeriodKey = "today" | "7d" | "30d" | "month" | "all";

export type Breakdown = {
  key: string;
  label: string;
  aggregate: Aggregate;
  /** Quando o preço do modelo/grupo não pôde ser calculado, marca `true`. */
  priceMissing?: boolean;
  /** Caminho (ou label extra) usado para agrupar por projeto. */
  path?: string;
};

export type DailyPoint = {
  /** ISO date "YYYY-MM-DD" no fuso local do usuário */
  date: string;
  aggregate: Aggregate;
};

export type SessionInfo = {
  id: string;
  title: string;
  agent: string;
  model: string;
  providerId: string;
  directory: string;
  parentId: string | null;
  timeCreated: number;
  timeUpdated: number;
  aggregate: Aggregate;
  children?: SessionInfo[];
};

export type UsdBrlRate = {
  rate: number;
  /** ISO 8601 */
  updatedAt: string;
};

export type AgentConfig = {
  name: string;
  model: string;
  mode: "subagent" | "primary";
};

export type Budget = {
  daily?: number;
  monthly?: number;
  currency: "BRL" | "USD";
};

export type Projection = {
  monthCost: number;
};

// ---------- v2: provedores, assinaturas e referência ----------

/** Como o usuário paga por um provedor. */
export type BillingType = "api" | "subscription" | "free";

/** Configuração do usuário para um provedor (Settings.providers[providerId]). */
export type ProviderSetting = {
  billing: BillingType;
  /** Mensalidade, quando billing = "subscription". */
  monthlyFee?: number;
  /** Moeda da mensalidade. */
  feeCurrency?: "BRL" | "USD";
};

/** Preço manual (USD por 1M de tokens), para modelos sem preço ou locais. */
export type CustomPrice = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/** Provedor detectado no uso, com a configuração efetiva aplicada. */
export type ProviderInfo = {
  /** Ex.: "minimax-coding-plan", "anthropic", "github-copilot". */
  id: string;
  /** Nome legível (do models.json; senão o próprio id). Ex.: "MiniMax Coding Plan". */
  label: string;
  /** Tipo de cobrança efetivo (configurado pelo usuário ou inferido). */
  billing: BillingType;
  /** true = o usuário ainda não confirmou; o valor veio do palpite automático. */
  inferred: boolean;
  /** Mensalidade em USD (já convertida), se for assinatura com valor definido. */
  monthlyFeeUsd?: number;
  /** Modelos usados neste provedor (ids sem o prefixo do provedor). */
  models: string[];
  /** Uso no mês corrente. */
  monthAggregate: Aggregate;
  /** Uso em todo o histórico. */
  allTimeAggregate: Aggregate;
  /** Último uso (epoch ms). */
  lastUsed: number;
};

/** "Sua assinatura vale a pena?" — por provedor de assinatura, mês corrente. */
export type SubscriptionValue = {
  providerId: string;
  label: string;
  /** Mensalidade em USD (undefined se o usuário não informou). */
  monthlyFeeUsd?: number;
  /** Quanto o uso deste mês custaria pagando por token (USD). */
  apiEquivalentMonthUsd: number;
  /** apiEquivalentMonthUsd / monthlyFeeUsd (undefined sem mensalidade). */
  multiple?: number;
};

export type SubscriptionsSummary = {
  /** Soma das mensalidades conhecidas (USD/mês). */
  monthlyTotalUsd: number;
  /** Quanto o uso de assinaturas neste mês custaria por token (USD). */
  apiEquivalentMonthUsd: number;
  items: SubscriptionValue[];
};

/** Modelo de referência efetivamente usado nas comparações. */
export type ResolvedReference = {
  /** "provider/model". */
  model: string;
  /** Nome curto para exibir (ex.: "claude-sonnet-5-5"). */
  label: string;
  mode: "auto" | "manual";
  /** De onde veio no modo auto (ex.: "agente principal: chefe"). */
  source?: string;
  /** true se não há preço para esse modelo (comparação fica indisponível). */
  priceMissing?: boolean;
};

/** Item do catálogo de modelos (para busca nas Configurações). */
export type CatalogModel = {
  /** "provider/model". */
  key: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  name: string;
  /** USD por 1M tokens (input/output), quando conhecido. */
  input?: number;
  output?: number;
  /** O usuário já usou este modelo? */
  used: boolean;
};

export type Snapshot = {
  /** ISO 8601 */
  generatedAt: string;
  opencodeRunning: boolean;
  usdBrl: UsdBrlRate | null;
  period: PeriodKey;
  totals: Aggregate;
  today: Aggregate;
  currentSession: SessionInfo | null;
  byModel: Breakdown[];
  byAgent: Breakdown[];
  byProject: Breakdown[];
  daily: DailyPoint[];
  sessions: SessionInfo[];
  agentsConfig: AgentConfig[];
  budget: Budget;
  projection: Projection;
  /** v2: provedores detectados no uso (ordenados por último uso). */
  providers?: ProviderInfo[];
  /** v2: mensalidades e "vale a pena?" das assinaturas. */
  subscriptions?: SubscriptionsSummary;
  /** v2: modelo de referência efetivo. */
  reference?: ResolvedReference;
  /** Mensagem amigável quando não foi possível gerar dados (ex.: db ausente). */
  error?: string;
};

export type Settings = {
  budgetDaily?: number;
  budgetMonthly?: number;
  currency: "BRL" | "USD";
  /**
   * Modelo de referência manual ("provider/model"). Só é usado quando
   * referenceMode = "manual".
   */
  referenceModel: string;
  /** v2: "auto" = modelo do agente principal do opencode. */
  referenceMode: "auto" | "manual";
  /** v2: configuração por provedor (chave = providerId). */
  providers: Record<string, ProviderSetting>;
  /** v2: preços manuais por modelo (chave = "provider/model"). */
  customPrices: Record<string, CustomPrice>;
  refreshSeconds: number;
  autostart: boolean;
  widgetExpanded: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  currency: "BRL",
  referenceModel: "anthropic/claude-sonnet-5-5",
  referenceMode: "auto",
  providers: {},
  customPrices: {},
  refreshSeconds: 5,
  autostart: true,
  widgetExpanded: false,
};