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
  cost: number;
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
};

export type Settings = {
  budgetDaily?: number;
  budgetMonthly?: number;
  currency: "BRL" | "USD";
  referenceModel: string;
  refreshSeconds: number;
  autostart: boolean;
  widgetExpanded: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  currency: "BRL",
  referenceModel: "anthropic/claude-sonnet-5-5",
  refreshSeconds: 5,
  autostart: true,
  widgetExpanded: false,
};