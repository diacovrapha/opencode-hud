import * as React from "react";
import { useSnapshotStore, startPolling, stopPolling, DEFAULT_SETTINGS } from "@/lib/data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PeriodKey } from "@/lib/data/types";
import { TitleBar } from "@/views/TitleBar";
import { dbQuery } from "@/lib/data/api";

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
};

export function Dashboard(): React.JSX.Element {
  const { snapshot, period, setPeriod, refresh, error } = useSnapshotStore();
  const [dbProbe, setDbProbe] = React.useState<string>("(ainda não consultado)");

  React.useEffect(() => {
    startPolling(refresh, DEFAULT_SETTINGS.refreshSeconds);
    return () => stopPolling();
  }, [refresh]);

  async function probeDb(): Promise<void> {
    try {
      const rows = await dbQuery(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        [],
      );
      setDbProbe(`tabelas: ${rows.map((r) => String(r.name)).join(", ")}`);
    } catch (err) {
      setDbProbe(`erro: ${String(err)}`);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar title="opencode HUD — Dashboard" />

      <div className="flex items-center justify-between border-b border-border bg-card/40 px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Visão geral</h1>
          {snapshot?.opencodeRunning ? (
            <Badge variant="default" className="bg-emerald-600">
              opencode rodando
            </Badge>
          ) : (
            <Badge variant="destructive">opencode parado</Badge>
          )}
          {snapshot?.usdBrl && (
            <span className="text-xs text-muted-foreground">
              USD/BRL R$ {snapshot.usdBrl.rate.toFixed(2)}
            </span>
          )}
        </div>
        <ToggleGroup
          type="single"
          value={period}
          onValueChange={(v) => v && setPeriod(v as PeriodKey)}
          variant="outline"
          size="sm"
        >
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
            <ToggleGroupItem key={k} value={k} aria-label={PERIOD_LABELS[k]}>
              {PERIOD_LABELS[k]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error && (
          <Card className="mb-4 border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Erro</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Custo (período)</CardDescription>
              <CardTitle>
                {snapshot
                  ? `$${snapshot.totals.cost.toFixed(4)}`
                  : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {snapshot
                ? `${snapshot.totals.sessions} sessões · ${snapshot.totals.messages} mensagens`
                : "carregando..."}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Hoje</CardDescription>
              <CardTitle>
                {snapshot
                  ? `$${snapshot.today.cost.toFixed(4)}`
                  : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {snapshot
                ? `${snapshot.today.sessions} sessões hoje`
                : "carregando..."}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Sessão atual</CardDescription>
              <CardTitle className="text-base">
                {snapshot?.currentSession?.title ?? "nenhuma"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {snapshot?.currentSession
                ? `${snapshot.currentSession.agent} · ${snapshot.currentSession.model}`
                : "—"}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Diagnóstico do banco</CardTitle>
            <CardDescription>
              Use o botão abaixo para chamar o comando Rust{" "}
              <code className="rounded bg-muted px-1">db_query</code> e listar as
              tabelas reais do opencode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => void probeDb()}>Consultar sqlite_master</Button>
            <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs">
              {dbProbe}
            </pre>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Por modelo</CardTitle>
            <CardDescription>
              Top modelos por custo no período selecionado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {snapshot?.byModel.slice(0, 5).map((b) => (
                <li key={b.key} className="flex justify-between">
                  <span>{b.label}</span>
                  <span className="font-mono">
                    ${b.aggregate.cost.toFixed(4)} · {b.aggregate.sessions}{" "}
                    sessões
                  </span>
                </li>
              )) ?? <li>carregando...</li>}
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}