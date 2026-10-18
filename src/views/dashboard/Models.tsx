import * as React from "react";
import { Card } from "@/components/ui/card";
import { BarBreakdown } from "@/components/hud/charts/BarBreakdown";
import {
  BreakdownTable,
  buildBreakdownColumns,
} from "@/components/hud/BreakdownTable";
import { MetricTooltip } from "@/components/hud/MetricTooltip";
import { EmptyState } from "@/components/hud/EmptyState";
import { formatTokens, totalTokens } from "@/lib/ui/format";
import type { Snapshot } from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";
import { Cpu } from "lucide-react";

type Props = {
  snapshot: Snapshot;
  fmt: MoneyFmt;
};

export function ModelsView({ snapshot, fmt }: Props): React.JSX.Element {
  const rows = (snapshot.byModel ?? []).map((b) => ({
    ...b,
    // Campo opcional que a outra tarefa pode adicionar ao Breakdown.
    priceMissing: (b as { priceMissing?: boolean }).priceMissing ?? false,
  }));
  const totalsCost = rows.reduce((acc, b) => acc + b.aggregate.cost, 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Cpu className="h-6 w-6 text-violet-300" />}
        title="Sem uso de modelos no período"
        description="Os modelos usados nas sessões aparecerão aqui."
      />
    );
  }

  const columns = buildBreakdownColumns(fmt, { cost: totalsCost }, {
    includeProvider: true,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="glass border-white/10 p-4 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Top modelos por custo</h3>
            <MetricTooltip content="Barras ordenadas: maior custo no topo." />
          </div>
          <div className="h-72">
            <BarBreakdown
              items={rows.slice(0, 8).map((b) => ({
                label: b.label,
                value: b.aggregate.cost,
              }))}
              fmt={fmt}
            />
          </div>
        </Card>
        <Card className="glass border-white/10 p-4">
          <h3 className="mb-2 text-sm font-semibold">Top modelos por tokens</h3>
          <div className="h-72">
            <BarBreakdown
              items={rows.slice(0, 8).map((b) => ({
                label: b.label,
                value: totalTokens(b.aggregate.tokens),
              }))}
              asTokens
            />
          </div>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Todos os modelos</h3>
        <BreakdownTable
          fmt={fmt}
          rows={rows}
          columns={columns}
          emptyMessage="Nenhum modelo no período."
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Total de tokens processados: {formatTokens(
          rows.reduce((acc, b) => acc + totalTokens(b.aggregate.tokens), 0),
        )}
        .
      </p>
    </div>
  );
}