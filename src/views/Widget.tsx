import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import {
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
import { formatBrlNumber } from "@/lib/ui/format";
import type { SessionInfo } from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";

// Tamanhos do widget (em DIPs). Devem casar com WIDGET_W/WIDGET_COMPACT_H/
// WIDGET_EXPANDED_H em src-tauri/src/lib.rs.
const COMPACT_W = 340;
const COMPACT_H = 158;
const EXPANDED_W = 340;
const EXPANDED_H = 460;

/** "true" só dentro do Tauri; fora do Tauri (vite dev/test) retorna false. */
function isInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function Widget(): React.JSX.Element {
  // Garante html/body transparentes para esta janela.
  React.useEffect(() => {
    document.documentElement.classList.add("transparent-window");
    return () => document.documentElement.classList.remove("transparent-window");
  }, []);

  const { snapshot, refresh } = useSnapshotStore();
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
    if (!isInTauri()) {
      // Fora do Tauri (vite dev), só persiste a preferência.
      void update({ widgetExpanded: expanded });
      return;
    }
    (async (): Promise<void> => {
      try {
        const win = getCurrentWindow();
        if (expanded) {
          await win.setSize(new PhysicalSize(EXPANDED_W, EXPANDED_H));
        } else {
          await win.setSize(new PhysicalSize(COMPACT_W, COMPACT_H));
        }
      } catch (e) {
        console.warn("widget resize:", e);
      }
      if (!cancelled) {
        await update({ widgetExpanded: expanded });
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
  const dailyLimitCurrency = settings.currency;
  // Para a barra, o widget sempre trata o valor gasto em USD (a unidade da app).
  const dailyUsd = todayCost;
  const dailyLimitUsd =
    dailyLimitCurrency === "BRL" && fmt.usdBrlRate
      ? dailyLimit / fmt.usdBrlRate
      : dailyLimit;

  const onOpenDashboard = async (): Promise<void> => {
    if (!isInTauri()) return;
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
    if (!isInTauri()) return;
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      console.warn("hide widget:", e);
    }
  };

  // Texto curto da cotação, em pt-BR (ex.: "R$ 5,06"). Sem valor → "—".
  const rateLabel = fmt.usdBrlRate ? `R$ ${formatBrlNumber(fmt.usdBrlRate, 2)}` : "—";

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
            <IconBtn
              label="Abrir dashboard"
              onClick={(e) => {
                e.stopPropagation();
                void onOpenDashboard();
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn
              label="Ocultar"
              onClick={(e) => {
                e.stopPropagation();
                void onHide();
              }}
            >
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
            className="flex h-full w-full flex-col gap-1.5 p-3"
          >
            {/* Cabeçalho: status + cotação discreta */}
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
              <MetricTooltip
                label={
                  <span data-tauri-drag-region className="text-[10px] opacity-80">
                    {rateLabel}
                  </span>
                }
                content={
                  fmt.usdBrlRate
                    ? `Cotação USD/BRL usada para converter custos. Atualizada ${fmt.rateUpdatedAt ? new Date(fmt.rateUpdatedAt).toLocaleString("pt-BR") : "recentemente"}.`
                    : "Cotação indisponível — convertendo a partir de USD."
                }
              />
            </div>

            {/* Linha do valor do dia */}
            <div data-tauri-drag-region className="flex items-end justify-between">
              <div data-tauri-drag-region>
                <MetricTooltip
                  label={
                    <span className="text-[11px] text-muted-foreground">
                      Hoje
                    </span>
                  }
                  content={
                    <>
                      Custo total das sessões iniciadas hoje. Este é o gasto
                      <strong> variável</strong> (só o que é cobrado por token):
                      provedores marcados como assinatura ou gratuito/local
                      aparecem como R$ 0 aqui — suas mensalidades entram em
                      outro lugar.
                    </>
                  }
                />
                <div data-tauri-drag-region className="text-2xl font-semibold leading-none">
                  <Money usd={todayCost} fmt={fmt} size="xl" tone="gradient" />
                </div>
              </div>
              <div data-tauri-drag-region className="text-right text-[11px] text-muted-foreground">
                <span>{snapshot?.today.sessions ?? 0} sessões</span>
              </div>
            </div>

            {/* Orçamento diário */}
            {dailyLimit > 0 ? (
              <div data-tauri-drag-region>
                <BudgetBar value={dailyUsd} limit={dailyLimitUsd} />
                <div
                  data-tauri-drag-region
                  className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground"
                >
                  <span>
                    {dailyLimitCurrency} {dailyLimit.toFixed(0)} / dia
                  </span>
                  <span>
                    <Money
                      usd={todayCost}
                      fmt={fmt}
                      size="xs"
                      hideSecondary
                    />
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-tauri-drag-region
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onOpenDashboard();
                }}
                className="text-left text-[11px] text-violet-300 underline-offset-2 hover:underline"
              >
                definir orçamento diário →
              </button>
            )}

            {/* Tokens de hoje + custo da sessão atual */}
            <div
              data-tauri-drag-region
              className="flex items-center justify-between text-[10px] text-muted-foreground"
            >
              <span data-tauri-drag-region className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                <TokenCount n={todayTokens} /> hoje
              </span>
              {snapshot?.currentSession ? (
                <span data-tauri-drag-region className="flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  sessão: <Money usd={sessionCost} fmt={fmt} size="xs" hideSecondary />
                </span>
              ) : (
                <span data-tauri-drag-region className="opacity-70">
                  sem sessão ativa
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
              <MetricTooltip
                label={
                  <span data-tauri-drag-region className="text-[10px] opacity-80">
                    {rateLabel}
                  </span>
                }
                content={
                  fmt.usdBrlRate
                    ? `Cotação USD/BRL: R$ ${fmt.usdBrlRate.toFixed(2)} por dólar.`
                    : "Cotação indisponível."
                }
              />
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
                        <TokenCount n={todayTokens} />
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
                            <TokenCount n={sessionTokens} />
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
                      <Timer className="h-3.5 w-3.5 text-amber-300" />
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