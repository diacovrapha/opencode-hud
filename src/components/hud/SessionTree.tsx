import * as React from "react";
import { ChevronRight, Bot, Cpu, FolderTree, MessageSquare } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/lib/data/types";
import { Money } from "./Money";
import { TokenCount } from "./TokenCount";
import { relativeDate } from "@/lib/ui/format";
import type { MoneyFmt } from "@/lib/ui/format";

type SessionTreeProps = {
  sessions: SessionInfo[];
  fmt: MoneyFmt;
  /** Callback quando o usuário clica numa linha. */
  onSelect?: (s: SessionInfo) => void;
  className?: string;
  emptyMessage?: string;
};

type FlatNode = {
  session: SessionInfo;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
};

/**
 * Lista de sessões com busca e linhas expansíveis mostrando
 * sub-sessões (children) em árvore.
 */
export function SessionTree({
  sessions,
  fmt,
  onSelect,
  className,
  emptyMessage = "Nenhuma sessão no período.",
}: SessionTreeProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"date" | "cost">("date");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: SessionInfo): boolean =>
      !q ||
      s.title.toLowerCase().includes(q) ||
      s.agent.toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q) ||
      s.directory.toLowerCase().includes(q);

    const keepTree = (nodes: SessionInfo[]): SessionInfo[] => {
      const result: SessionInfo[] = [];
      for (const n of nodes) {
        const children = n.children ? keepTree(n.children) : [];
        if (match(n) || children.length > 0) {
          result.push({ ...n, children });
        }
      }
      return result;
    };

    const tree = keepTree(sessions);
    // sort roots
    const sortFn = (a: SessionInfo, b: SessionInfo): number =>
      sortBy === "date"
        ? b.timeCreated - a.timeCreated
        : b.aggregate.cost - a.aggregate.cost;
    tree.sort(sortFn);
    return tree;
  }, [sessions, query, sortBy]);

  const flat = React.useMemo<FlatNode[]>(() => {
    const out: FlatNode[] = [];
    const walk = (nodes: SessionInfo[], depth: number): void => {
      for (const s of nodes) {
        const hasChildren = !!(s.children && s.children.length > 0);
        const isExpanded = hasChildren && (expanded[s.id] ?? true);
        out.push({
          session: s,
          depth,
          expanded: isExpanded,
          hasChildren,
        });
        if (isExpanded && s.children) walk(s.children, depth + 1);
      }
    };
    walk(filtered, 0);
    return out;
  }, [filtered, expanded]);

  const toggle = (id: string): void => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  if (sessions.length === 0) {
    return (
      <div className={cn("p-6 text-center text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, agente, modelo…"
          className="h-9 w-full max-w-sm rounded-md border border-white/10 bg-white/5 px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
        />
        <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-0.5 text-xs">
          <button
            onClick={() => setSortBy("date")}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              sortBy === "date"
                ? "bg-violet-500/30 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Mais recentes
          </button>
          <button
            onClick={() => setSortBy("cost")}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              sortBy === "cost"
                ? "bg-violet-500/30 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Mais caros
          </button>
        </div>
      </div>

      <div className="glass overflow-hidden rounded-xl border border-white/10">
        {flat.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nada encontrado para "{query}".
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {flat.map(({ session, depth, expanded, hasChildren }) => (
              <SessionRow
                key={session.id}
                session={session}
                depth={depth}
                expanded={expanded}
                hasChildren={hasChildren}
                onToggle={() => toggle(session.id)}
                onClick={() => onSelect?.(session)}
                fmt={fmt}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type RowProps = {
  session: SessionInfo;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onClick: () => void;
  fmt: MoneyFmt;
};

function SessionRow({
  session,
  depth,
  expanded,
  hasChildren,
  onToggle,
  onClick,
  fmt,
}: RowProps): React.JSX.Element {
  const total =
    session.aggregate.tokens.input +
    session.aggregate.tokens.output +
    session.aggregate.tokens.reasoning +
    session.aggregate.tokens.cacheRead +
    session.aggregate.tokens.cacheWrite;

  return (
    <li
      className="group flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/5"
      style={{ paddingLeft: `${12 + depth * 24}px` }}
    >
      <button
        onClick={onToggle}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-transform",
          hasChildren ? "text-muted-foreground hover:bg-white/10" : "invisible",
          expanded ? "rotate-90" : "",
        )}
        aria-label={expanded ? "Recolher" : "Expandir"}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1 cursor-pointer" onClick={onClick}>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-sm font-medium">{session.title}</span>
            </TooltipTrigger>
            <TooltipContent className="glass-strong max-w-md text-xs">
              {session.title}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Bot className="h-3 w-3" /> {session.agent}
          </span>
          <span className="inline-flex items-center gap-1">
            <Cpu className="h-3 w-3" /> {session.model.split("/").pop()}
          </span>
          <span className="inline-flex items-center gap-1">
            <FolderTree className="h-3 w-3" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="max-w-[160px] truncate">{shortenDir(session.directory)}</span>
              </TooltipTrigger>
              <TooltipContent className="glass-strong max-w-md text-xs">
                {session.directory}
              </TooltipContent>
            </Tooltip>
          </span>
          <span>{relativeDate(session.timeUpdated)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-xs">
        <Badge
          variant="outline"
          className="border-white/10 bg-white/5 font-normal text-muted-foreground"
        >
          <MessageSquare className="mr-1 h-3 w-3" />
          {session.aggregate.messages}
        </Badge>
        <div className="hidden text-right sm:block">
          <div className="text-[11px] text-muted-foreground">tokens</div>
          <div className="text-xs font-medium tabular">
            <TokenCount n={total} short />
          </div>
        </div>
        <div className="min-w-[110px] text-right">
          <Money usd={session.aggregate.cost} fmt={fmt} size="sm" hideSecondary />
        </div>
      </div>
    </li>
  );
}

function shortenDir(d: string): string {
  if (!d) return "";
  const parts = d.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return d;
  return `…/${parts.slice(-2).join("/")}`;
}