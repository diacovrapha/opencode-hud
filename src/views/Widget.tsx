import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Coins,
  Cpu,
  ExternalLink,
  EyeOff,
  Layers,
  Sparkles,
  Timer,
} from "lucide-react";
import {
  useSnapshotStore,
  startPolling,
  stopPolling,
} from "@/lib/data";
import { useSettings, runBudgetWatcher } from "@/lib/ui/settings-bridge";
import { opencodeRunning } from "@/lib/data/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MetricTooltip } from "@/components/hud/MetricTooltip";
import { BudgetBar } from "@/components/hud/BudgetBar";
import { Money } from "@/components/hud/Money";
import { TokenCount } from "@/components/hud/TokenCount";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";

const COMPACT_W = 340;
const COMPACT_H = 120;
const EXPANDED_W = 340;
const EXPANDED_H = 460;

export function Widget(): React.JSX.Element {
  // Garante html/body transparentes para esta janela.
  React.useEffect(() => {
    document.documentElement.classList.add("transparent-window");
    return () => document.documentElement.classList.remove("transparent-window");
  }, []);

  const { snapshot, refresh, period } = useSnapshotStore();
  const { settings, update } = useSettings();
  const [running, setRunning] = React.useState<boolean | null>(null);
  const [hover, setHover] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  // Carrega preferência expandida do settings (com fallback).
  React.useEffect(() => {
    setExpanded(settings.widgetExpanded);
  }, [settings.widgetExpanded]);

  // Ativa o watcher de orçamento uma vez ao montar.
  React.useEffect(() => {
    const cleanup = runBudgetWatcher();
    return cleanup;
  }, []);

  // Polling.
  React.useEffect(() => {
    startPolling(refresh, settings.refreshSeconds);
    return () => stopPolling();
  }, [refresh, settings.refreshSeconds]);

  // Detecta o status do opencode.
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

  // Redimensiona a janela quando expandir/recolher.
  React.useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const win = getCurrentWindow();
        if (expanded) {
          await win.setSize(new LogicalSize(EXPANDED_W, EXPANDED_H));
        } else {
          await win.setSize(new LogicalSize(COMPACT_W, COMPACT_H));
        }
        if (!cancelled) {
          update({ widgetExpanded: expanded });
        }
      } catch (e) {
        // Em ambiente de browser (vite dev), getCurrentWindow/setSize pode falhar.
        console.warn("widget resize:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, update]);

  const live = running ?? snapshot?.opencodeRunning ?? false;
  const fmt: MoneyFmt = {
    primary: settings.currency,
    usdBrlRate: snapshot?.usdBrl?.rate ?? null,
    rateUpdatedAt: snapshot?.usdBrl?.updatedAt,
  };

  const todayCost = snapshot?.today.cost ?? 0;
  const todayTokens =
    (snapshot?.today.tokens.input ?? 0) +
    (snapshot?.today.tokens.output ?? 0) +
    (snapshot?.today.tokens.reasoning ?? 0) +
    (snapshot?.today.tokens.cacheRead ?? 0) +
    (snapshot?.today.tokens.cacheWrite ?? 0);
  const sessionCost = snapshot?.currentSession?.aggregate.cost ?? 0;
  const sessionTokens =
    snapshot?.currentSession
      ? sumTokens(snapshot.currentSession.aggregate.tokens)
      : 0;

  const dailyLimit = settings.budgetDaily ?? snapshot?.budget.daily ?? 0;
  const dailyUsd = settings.currency === "BRL" && fmt.usdBrlRate
    ? todayCost
    : todayCost;
  // Para a barra, usamos USD (que é o que `dailyLimit` em BRL precisa ser convertido).
  const dailyLimitUsd = settings.currency === "BRL" && fmt.usdBrlRate
    ? dailyLimit / fmt.usdBrlRate
    : dailyLimit;

  const onOpenDashboard = async (): Promise<void> => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      // Tenta achar/mostrar a janela dashboard.
      const win = (await WebviewWindow.getByLabel?.("dashboard")) ?? null;
      if (win) {
        await win.show();
        await win.setFocus();
      } else {
        const w = new WebviewWindow("dashboard", {
          url: "index.html#/dashboard",
        });
        await w.show();
      }
    } catch (e) {
      console.warn("open dashboard:", e);
    }
  };

  const onHide = async (): Promise<void> => {
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      console.warn("hide widget:", e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "glass-widget relative h-full w-full overflow-hidden",
        expanded ? "rounded-2xl" : "rounded-xl",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Botões no hover */}
      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-2 top-2 z-10 flex items-center gap-1"
          >
            <IconBtn
              label={expanded ? "Recolher" : "Expandir"}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((x) => !x);
              }}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </IconBtn>
            <IconBtn label="Abrir dashboard" onClick={(e) => { e.stopPropagation(); void onOpenDashboard(); }}>
              <ExternalLink className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn label="Ocultar" onClick={(e) => { e.stopPropagation(); void onHide(); }}>
              <EyeOff className="h-3.5 w-3.5" />
            </IconBtn>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toda a área central é arrastável. Os botões têm stopPropagation. */}
      <AnimatePresence mode="wait">
        {!expanded ? (
          <motion.div
            key="compact"
            data-tauri-drag-region
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex h-full w-full flex-col gap-2 p-3"
          >
            <div
              data-tauri-drag-region
              className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              <span data-tauri-drag-region className="flex items-center gap-1.5">
                <span
                  data-tauri-drag-region
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    live ? "bg-emerald-400 pulse-dot" : "bg-red-400",
                  )}
                />
                {live ? "opencode ativo" : "parado"}
              </span>
              <span data-tauri-drag-region className="opacity-70">
                {periodLabel(period)}
              </span>
            </div>

            <div data-tauri-drag-region className="flex items-end justify-between">
              <div data-tauri-drag-region>
                <MetricTooltip
                  label={
                    <span className="text-[11px] text-muted-foreground">
                      Hoje
                    </span>
                  }
                  content="Custo total das sessões iniciadas hoje. Modelos de assinatura (como o MiniMax Coding Plan) aparecem como R$ 0."
                />
                <div data-tauri-drag-region className="text-2xl font-semibold leading-none">
                  <Money usd={todayCost} fmt={fmt} size="xl" tone="gradient" />
                </div>
              </div>
              <div data-tauri-drag-region className="text-right">
                <MetricTooltip
                  label={
                    <span className="text-[11px] text-muted-foreground">
                      USD/BRL
                    </span>
                  }
                  content={
                    fmt.usdBrlRate
                      ? `Cotação usada: R$ ${fmt.usdBrlRate.toFixed(2)} por dólar.`
                      : "Cotação indisponível."
                  }
                />
                <div data-tauri-drag-region className="text-sm tabular">
                  {fmt.usdBrlRate ? `R$ ${fmt.usdBrlRate.toFixed(2)}` : "—"}
                </div>
              </div>
            </div>

            {dailyLimit > 0 ? (
              <div data-tauri-drag-region>
                <BudgetBar value={dailyUsd} limit={dailyLimitUsd} />
                <div
                  data-tauri-drag-region
                  className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground"
                >
                  <span>
                    {fmt.primary} {dailyLimit.toFixed(0)} / dia
                  </span>
                  <span>
                    {fmt.usdBrlRate
                      ? `R$ ${(todayCost * fmt.usdBrlRate).toFixed(2)}`
                      : `$${todayCost.toFixed(2)}`}
                  </span>
                </div>
              </div>
            ) : (
              <a
                href="#/settings"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onOpenDashboard();
                }}
                className="text-[11px] text-violet-300 underline-offset-2 hover:underline"
              >
                definir orçamento →
              </a>
            )}

            <div
              data-tauri-drag-region
              className="flex items-center justify-between text-[10px] text-muted-foreground"
            >
              <span data-tauri-drag-region className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                <TokenCount n={todayTokens} short /> hoje
              </span>
              {snapshot?.currentSession && (
                <span data-tauri-drag-region className="flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  sessão: <Money usd={sessionCost} fmt={fmt} size="xs" hideSecondary />
                </span>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            data-tauri-drag-region
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex h-full w-full flex-col"
          >
            <div
              data-tauri-drag-region
              className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              <span data-tauri-drag-region className="flex items-center gap-1.5">
                <span
                  data-tauri-drag-region
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    live ? "bg-emerald-400 pulse-dot" : "bg-red-400",
                  )}
                />
                {live ? "opencode ativo" : "parado"}
              </span>
              <span data-tauri-drag-region className="opacity-70">
                {periodLabel(period)}
              </span>
            </div>

            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3">
                  {/* Hoje */}
                  <section>
                    <MetricTooltip
                      label={
                        <span className="text-[11px] text-muted-foreground">
                          Hoje
                        </span>
                      }
                      content="Soma de todas as sessões iniciadas hoje."
                    />
                    <div className="text-2xl font-semibold leading-none">
                      <Money usd={todayCost} fmt={fmt} size="xl" tone="gradient" />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        <TokenCount n={todayTokens} short />
                      </span>
                      <span>·</span>
                      <span>{snapshot?.today.sessions ?? 0} sessões</span>
                    </div>
                  </section>

                  {/* Sessão atual */}
                  {snapshot?.currentSession && (
                    <section
                      data-tauri-drag-region
                      className="rounded-lg border border-white/5 bg-white/5 p-2"
                    >
                      <MetricTooltip
                        label={
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Sessão atual
                          </span>
                        }
                        content="Sessão que está em andamento."
                      />
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {snapshot.currentSession.title}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              {snapshot.currentSession.agent}
                            </span>
                            <span className="flex items-center gap-1">
                              <Cpu className="h-3 w-3" />
                              {snapshot.currentSession.model.split("/").pop()}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <Money usd={sessionCost} fmt={fmt} size="sm" hideSecondary />
                          <div className="text-[10px] text-muted-foreground tabular">
                            <TokenCount n={sessionTokens} short />
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Top 5 modelos */}
                  <section>
                    <div className="mb-1.5 flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5 text-violet-300" />
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Top modelos hoje
                      </h4>
                    </div>
                    <ul className="space-y-1.5">
                      {(snapshot?.byModel ?? []).slice(0, 5).map((b) => {
                        const pct =
                          todayCost > 0
                            ? (b.aggregate.cost / todayCost) * 100
                            : 0;
                        return (
                          <li key={b.key}>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="truncate">{b.label}</span>
                              <span className="tabular text-muted-foreground">
                                <Money
                                  usd={b.aggregate.cost}
                                  fmt={fmt}
                                  size="xs"
                                  hideSecondary
                                />
                              </span>
                            </div>
                            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                      {(snapshot?.byModel ?? []).length === 0 && (
                        <li className="text-[11px] text-muted-foreground">
                          Sem uso registrado.
                        </li>
                      )}
                    </ul>
                  </section>

                  {/* Top 5 agentes */}
                  <section>
                    <div className="mb-1.5 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-blue-300" />
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Top agentes hoje
                      </h4>
                    </div>
                    <ul className="space-y-1.5">
                      {(snapshot?.byAgent ?? []).slice(0, 5).map((b) => {
                        const pct =
                          todayCost > 0
                            ? (b.aggregate.cost / todayCost) * 100
                            : 0;
                        return (
                          <li key={b.key}>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="truncate">{b.label}</span>
                              <span className="tabular text-muted-foreground">
                                <Money
                                  usd={b.aggregate.cost}
                                  fmt={fmt}
                                  size="xs"
                                  hideSecondary
                                />
                              </span>
                            </div>
                            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                      {(snapshot?.byAgent ?? []).length === 0 && (
                        <li className="text-[11px] text-muted-foreground">
                          Sem uso registrado.
                        </li>
                      )}
                    </ul>
                  </section>

                  {/* Sessões recentes */}
                  <section>
                    <div className="mb-1.5 flex items-center gap-1">
                      <Activity className="h-3.5 w-3.5 text-amber-300" />
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Últimas sessões
                      </h4>
                    </div>
                    <ul className="space-y-1">
                      {(snapshot?.sessions ?? []).slice(0, 4).map((s) => (
                        <SessionLine key={s.id} session={s} fmt={fmt} />
                      ))}
                      {(snapshot?.sessions ?? []).length === 0 && (
                        <li className="text-[11px] text-muted-foreground">
                          Nenhuma sessão.
                        </li>
                      )}
                    </ul>
                  </section>
                </div>
              </ScrollArea>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={label}
          className="glass-button flex h-6 w-6 items-center justify-center text-foreground/90 hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="glass-strong text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SessionLine({
  session,
  fmt,
}: {
  session: SessionInfo;
  fmt: MoneyFmt;
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{session.title}</div>
        <div className="text-[10px] text-muted-foreground">
          {session.agent} · {session.model.split("/").pop()}
        </div>
      </div>
      <Money usd={session.aggregate.cost} fmt={fmt} size="xs" hideSecondary />
    </li>
  );
}

function sumTokens(t: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

function periodLabel(p: string): string {
  const labels: Record<string, string> = {
    today: "Hoje",
    "7d": "7d",
    "30d": "30d",
    month: "Mês",
    all: "Tudo",
  };
  return labels[p] ?? p;
}