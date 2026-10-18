import * as React from "react";
import { cn } from "@/lib/utils";

type BudgetBarProps = {
  /** Valor atual. */
  value: number;
  /** Limite do orçamento (se 0/null, sem orçamento). */
  limit: number;
  className?: string;
  /** Mostra rótulo "x% do orçamento". */
  showLabel?: boolean;
};

/**
 * Barra fina de orçamento. Cor muda para âmbar em 80% e vermelho em 100%.
 */
export function BudgetBar({
  value,
  limit,
  className,
  showLabel = false,
}: BudgetBarProps): React.JSX.Element {
  const ratio = limit > 0 ? Math.min(value / limit, 1.5) : 0;
  const pct = Math.round(ratio * 100);
  const tone =
    pct >= 100 ? "danger" : pct >= 80 ? "warning" : "ok";
  return (
    <div className={cn("w-full", className)}>
      <div className="budget-bar">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "ok" && "bg-gradient-to-r from-violet-400 to-blue-400",
            tone === "warning" && "bg-gradient-to-r from-amber-400 to-orange-500",
            tone === "danger" && "bg-gradient-to-r from-red-500 to-red-600",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {showLabel && limit > 0 && (
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{pct}% do orçamento</span>
          {pct >= 100 && (
            <span className="font-medium text-red-400">acima do limite</span>
          )}
        </div>
      )}
    </div>
  );
}