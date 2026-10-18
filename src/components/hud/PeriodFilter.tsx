import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PeriodKey } from "@/lib/data/types";

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
};

type PeriodFilterProps = {
  value: PeriodKey;
  onChange: (p: PeriodKey) => void;
  className?: string;
};

/**
 * Filtro de período global (Hoje · 7d · 30d · Mês · Tudo).
 */
export function PeriodFilter({
  value,
  onChange,
  className,
}: PeriodFilterProps): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as PeriodKey)}
      variant="outline"
      size="sm"
      className={className}
    >
      {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
        <ToggleGroupItem
          key={k}
          value={k}
          aria-label={PERIOD_LABELS[k]}
          className="border-white/10 bg-white/5 text-xs data-[state=on]:border-violet-300/40 data-[state=on]:bg-violet-500/20 data-[state=on]:text-foreground"
        >
          {PERIOD_LABELS[k]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}