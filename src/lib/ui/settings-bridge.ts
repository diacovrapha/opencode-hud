/**
 * Bridge entre a UI e a camada `src/lib/data/settings`.
 *
 * Re-exporta `useSettings` e `runBudgetWatcher` vindos do módulo real
 * (`@/lib/data/settings`) para que a UI não precise conhecer o caminho
 * interno. No navegador (vite dev, sem Tauri), o módulo real funciona
 * normalmente — `loadSettings`/`saveSettings` são silenciosamente
 * ignorados quando o plugin Store não está disponível, e as notificações
 * também são no-op.
 *
 * O `runBudgetWatcher()` aqui é o watcher "auto": a UI chama sem args
 * uma vez e ele se vira para ler o snapshot+settings e disparar
 * notificações quando cruzar 80%/100%. Idempotente.
 */
import {
  runBudgetWatcher as _run,
  useSettings as _useSettingsRaw,
} from "@/lib/data/settings";
import { useShallow } from "zustand/react/shallow";
import { useSnapshotStore } from "@/lib/data";
import type { Settings } from "@/lib/data/types";

// Garante que as configurações persistidas (settings.json) sejam lidas
// antes do primeiro render de qualquer componente que dependa de `useSettings`.
// Idempotente — `hydrate` em si já tem guarda interna.
void _useSettingsRaw.getState().hydrate();

/** Hook: devolve `{ settings, update }`. */
export function useSettings(): {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
} {
  return _useSettingsRaw(
    useShallow((s) => ({ settings: s.settings, update: s.update })),
  );
}

let _watcherCleanup: (() => void) | null = null;
/**
 * Liga o watcher de orçamento. Idempotente. Devolve função de cleanup.
 * O watcher reage a mudanças em `snapshot` e `settings` (via subscrições).
 */
export function runBudgetWatcher(): () => void {
  if (_watcherCleanup) return _watcherCleanup;
  let lastDaily = NaN;
  let lastMonthly = NaN;
  let lastBudgetKey = "";
  let lastRateKey = "";

  const tick = (): void => {
    const s = useSnapshotStore.getState().snapshot;
    if (!s) return;
    const daily = s.today.cost; // USD
    const monthly = s.projection.monthCost; // USD (estimado pelo budget)
    const budget = s.budget;
    const rateKey = s.usdBrl ? `${s.usdBrl.rate}` : "";
    const budgetKey = `${budget.currency}|${budget.daily ?? ""}|${budget.monthly ?? ""}`;
    // Re-avalia só se algo mudou de fato (evita spam).
    if (
      daily === lastDaily &&
      monthly === lastMonthly &&
      budgetKey === lastBudgetKey &&
      rateKey === lastRateKey
    ) {
      return;
    }
    lastDaily = daily;
    lastMonthly = monthly;
    lastBudgetKey = budgetKey;
    lastRateKey = rateKey;
    void _run(daily, monthly, budget, s.usdBrl);
  };

  // Tick inicial + subscrição no store.
  tick();
  const unsubSnap = useSnapshotStore.subscribe(tick);
  const unsubSet = _useSettingsRaw.subscribe(tick);

  _watcherCleanup = (): void => {
    unsubSnap();
    unsubSet();
    _watcherCleanup = null;
  };
  return _watcherCleanup;
}

export type { Settings };