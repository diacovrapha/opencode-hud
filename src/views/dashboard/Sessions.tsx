import * as React from "react";
import { Card } from "@/components/ui/card";
import { SessionTree } from "@/components/hud/SessionTree";
import { EmptyState } from "@/components/hud/EmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Snapshot } from "@/lib/data/types";
import { formatNumber, type MoneyFmt } from "@/lib/ui/format";
import { ListTree } from "lucide-react";

type Props = {
  snapshot: Snapshot;
  fmt: MoneyFmt;
};

export function SessionsView({ snapshot, fmt }: Props): React.JSX.Element {
  const sessions = snapshot.sessions ?? [];
  const [selected, setSelected] = React.useState<Snapshot["sessions"][number] | null>(null);

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<ListTree className="h-6 w-6 text-violet-300" />}
        title="Nenhuma sessão no período"
        description="As sessões que você abriu no opencode aparecerão aqui."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
      <Card className="glass border-white/10 p-4">
        <SessionTree sessions={sessions} fmt={fmt} onSelect={setSelected} />
      </Card>
      <Card className="glass sticky top-0 max-h-[80vh] border-white/10 p-4">
        <div className="mb-2 text-sm font-semibold">Detalhes</div>
        <ScrollArea className="-mr-2 h-[calc(80vh-3rem)] pr-2">
          {selected ? (
            <SessionDetail session={selected} fmt={fmt} />
          ) : (
            <div className="text-xs text-muted-foreground">
              Selecione uma sessão para ver os detalhes.
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}

function SessionDetail({
  session,
  fmt,
}: {
  session: NonNullable<Snapshot["sessions"][number]>;
  fmt: MoneyFmt;
}): React.JSX.Element {
  const t = session.aggregate.tokens;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-base font-medium">{session.title}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {session.agent} · {session.model}
        </div>
        <div className="break-all text-[11px] text-muted-foreground">{session.directory}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Custo (USD)" value={formatNumber(session.aggregate.cost, 4)} />
        <Mini label="Msgs" value={formatNumber(session.aggregate.messages)} />
        <Mini label="Entrada" value={formatNumber(t.input)} />
        <Mini label="Saída" value={formatNumber(t.output)} />
        <Mini label="Raciocínio" value={formatNumber(t.reasoning)} />
        <Mini label="Cache lido" value={formatNumber(t.cacheRead)} />
        <Mini label="Cache escrito" value={formatNumber(t.cacheWrite)} />
      </div>
      <div className="rounded-md border border-white/5 bg-white/5 p-2 text-[11px] text-muted-foreground">
        Cotação USD/BRL usada:{" "}
        <span className="tabular text-foreground">
          {fmt.usdBrlRate
            ? `R$ ${fmt.usdBrlRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "indisponível"}
        </span>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-white/5 bg-white/5 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="tabular text-xs">{value}</div>
    </div>
  );
}