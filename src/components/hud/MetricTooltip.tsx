import * as React from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type MetricTooltipProps = {
  /** Texto explicativo da métrica. */
  content: React.ReactNode;
  /** Texto/label à esquerda do ícone (opcional). */
  label?: React.ReactNode;
  className?: string;
};

/**
 * Rótulo de métrica sempre acompanhado de um ícone "i" com tooltip.
 * Resolve a queixa de "difícil de compreender" do app antigo.
 */
export function MetricTooltip({
  content,
  label,
  className,
}: MetricTooltipProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-help items-center gap-1 text-muted-foreground",
            className,
          )}
        >
          {label}
          <Info className="h-3 w-3 shrink-0 opacity-70 hover:opacity-100" />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="glass-strong max-w-xs text-xs leading-relaxed"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}