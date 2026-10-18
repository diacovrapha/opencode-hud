import * as React from "react";
import { create } from "zustand";
import type { PeriodKey, Settings, Snapshot } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { MockDataSource } from "./mock";
import type { DataSource } from "./api";
import { RealDataSource } from "./real";

// Em dev no navegador (sem Tauri), caímos para o mock para a UI poder
// iterar sem o backend rodando. Em qualquer janela do app empacotado,
// `__TAURI_INTERNALS__` existe e o `RealDataSource` entra em ação.
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const activeSource: DataSource = inTauri ? new RealDataSource() : new MockDataSource();

export const dataSource = activeSource;

type SnapshotState = {
  period: PeriodKey;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setPeriod: (p: PeriodKey) => void;
};

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  period: "7d",
  snapshot: null,
  loading: false,
  error: null,
  refresh: async () => {
    const { period } = get();
    set({ loading: true, error: null });
    try {
      const snap = await dataSource.getSnapshot(period);
      set({ snapshot: snap, loading: false });
    } catch (err) {
      // Garante que loading é desmarcado mesmo se o snapshot for repopulado
      // com erro parcial (ex.: db ausente) — nesse caso `snap.error` será
      // exibido pela UI no banner amarelo.
      const msg = err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
      // eslint-disable-next-line no-console
      console.error("[useSnapshotStore] getSnapshot falhou:", msg, err);
      const current = get();
      const existing = current.snapshot;
      set({
        snapshot: existing
          ? { ...existing, error: msg }
          : null,
        error: msg,
        loading: false,
      });
    }
  },
  setPeriod: (period) => {
    set({ period });
    void get().refresh();
  },
}));

/**
 * Hook que devolve o estado do snapshot store e, opcionalmente, troca o
 * `period` reativo. Quando `period` muda, dispara um refresh imediatamente
 * para que o `useEffect` de polling dos componentes veja o novo valor já
 * no próximo ciclo (e o snapshot também).
 */
export function useSnapshot(period?: PeriodKey): SnapshotState {
  const state = useSnapshotStore();
  // Sincroniza o período em effect (não durante o render) para não violar
  // as regras do React e para que `state.period` mude antes do próximo
  // render.
  React.useEffect(() => {
    if (period && period !== state.period) {
      state.setPeriod(period);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);
  return state;
}

export type { Settings };
export { DEFAULT_SETTINGS };

/**
 * Helper para iniciar o polling num componente:
 *   useEffect(() => { startPolling(refresh); return stopPolling; }, [refresh]);
 */
let pollTimer: ReturnType<typeof setInterval> | null = null;
export function startPolling(refresh: () => Promise<void>, seconds: number): void {
  stopPolling();
  void refresh();
  pollTimer = setInterval(() => {
    void refresh();
  }, Math.max(1, seconds) * 1000);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Re-exporta o watcher de orçamento e helpers para a UI consumir.
export { runBudgetWatcher } from "./budget-watcher";
export { useSettings } from "./settings";