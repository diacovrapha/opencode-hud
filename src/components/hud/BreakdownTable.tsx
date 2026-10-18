import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Breakdown } from "@/lib/data/types";
import { Money } from "./Money";
import { TokenCount } from "./TokenCount";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPercent } from "@/lib/ui/format";
import type { MoneyFmt } from "@/lib/ui/format";

export type ColumnDef<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** Renderiza o valor da célula. */
  render: (row: T) => React.ReactNode;
  /** Como ordenar (padrão: usa o valor retornado por `sortValue`). */
  sortValue?: (row: T) => number | string;
  /** Largura opcional (CSS grid-template-columns). */
  width?: string;
};

type BreakdownTableProps<T> = {
  rows: T[];
  columns: ColumnDef<T>[];
  fmt: MoneyFmt;
  className?: string;
  emptyMessage?: string;
};

/**
 * Tabela ordenável com cabeçalhos clicáveis.
 */
export function BreakdownTable<T extends { key: string }>({
  rows,
  columns,
  className,
  emptyMessage = "Sem dados no período.",
}: BreakdownTableProps<T>): React.JSX.Element {
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    null,
  );

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const fn = col.sortValue;
    const out = [...rows].sort((a, b) => {
      const va = fn(a);
      const vb = fn(b);
      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, sort, columns]);

  const toggle = (col: ColumnDef<T>): void => {
    if (!col.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: "desc" };
      if (prev.dir === "desc") return { key: col.key, dir: "asc" };
      return null;
    });
  };

  const grid = columns.map((c) => c.width ?? "minmax(0, 1fr)").join(" ");

  if (rows.length === 0) {
    return (
      <div className={cn("p-6 text-center text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "glass overflow-hidden rounded-xl border border-white/10",
        className,
      )}
    >
      <div
        className="grid items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: grid }}
      >
        {columns.map((c) => (
          <button
            key={c.key}
            onClick={() => toggle(c)}
            disabled={!c.sortable}
            className={cn(
              "inline-flex items-center gap-1 text-left",
              c.align === "right" && "justify-end text-right",
              c.sortable
                ? "cursor-pointer hover:text-foreground"
                : "cursor-default opacity-80",
            )}
          >
            <span>{c.label}</span>
            {c.sortable && (
              <SortIcon
                active={sort?.key === c.key}
                dir={sort?.key === c.key ? sort.dir : undefined}
              />
            )}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-white/5">
        {sorted.map((row) => (
          <li
            key={row.key}
            className="grid items-center gap-2 px-3 py-2 transition-colors hover:bg-white/5"
            style={{ gridTemplateColumns: grid }}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                className={cn(
                  "min-w-0",
                  c.align === "right" && "text-right",
                )}
              >
                {c.render(row)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir?: "asc" | "desc";
}): React.JSX.Element {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}

// ---------- Builders prontos para Breakdown ----------

type BreakdownRow = Breakdown & {
  priceMissing?: boolean;
};

export function buildBreakdownColumns(
  fmt: MoneyFmt,
  totals: { cost: number },
  opts: { includeProvider?: boolean; includeModelConfig?: boolean; agentsConfig?: ReadonlyArray<{ name: string; model: string }> } = {},
): ColumnDef<BreakdownRow>[] {
  const cols: ColumnDef<BreakdownRow>[] = [
    {
      key: "label",
      label: opts.includeProvider ? "Modelo" : "Item",
      sortable: true,
      sortValue: (r) => r.label,
      render: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-sm font-medium">{r.label}</span>
            </TooltipTrigger>
            <TooltipContent className="glass-strong max-w-md text-xs">
              {r.label}
            </TooltipContent>
          </Tooltip>
          {isSubscription(r.key) && (
            <Badge variant="secondary" className="bg-violet-500/20 text-violet-200">
              assinatura
            </Badge>
          )}
          {r.priceMissing && (
            <Badge variant="outline" className="border-amber-400/40 text-amber-300">
              sem preço
            </Badge>
          )}
        </div>
      ),
      width: "minmax(0, 2.5fr)",
    },
  ];

  if (opts.includeProvider) {
    cols.push({
      key: "provider",
      label: "Provedor",
      sortable: true,
      sortValue: (r) => r.key.split("/")[0] ?? "",
      render: (r) => (
        <span className="truncate text-xs text-muted-foreground">
          {r.key.split("/")[0] ?? "—"}
        </span>
      ),
      width: "minmax(0, 1fr)",
    });
  }

  cols.push(
    {
      key: "messages",
      label: "Msgs",
      align: "right",
      sortable: true,
      sortValue: (r) => r.aggregate.messages,
      render: (r) => (
        <span className="tabular text-xs text-muted-foreground">
          {formatNumber(r.aggregate.messages)}
        </span>
      ),
      width: "60px",
    },
    {
      key: "tokens",
      label: "Tokens",
      align: "right",
      sortable: true,
      sortValue: (r) =>
        r.aggregate.tokens.input +
        r.aggregate.tokens.output +
        r.aggregate.tokens.reasoning +
        r.aggregate.tokens.cacheRead +
        r.aggregate.tokens.cacheWrite,
      render: (r) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="tabular text-xs">
              <TokenCount
                n={
                  r.aggregate.tokens.input +
                  r.aggregate.tokens.output +
                  r.aggregate.tokens.reasoning +
                  r.aggregate.tokens.cacheRead +
                  r.aggregate.tokens.cacheWrite
                }
                short
              />
            </span>
          </TooltipTrigger>
          <TooltipContent className="glass-strong max-w-xs text-xs">
            <div className="space-y-0.5">
              <div>Entrada: {formatNumber(r.aggregate.tokens.input)}</div>
              <div>Saída: {formatNumber(r.aggregate.tokens.output)}</div>
              <div>Raciocínio: {formatNumber(r.aggregate.tokens.reasoning)}</div>
              <div>Cache lido: {formatNumber(r.aggregate.tokens.cacheRead)}</div>
              <div>Cache escrito: {formatNumber(r.aggregate.tokens.cacheWrite)}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      ),
      width: "80px",
    },
    {
      key: "real",
      label: "Real",
      align: "right",
      sortable: true,
      sortValue: (r) => r.aggregate.cost,
      render: (r) => <Money usd={r.aggregate.cost} fmt={fmt} size="sm" hideSecondary />,
      width: "120px",
    },
    {
      key: "equivalent",
      label: "Equivalente API",
      align: "right",
      sortable: true,
      sortValue: (r) => r.aggregate.apiEquivalentCost,
      render: (r) => (
        <Money
          usd={r.aggregate.apiEquivalentCost}
          fmt={fmt}
          size="sm"
          hideSecondary
          tone="muted"
        />
      ),
      width: "130px",
    },
    {
      key: "share",
      label: "%",
      align: "right",
      sortable: true,
      sortValue: (r) => (totals.cost > 0 ? r.aggregate.cost / totals.cost : 0),
      render: (r) => (
        <span className="tabular text-xs text-muted-foreground">
          {formatPercent(r.aggregate.cost, totals.cost)}
        </span>
      ),
      width: "60px",
    },
  );

  if (opts.includeModelConfig && opts.agentsConfig) {
    cols.push({
      key: "configured",
      label: "Config.",
      sortable: true,
      sortValue: (r) => {
        const count = opts.agentsConfig!.filter((a) => a.model === r.key).length;
        return count;
      },
      render: (r) => {
        const agents = opts.agentsConfig!.filter((a) => a.model === r.key);
        if (agents.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground">
                {agents.length} {agents.length === 1 ? "agente" : "agentes"}
              </span>
            </TooltipTrigger>
            <TooltipContent className="glass-strong max-w-xs text-xs">
              <div className="mb-1 font-semibold">Agentes usando este modelo</div>
              <ul className="space-y-0.5">
                {agents.map((a) => (
                  <li key={a.name}>• {a.name}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      },
      width: "110px",
    });
  }

  return cols;
}

function isSubscription(model: string): boolean {
  return model.startsWith("minimax-coding-plan");
}