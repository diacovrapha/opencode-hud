import * as React from "react";
import { Card } from "@/components/ui/card";
import { BarBreakdown } from "@/components/hud/charts/BarBreakdown";
import {
  BreakdownTable,
  buildBreakdownColumns,
} from "@/components/hud/BreakdownTable";
import { MetricTooltip } from "@/components/hud/MetricTooltip";
import { EmptyState } from "@/components/hud/EmptyState";
import { totalTokens } from "@/lib/ui/format";
import type { Snapshot } from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Props = {
  snapshot: Snapshot;
  fmt: MoneyFmt;
};

export function AgentsView({ snapshot, fmt }: Props): React.JSX.Element {
  const rows = snapshot.byAgent;
  const totalsCost = rows.reduce((acc, b) => acc + b.aggregate.cost, 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Bot className="h-6 w-6 text-violet-300" />}
        title="Sem uso de agentes no período"
        description="Os agentes usados nas sessões aparecerão aqui."
      />
    );
  }

  const agentsConfig = snapshot.agentsConfig ?? [];
  const modelByAgent = new Map(agentsConfig.map((a) => [a.name, a.model]));

  const columns = buildBreakdownColumns(fmt, { cost: totalsCost }, {
    includeProvider: false,
    includeModelConfig: false,
  }).map((c) => {
    if (c.key !== "label") return c;
    return {
      ...c,
      render: (row: (typeof rows)[number]): React.ReactNode => (
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="border-violet-400/40 bg-violet-500/10 text-violet-200">
            {row.label}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {modelByAgent.get(row.label) ?? "—"}
          </span>
        </div>
      ),
    };
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="glass border-white/10 p-4 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Top agentes por custo</h3>
            <MetricTooltip content="Custo total por agente no período." />
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
          <h3 className="mb-2 text-sm font-semibold">Configuração dos agentes</h3>
          <ul className="space-y-2 text-xs">
            {agentsConfig.slice(0, 8).map((a) => (
              <li
                key={a.name}
                className="flex items-center justify-between gap-2 rounded-md border border-white/5 bg-white/5 px-2 py-1.5"
              >
                <span className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      a.mode === "primary"
                        ? "border-blue-400/40 bg-blue-500/10 text-blue-200"
                        : "border-white/10 bg-white/5 text-muted-foreground"
                    }
                  >
                    {a.mode === "primary" ? "principal" : "sub"}
                  </Badge>
                  <span className="font-medium">{a.name}</span>
                </span>
                <span className="truncate text-muted-foreground">{a.model}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <BreakdownTable
        fmt={fmt}
        rows={rows}
        columns={columns}
        emptyMessage="Nenhum agente no período."
      />

      <p className="text-[11px] text-muted-foreground">
        Tokens processados por todos os agentes:{" "}
        <span className="tabular text-foreground">
          {totalTokens(
            rows.reduce(
              (acc, b) => ({
                input: acc.input + b.aggregate.tokens.input,
                output: acc.output + b.aggregate.tokens.output,
                reasoning: acc.reasoning + b.aggregate.tokens.reasoning,
                cacheRead: acc.cacheRead + b.aggregate.tokens.cacheRead,
                cacheWrite: acc.cacheWrite + b.aggregate.tokens.cacheWrite,
              }),
              { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
            ),
          )}
        </span>
        .
      </p>
    </div>
  );
}