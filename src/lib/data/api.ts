import { invoke } from "@tauri-apps/api/core";
import type {
  Aggregate,
  Breakdown,
  DailyPoint,
  PeriodKey,
  SessionInfo,
  Settings,
  Snapshot,
  TokenSet,
} from "./types";

/**
 * Wrappers tipados em torno dos comandos Rust expostos pela janela Tauri.
 * A UI nunca deve chamar `invoke` diretamente: sempre passar por aqui.
 */

export type DbRow = Record<string, string | number | boolean | null>;

/** Executa SELECT/WITH no `opencode.db` (somente leitura). */
export async function dbQuery(
  sql: string,
  params: unknown[] = [],
): Promise<DbRow[]> {
  return invoke<DbRow[]>("db_query", { sql, params });
}

/** Lê um arquivo de configuração do opencode pelo "kind". */
export async function readOpencodeFile(kind: "models" | "config" | "agents"): Promise<string> {
  return invoke<string>("read_opencode_file", { kind });
}

/** Retorna `true` se o processo do opencode estiver em execução. */
export async function opencodeRunning(): Promise<boolean> {
  return invoke<boolean>("opencode_running");
}

/** Status estruturado: combina `running` (processo detectado) e `recent`
 *  (houve atividade nos últimos ~2 min). A UI pode mostrar "parado" só
 *  quando ambos forem falsos. */
export type OpencodeStatus = {
  running: boolean;
  recent: boolean;
};

export async function opencodeStatus(): Promise<OpencodeStatus> {
  return invoke<OpencodeStatus>("opencode_status_cmd");
}

/** Retorna metadados sobre o banco do opencode. */
export type DbPathInfo = {
  path: string;
  exists: boolean;
  size: number;
  modified: string | null;
};

export async function dbPathInfo(): Promise<DbPathInfo> {
  return invoke<DbPathInfo>("db_path_info");
}

/**
 * Interface que toda fonte de dados deve implementar.
 * Por enquanto só temos `MockDataSource`; em uma próxima tarefa
 * trocaremos pela implementação que consome `dbQuery`/`readOpencodeFile`.
 */
export interface DataSource {
  getSnapshot(period: PeriodKey): Promise<Snapshot>;
  getSettings?(): Promise<Settings>;
  saveSettings?(settings: Settings): Promise<void>;
}

// Reaproveita os tipos aqui para deixar o import mais ergonômico na UI.
export type {
  Aggregate,
  Breakdown,
  DailyPoint,
  PeriodKey,
  SessionInfo,
  Settings,
  Snapshot,
  TokenSet,
};