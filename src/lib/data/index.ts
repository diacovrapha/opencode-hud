import { create } from "zustand";
import type { PeriodKey, Settings, Snapshot } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { MockDataSource } from "./mock";
import type { DataSource } from "./api";

// Por enquanto só o mock está ativo. Trocaremos para `LiveDataSource`
// (que usa dbQuery/readOpencodeFile) em uma próxima tarefa.
const activeSource: DataSource = new MockDataSource();

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
      set({ error: String(err), loading: false });
    }
  },
  setPeriod: (period) => {
    set({ period });
    void get().refresh();
  },
}));

/** Hook que dispara polling automático baseado em `settings.refreshSeconds`. */
export function useSnapshot(period?: PeriodKey): SnapshotState {
  const state = useSnapshotStore();
  const periodFromArg = period;

  if (periodFromArg && periodFromArg !== state.period) {
    state.setPeriod(periodFromArg);
  }

  // Polling controlado por efeito no componente; aqui só expomos o estado.
  // O componente precisa chamar `state.refresh()` em useEffect.
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