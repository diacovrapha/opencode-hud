import * as React from "react";
import { FolderGit2, Folder, MessageSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  BreakdownTable,
  buildBreakdownColumns,
} from "@/components/hud/BreakdownTable";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/hud/EmptyState";
import type { Snapshot } from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";

type Props = {
  snapshot: Snapshot;
  fmt: MoneyFmt;
};

export function ProjectsView({ snapshot, fmt }: Props): React.JSX.Element {
  const rows = snapshot.byProject;
  const totalsCost = rows.reduce((acc, b) => acc + b.aggregate.cost, 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 className="h-6 w-6 text-violet-300" />}
        title="Nenhum projeto no período"
        description="Os projetos (diretórios) em que você usou o opencode aparecerão aqui."
      />
    );
  }

  // Adapta colunas: a primeira coluna mostra label curto + tooltip com path completo.
  const columns = buildBreakdownColumns(fmt, { cost: totalsCost }).map((c) => {
    if (c.key !== "label") return c;
    return {
      ...c,
      render: (row: (typeof rows)[number]): React.ReactNode => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 items-center gap-2">
              <Folder className="h-3.5 w-3.5 shrink-0 text-violet-300" />
              <span className="truncate text-sm font-medium">{row.label}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="glass-strong max-w-md text-xs">
            {row.key}
          </TooltipContent>
        </Tooltip>
      ),
    };
  });

  return (
    <div className="space-y-4">
      <Card className="glass border-white/10 p-4">
        <h3 className="mb-3 text-sm font-semibold">Projetos no período</h3>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <li
              key={p.key}
              className="rounded-lg border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.label}</div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {p.key}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="glass-strong max-w-md text-xs">
                      {p.key}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <Stat icon={<MessageSquare className="h-3 w-3" />} label="Msgs" value={p.aggregate.messages} />
                <Stat
                  label="Custo"
                  valueClass="tabular text-sm font-semibold"
                  value={p.aggregate.cost.toFixed(4)}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <BreakdownTable
        fmt={fmt}
        rows={rows}
        columns={columns}
        emptyMessage="Nenhum projeto no período."
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  valueClass,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-white/5 bg-black/20 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={valueClass ?? "tabular text-sm"}>{value}</div>
    </div>
  );
}