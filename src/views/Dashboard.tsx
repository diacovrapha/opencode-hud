import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import {
  useSnapshotStore,
  startPolling,
  stopPolling,
} from "@/lib/data";
import { useSettings } from "@/lib/ui/settings-bridge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar, type SidebarSection } from "@/components/hud/Sidebar";
import { PeriodFilter } from "@/components/hud/PeriodFilter";
import { PageSkeleton, EmptyState } from "@/components/hud/EmptyState";
import { TitleBar } from "@/views/TitleBar";
import { Overview } from "@/views/dashboard/Overview";
import { ModelsView } from "@/views/dashboard/Models";
import { AgentsView } from "@/views/dashboard/Agents";
import { ProjectsView } from "@/views/dashboard/Projects";
import { SessionsView } from "@/views/dashboard/Sessions";
import { SettingsView } from "@/views/dashboard/SettingsView";
import type { PeriodKey } from "@/lib/data/types";

export function Dashboard(): React.JSX.Element {
  const { snapshot, period, setPeriod, refresh, loading, error } = useSnapshotStore();
  const { settings, update } = useSettings();
  const [section, setSection] = React.useState<SidebarSection>("overview");
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    startPolling(refresh, settings.refreshSeconds);
    return () => stopPolling();
  }, [refresh, settings.refreshSeconds]);

  // Tick para "atualizado há Xs".
  React.useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const generatedAgo = React.useMemo(() => {
    if (!snapshot?.generatedAt) return null;
    const t = new Date(snapshot.generatedAt).getTime();
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min} min`;
  }, [snapshot?.generatedAt, tick]);

  const fmt = {
    primary: settings.currency,
    usdBrlRate: snapshot?.usdBrl?.rate ?? null,
    rateUpdatedAt: snapshot?.usdBrl?.updatedAt,
  };

  return (
    <div className="flex h-full flex-col bg-transparent text-foreground">
      <TitleBar title="opencode HUD" />

      <div className="flex items-center justify-between border-b border-white/5 bg-black/20 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          {snapshot?.opencodeRunning ? (
            <Badge className="border-emerald-400/30 bg-emerald-500/15 text-emerald-300">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
              opencode ativo
            </Badge>
          ) : (
            <Badge className="border-red-400/30 bg-red-500/15 text-red-300">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
              opencode parado
            </Badge>
          )}
          {generatedAgo && (
            <span className="text-xs text-muted-foreground">
              <Activity className="mr-1 inline-block h-3 w-3 align-middle" />
              atualizado há {generatedAgo}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => void refresh()}
            aria-label="Atualizar agora"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>
        <PeriodFilter
          value={period}
          onChange={(p: PeriodKey) => setPeriod(p)}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar active={section} onChange={setSection} />
        <main className="min-w-0 flex-1">
          <ScrollArea className="h-full">
            <div className="mx-auto w-full max-w-[1280px] p-5">
              {error && (
                <div className="glass mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-red-300" />
                  <div>
                    <div className="font-medium text-red-200">
                      Não foi possível carregar os dados
                    </div>
                    <div className="text-xs text-red-200/80">{error}</div>
                  </div>
                </div>
              )}

              {snapshot?.error && (
                <div className="glass mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
                  <div className="text-xs text-amber-200/90">
                    {snapshot.error}
                  </div>
                </div>
              )}

              {!snapshot && loading && <PageSkeleton />}

              {!snapshot && !loading && (
                <EmptyState
                  title="Sem dados ainda"
                  description="Aguardando primeira leitura do opencode."
                />
              )}

              {snapshot && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={section}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                  >
                    {section === "overview" && (
                      <Overview
                        snapshot={snapshot}
                        settings={settings}
                        fmt={fmt}
                        onJumpToSessions={() => setSection("sessions")}
                        onJumpToModels={() => setSection("models")}
                        onOpenSettings={() => setSection("settings")}
                      />
                    )}
                    {section === "models" && <ModelsView snapshot={snapshot} fmt={fmt} />}
                    {section === "agents" && <AgentsView snapshot={snapshot} fmt={fmt} />}
                    {section === "projects" && <ProjectsView snapshot={snapshot} fmt={fmt} />}
                    {section === "sessions" && <SessionsView snapshot={snapshot} fmt={fmt} />}
                    {section === "settings" && (
                      <SettingsView
                        settings={settings}
                        update={update}
                        snapshot={snapshot}
                        fmt={fmt}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}