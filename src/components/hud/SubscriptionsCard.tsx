import * as React from "react";
import { motion } from "motion/react";
import { Crown, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Money } from "./Money";
import { MetricTooltip } from "./MetricTooltip";
import { cn } from "@/lib/utils";
import type { MoneyFmt } from "@/lib/ui/format";
import type { SubscriptionsSummary } from "@/lib/data/types";

type Props = {
  summary: SubscriptionsSummary;
  fmt: MoneyFmt;
  /** Callback para abrir Configurações quando a mensalidade está em falta. */
  onOpenSettings?: () => void;
  className?: string;
};

/**
 * Card "Suas assinaturas valem a pena?". Só aparece quando há ao menos
 * um item em `summary.items`. Mostra, por assinatura, o múltiplo entre o
 * equivalente na API do mês e a mensalidade, e a barra comparativa.
 */
export function SubscriptionsCard({
  summary,
  fmt,
  onOpenSettings,
  className,
}: Props): React.JSX.Element {
  const items = summary.items ?? [];
  const totalFee = summary.monthlyTotalUsd ?? 0;
  const totalApi = summary.apiEquivalentMonthUsd ?? 0;

  // Múltiplo agregado: só faz sentido se houver mensalidade total > 0.
  const totalMultiple = totalFee > 0 ? totalApi / totalFee : null;

  return (
    <Card className={cn("glass border-white/10 p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-violet-300" />
          <h3 className="text-sm font-semibold">Suas assinaturas valem a pena?</h3>
          <MetricTooltip
            content={
              <div className="space-y-1">
                <div>
                  Para cada assinatura, comparamos quanto você pagou de
                  mensalidade com o que o uso deste mês teria custado pagando
                  por token (preço de API).
                </div>
                <div className="opacity-80">
                  Múltiplo ≥ 1,0× (verde): você gastaria pelo menos isso se
                  pagasse por token.
                </div>
                <div className="opacity-80">
                  Múltiplo &lt; 1,0× (âmbar): o uso está aquém do que a
                  assinatura oferece — vale revisar.
                </div>
              </div>
            }
          />
        </div>
        {totalMultiple !== null && (
          <div
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs tabular",
              totalMultiple >= 1
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                : "border-amber-400/40 bg-amber-500/10 text-amber-300",
            )}
          >
            {formatMultiple(totalMultiple)} agregado
          </div>
        )}
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => {
          const feeKnown = item.monthlyFeeUsd !== undefined && item.monthlyFeeUsd > 0;
          const multiple = item.multiple;
          const ratio = feeKnown && multiple !== undefined
            ? Math.min(multiple, 2)
            : null;
          const barPct = ratio !== null ? Math.min(100, (ratio / 2) * 100) : null;
          const isWorth = multiple !== undefined && multiple >= 1;
          const colorClass = isWorth
            ? "from-emerald-500 to-emerald-400"
            : "from-amber-500 to-amber-400";
          const textClass = isWorth ? "text-emerald-300" : "text-amber-300";
          return (
            <motion.li
              key={item.providerId}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: idx * 0.03 }}
              className="rounded-md border border-white/10 bg-white/5 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                    <span className="truncate text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {item.providerId}
                    </span>
                  </div>
                  {feeKnown ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      mensalidade{" "}
                      <Money
                        usd={item.monthlyFeeUsd!}
                        fmt={fmt}
                        size="xs"
                        hideSecondary
                      />{" "}
                      · uso do mês{" "}
                      <Money
                        usd={item.apiEquivalentMonthUsd}
                        fmt={fmt}
                        size="xs"
                        hideSecondary
                      />
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-amber-300">
                      informe a mensalidade em Configurações para ver se vale a
                      pena.
                      {onOpenSettings && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={onOpenSettings}
                            className="underline-offset-2 hover:underline"
                          >
                            abrir Configurações →
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {multiple !== undefined && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "shrink-0 rounded-md border px-2 py-1 text-xs tabular",
                          isWorth
                            ? "border-emerald-400/40 bg-emerald-500/10"
                            : "border-amber-400/40 bg-amber-500/10",
                          textClass,
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          {isWorth ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {formatMultiple(multiple)} o que você pagou
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="glass-strong max-w-xs text-xs">
                      O uso deste mês (em USD a preço de API) é{" "}
                      {formatMultiple(multiple)} o valor da mensalidade. Se
                      fosse 1×, estaria "no zero a zero"; acima de 1×, a
                      assinatura se pagou.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              {barPct !== null && (
                <div className="mt-2">
                  <div className="budget-bar">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r", colorClass)}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>0×</span>
                    <span>1× (mês se pagou)</span>
                    <span>2× ou mais</span>
                  </div>
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>

      {totalFee > 0 && totalApi > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Total: você paga{" "}
          <Money usd={totalFee} fmt={fmt} size="xs" hideSecondary /> /mês e o
          uso do mês custaria{" "}
          <Money usd={totalApi} fmt={fmt} size="xs" hideSecondary /> se fosse
          por token.
        </p>
      )}
    </Card>
  );
}

function formatMultiple(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
}