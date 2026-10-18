import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricTooltip } from "./MetricTooltip";
import { CountUp } from "./CountUp";

type KpiCardProps = {
  label: React.ReactNode;
  /** Conteúdo numérico principal, à direita (ex.: <Money>, <TokenCount>). */
  value: React.ReactNode;
  /** Linha de contexto (ex.: "12 sessões · 234 mensagens"). */
  context?: React.ReactNode;
  /** Tooltip explicando o que significa essa métrica. */
  tooltip?: React.ReactNode;
  /** Ícone pequeno à esquerda (Lucide). */
  icon?: React.ReactNode;
  /** Cor de destaque. */
  accent?: "default" | "violet" | "blue" | "success" | "warning" | "danger";
  /** Quando true, mostra skeleton. */
  loading?: boolean;
  className?: string;
};

const accentClass: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  default: "from-white/5 to-white/0",
  violet: "from-violet-500/15 to-violet-500/0",
  blue: "from-blue-500/15 to-blue-500/0",
  success: "from-emerald-500/15 to-emerald-500/0",
  warning: "from-amber-500/15 to-amber-500/0",
  danger: "from-red-500/15 to-red-500/0",
};

const accentText: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  default: "text-foreground",
  violet: "text-violet-300",
  blue: "text-blue-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-red-300",
};

/**
 * Cartão de KPI: rótulo pequeno + tooltip + valor grande + contexto.
 */
export function KpiCard({
  label,
  value,
  context,
  tooltip,
  icon,
  accent = "default",
  loading = false,
  className,
}: KpiCardProps): React.JSX.Element {
  return (
    <Card
      className={cn(
        "glass-raised relative overflow-hidden border-white/10 p-4",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60",
          accentClass[accent],
        )}
      />
      <div className="relative flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <MetricTooltip
            label={
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
            }
            content={tooltip ?? "—"}
          />
          {icon && (
            <span className={cn("opacity-80", accentText[accent])}>{icon}</span>
          )}
        </div>
        <div className={cn("mt-1", accentText[accent])}>
          {loading ? (
            <div className="skeleton h-7 w-32" />
          ) : (
            <div className="text-2xl font-semibold leading-tight">
              {typeof value === "number" ? <CountUp value={value} /> : value}
            </div>
          )}
        </div>
        {context && (
          <div className="text-[11px] text-muted-foreground">{context}</div>
        )}
      </div>
    </Card>
  );
}