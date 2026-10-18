import * as React from "react";
import { formatMoney } from "@/lib/ui/format";
import type { MoneyFmt, MoneyOpts } from "@/lib/ui/format";
import { cn } from "@/lib/utils";

type MoneyProps = {
  /** Valor em USD (a função cuida da conversão). */
  usd: number;
  fmt: MoneyFmt;
  className?: string;
  /** Cor especial (ex.: verde para economia). */
  tone?: "default" | "success" | "warning" | "danger" | "gradient" | "muted";
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  /** Quando true, oculta o secundário (USD/BRL alternativo). */
  hideSecondary?: boolean;
  /** Tooltip customizado (sobrescreve o default de cotação ausente). */
  tooltip?: React.ReactNode;
};

const sizeClass: Record<NonNullable<MoneyProps["size"]>, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
  "2xl": "text-3xl",
};

const toneClass: Record<NonNullable<MoneyProps["tone"]>, string> = {
  default: "text-foreground",
  success: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-red-400",
  gradient: "text-gradient",
  muted: "text-muted-foreground",
};

/**
 * Renderiza um valor monetário em pt-BR, com a secundária menor (USD/BRL).
 * Use `usd` como entrada; a conversão é feita via `fmt.usdBrlRate`.
 */
export function Money({
  usd,
  fmt,
  className,
  tone = "default",
  size = "md",
  hideSecondary,
  tooltip,
}: MoneyProps): React.JSX.Element {
  const opts: MoneyOpts = { hideSecondary };
  const { primary, secondary, tooltip: defaultTip } = formatMoney(usd, fmt, opts);
  const tip = tooltip ?? (defaultTip || undefined);

  return (
    <span
      className={cn("inline-flex flex-col leading-tight tabular", toneClass[tone], className)}
      title={typeof tip === "string" ? tip : undefined}
    >
      <span className={cn("font-semibold", sizeClass[size])}>{primary}</span>
      {secondary && (
        <span className="text-[0.7em] font-normal text-muted-foreground">
          {secondary}
        </span>
      )}
    </span>
  );
}