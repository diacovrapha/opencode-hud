import * as React from "react";
import { useSnapshotStore, startPolling, stopPolling, DEFAULT_SETTINGS } from "@/lib/data";
import { opencodeRunning } from "@/lib/data/api";
import { Activity, DollarSign } from "lucide-react";

/**
 * Janela compacta (340x120) que mostra um resumo do estado atual.
 * Deve ficar arrastável via `data-tauri-drag-region`.
 */
export function Widget(): React.JSX.Element {
  const { snapshot, refresh, loading } = useSnapshotStore();
  const [running, setRunning] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    startPolling(refresh, DEFAULT_SETTINGS.refreshSeconds);
    return () => stopPolling();
  }, [refresh]);

  React.useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await opencodeRunning();
        if (!cancelled) setRunning(r);
      } catch {
        if (!cancelled) setRunning(null);
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const totalCost = snapshot?.totals.cost ?? 0;
  const totalSessions = snapshot?.totals.sessions ?? 0;
  const todayCost = snapshot?.today.cost ?? 0;
  const live = running ?? snapshot?.opencodeRunning ?? false;

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-full flex-col justify-between rounded-xl border border-white/5 bg-gradient-to-br from-slate-950/90 to-violet-950/70 p-3 text-foreground shadow-2xl"
    >
      <div
        data-tauri-drag-region
        className="flex items-center justify-between text-[11px] uppercase tracking-wider"
      >
        <span data-tauri-drag-region className="flex items-center gap-1.5 text-muted-foreground">
          <Activity className={`h-3 w-3 ${live ? "text-emerald-400" : "text-red-400"}`} />
          {live ? "opencode" : "parado"}
        </span>
        <span data-tauri-drag-region className="text-muted-foreground">
          {loading ? "..." : snapshot?.period ?? ""}
        </span>
      </div>

      <div
        data-tauri-drag-region
        className="grid grid-cols-2 items-end gap-3"
      >
        <div data-tauri-drag-region>
          <div data-tauri-drag-region className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <DollarSign className="h-3 w-3" /> custo total
          </div>
          <div data-tauri-drag-region className="font-mono text-2xl leading-none">
            ${totalCost.toFixed(3)}
          </div>
        </div>
        <div data-tauri-drag-region>
          <div data-tauri-drag-region className="text-[11px] text-muted-foreground">hoje</div>
          <div data-tauri-drag-region className="font-mono text-lg leading-none">
            ${todayCost.toFixed(3)}
          </div>
        </div>
      </div>

      <div
        data-tauri-drag-region
        className="flex items-center justify-between text-[11px] text-muted-foreground"
      >
        <span data-tauri-drag-region>{totalSessions} sessões</span>
        <span data-tauri-drag-region>{snapshot?.usdBrl ? `R$ ${snapshot.usdBrl.rate.toFixed(2)}` : "—"}</span>
      </div>
    </div>
  );
}