import * as React from "react";
import { motion } from "motion/react";
import {
  Coins,
  TrendingDown,
  Wallet,
  Activity,
  Layers,
  Calendar as CalendarIcon,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { KpiCard } from "@/components/hud/KpiCard";
import { Money } from "@/components/hud/Money";
import { TokenCount } from "@/components/hud/TokenCount";
import { MetricTooltip } from "@/components/hud/MetricTooltip";
import { SubscriptionsCard } from "@/components/hud/SubscriptionsCard";
import { AreaDaily } from "@/components/hud/charts/AreaDaily";
import { ModelDonut, TokensDonut } from "@/components/hud/charts/ModelDonut";
import { CalendarHeatmap } from "@/components/hud/charts/CalendarHeatmap";
import { BarBreakdown } from "@/components/hud/charts/BarBreakdown";
import { BudgetBar } from "@/components/hud/BudgetBar";
import { totalTokens } from "@/lib/ui/format";
import type { TokenTotals } from "@/lib/ui/format";
import type {
  ProviderInfo,
  ResolvedReference,
  Settings,
  Snapshot,
  SubscriptionsSummary,
} from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";
import {
  getProviders,
  getReference,
  getSubscriptions,
  totalMonthlyUsd,
} from "@/lib/ui/v2-bridge";

type OverviewProps = {
  snapshot: Snapshot;
  settings: Settings;
  fmt: MoneyFmt;
  onJumpToSessions: () => void;
  onJumpToModels: () => void;
  onOpenSettings?: () => void;
};

function buildTooltips(
  fmt: MoneyFmt,
  subscriptions: SubscriptionsSummary | null,
  providers: ProviderInfo[],
  resolved: ResolvedReference | null,
  fallbackReferenceModel: string,
) {
  const subs = providers.filter((p) => p.billing === "subscription");
  return {
    realCost: (
      <div className="space-y-1">
        <div>
          Custo real VARIÁVEL: o que foi efetivamente cobrado por token.
          Provedores marcados como assinatura ou gratuito/local entram com R$ 0
          aqui — o que você paga por eles vai em "assinaturas".
        </div>
        {subscriptions && subscriptions.monthlyTotalUsd > 0 && (
          <div className="opacity-80">
            Assinaturas somam{" "}
            <strong>
              <Money
                usd={subscriptions.monthlyTotalUsd}
                fmt={fmt}
                size="xs"
                hideSecondary
              />
            </strong>
            /mês à parte.
          </div>
        )}
      </div>
    ),
    apiEquivalent: subs.length === 0 ? (
      <div className="space-y-1">
        <div>
          Quanto custaria se você tivesse pagado por token, mesmo em
          modelos de assinatura (o cálculo usa o preço de API de cada
          modelo).
        </div>
        <div className="opacity-80">
          Como você não tem assinaturas cadastradas, equivalente ≈ real
          (você paga tudo por token).
        </div>
      </div>
    ) : (
      <div className="space-y-1">
        <div>
          Quanto custaria se você tivesse pagado por token, mesmo em modelos
          de assinatura (o cálculo usa o preço de API de cada modelo).
        </div>
        <div className="opacity-80">
          Inclui o uso de {subs.map((s) => s.label).join(", ")} — se uma
          assinatura te poupar, a diferença aparece aqui.
        </div>
      </div>
    ),
    savings: (
      <div className="space-y-1">
        <div>
          Diferença entre o que o modelo de referência custaria para o mesmo
          uso e o que você pagou de fato.
        </div>
        <div className="opacity-80">
          Referência:{" "}
          <strong>
            {resolved
              ? `${resolved.label} (${resolved.mode === "auto" ? "automático" : "manual"})`
              : fallbackReferenceModel}
          </strong>
          {resolved?.source && <> — origem: {resolved.source}</>}
          {resolved?.priceMissing && (
            <span className="text-amber-300"> (sem preço)</span>
          )}
        </div>
      </div>
    ),
    tokens:
      "Total de tokens processados: entrada, saída, raciocínio, cache lido e cache escrito.",
    projection:
      "Projeção do mês: gasto atual multiplicado pelos dias restantes do mês. Útil para planejar o orçamento.",
    currentSession:
      "Sessão que está em andamento agora, com agente, modelo e custo até o momento.",
  };
}

/**
 * Texto dinâmico para o KPI "Custo equivalente na API" — usa os nomes dos
 * provedores de assinatura vindos dos dados, sem nunca escrever nome fixo.
 */
function apiEquivalentSentence(
  apiEquivalent: number,
  real: number,
  providers: ProviderInfo[],
  sub: SubscriptionsSummary | null,
  fmt: MoneyFmt,
): React.ReactNode {
  const diff = apiEquivalent - real;
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.005) {
    if ((sub?.items ?? []).length === 0) {
      return <>você paga tudo por token: equivalente = real.</>;
    }
    return <>sem diferença entre custo real e o da API.</>;
  }
  const subs = providers.filter((p) => p.billing === "subscription");
  if (diff > 0 && subs.length > 0) {
    const names = subs.map((s) => s.label).join(", ");
    return (
      <>
        suas assinaturas ({names}) te pouparam{" "}
        <Money usd={diff} fmt={fmt} size="xs" hideSecondary /> vs. se você
        tivesse pago por token.
      </>
    );
  }
  if (diff > 0) {
    return (
      <>
        você economizou{" "}
        <Money usd={diff} fmt={fmt} size="xs" hideSecondary /> vs. se tivesse
        pago por token.
      </>
    );
  }
  return (
    <>
      custo real ficou{" "}
      <Money usd={Math.abs(diff)} fmt={fmt} size="xs" hideSecondary /> acima do
      que a API cobrada por token.
    </>
  );
}

/** Diferença `referenceCost − cost` (modelo de referência vs. modelo real). */
function savingsSentence(
  reference: number,
  real: number,
  fmt: MoneyFmt,
  ref: ResolvedReference | null,
): React.ReactNode {
  if (!ref) {
    return <>referência ainda não foi resolvida.</>;
  }
  if (ref.priceMissing) {
    return <>referência sem preço: defina em Configurações.</>;
  }
  const label = ref.label;
  const diff = reference - real;
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.005) {
    return (
      <>
        se tudo rodasse em <span className="text-foreground">{label}</span>:
        sem diferença.
      </>
    );
  }
  if (diff > 0) {
    return (
      <>
        se tudo rodasse em <span className="text-foreground">{label}</span>:{" "}
        <Money usd={reference} fmt={fmt} size="xs" hideSecondary />.
      </>
    );
  }
  return (
    <>
      o modelo de referência (
      <span className="text-foreground">{label}</span>) custaria{" "}
      <Money usd={Math.abs(diff)} fmt={fmt} size="xs" hideSecondary /> a menos.
    </>
  );
}

export function Overview({
  snapshot,
  settings,
  fmt,
  onJumpToSessions,
  onJumpToModels,
  onOpenSettings,
}: OverviewProps): React.JSX.Element {
  const [chartMode, setChartMode] = React.useState<"money" | "tokens">("money");
  const [donutMode, setDonutMode] = React.useState<"money" | "tokens">("money");
  const totals = snapshot.totals;
  const today = snapshot.today;

  const providers = getProviders(snapshot);
  const subscriptions = getSubscriptions(snapshot);
  const resolved = getReference(snapshot);
  const monthlySubUsd = totalMonthlyUsd(subscriptions);
  const showSubscriptionsLine = monthlySubUsd > 0;

  // "Gasto real variável" — soma dos modelos marcados como api (cost > 0).
  // A semântica já está correta em `totals.cost`; o realCostTooltipLabel
  // apenas adiciona a linha de assinaturas.
  const totalTokensCount = React.useMemo(() => totalTokens(totals.tokens), [totals]);
  const todayTokensCount = React.useMemo(() => totalTokens(today.tokens), [today]);
  const savings = Math.max(totals.referenceCost - totals.cost, 0);
  const monthlyLimit = settings.budgetMonthly ?? snapshot.budget.monthly ?? 0;
  const monthlyUsed = snapshot.projection.monthCost;
  const dailyLimit = settings.budgetDaily ?? snapshot.budget.daily ?? 0;
  const dailyLimitCurrency = settings.currency;
  const dailyLimitUsd = convertToUsd(dailyLimit, dailyLimitCurrency, fmt);

  const TOOLTIPS = buildTooltips(
    fmt,
    subscriptions,
    providers,
    resolved,
    settings.referenceModel,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Gasto real (variável)"
          tooltip={TOOLTIPS.realCost}
          icon={<Coins className="h-4 w-4" />}
          accent="violet"
          value={
            <Money
              usd={totals.cost}
              fmt={fmt}
              size="lg"
              tone="gradient"
            />
          }
          context={
            <div className="flex flex-col gap-0.5">
              <span>
                {totals.sessions} sessões · {totals.messages} mensagens
              </span>
              {showSubscriptionsLine && (
                <span className="text-muted-foreground">
                  + assinaturas:{" "}
                  <Money
                    usd={monthlySubUsd}
                    fmt={fmt}
                    size="xs"
                    hideSecondary
                    tone="muted"
                  />
                  /mês
                </span>
              )}
            </div>
          }
        />
        <KpiCard
          label="Custo equivalente na API"
          tooltip={TOOLTIPS.apiEquivalent}
          icon={<Activity className="h-4 w-4" />}
          accent="blue"
          value={
            <Money
              usd={totals.apiEquivalentCost}
              fmt={fmt}
              size="lg"
            />
          }
          context={
            <span>
              {apiEquivalentSentence(
                totals.apiEquivalentCost,
                totals.cost,
                providers,
                subscriptions,
                fmt,
              )}
            </span>
          }
        />
        <KpiCard
          label="Economia vs. referência"
          tooltip={TOOLTIPS.savings}
          icon={<TrendingDown className="h-4 w-4" />}
          accent="success"
          value={
            resolved?.priceMissing ? (
              <span className="text-base text-amber-300">
                sem preço: defina em Configurações
              </span>
            ) : (
              <Money
                usd={savings}
                fmt={fmt}
                size="lg"
                tone="success"
              />
            )
          }
          context={
            savingsSentence(
              totals.referenceCost,
              totals.cost,
              fmt,
              resolved,
            )
          }
        />
        <KpiCard
          label="Tokens"
          tooltip={TOOLTIPS.tokens}
          icon={<Layers className="h-4 w-4" />}
          accent="blue"
          value={<TokenCount n={totalTokensCount} className="text-2xl font-semibold" />}
          context={
            <span className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {(
                [
                  ["entrada", totals.tokens.input],
                  ["saída", totals.tokens.output],
                  ["raciocínio", totals.tokens.reasoning],
                  ["cache", totals.tokens.cacheRead + totals.tokens.cacheWrite],
                ] as const
              ).map(([label, n]) => (
                <span key={label} className="flex items-baseline justify-between gap-2 whitespace-nowrap">
                  <span className="text-muted-foreground">{label}</span>
                  <TokenCount n={n} className="font-medium text-foreground/90" />
                </span>
              ))}
            </span>
          }
        />
      </div>

      {(subscriptions?.items ?? []).length > 0 && (
        <SubscriptionsCard
          summary={subscriptions!}
          fmt={fmt}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="glass border-white/10 p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Gasto diário</h3>
              <MetricTooltip content="Distribuição diária do gasto no período selecionado. Alterne entre R$/USD e tokens." />
            </div>
            <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-0.5 text-[11px]">
              <button
                onClick={() => setChartMode("money")}
                className={
                  "rounded px-2 py-0.5 transition-colors " +
                  (chartMode === "money"
                    ? "bg-violet-500/30 text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                R$
              </button>
              <button
                onClick={() => setChartMode("tokens")}
                className={
                  "rounded px-2 py-0.5 transition-colors " +
                  (chartMode === "tokens"
                    ? "bg-violet-500/30 text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                Tokens
              </button>
            </div>
          </div>
          <div className="h-64">
            <AreaDaily data={snapshot.daily} mode={chartMode} fmt={fmt} />
          </div>
        </Card>

        <Card className="glass border-white/10 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Distribuição por modelo</h3>
            <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-0.5 text-[11px]">
              <button
                onClick={() => setDonutMode("money")}
                className={
                  "rounded px-2 py-0.5 transition-colors " +
                  (donutMode === "money"
                    ? "bg-violet-500/30 text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                R$
              </button>
              <button
                onClick={() => setDonutMode("tokens")}
                className={
                  "rounded px-2 py-0.5 transition-colors " +
                  (donutMode === "tokens"
                    ? "bg-violet-500/30 text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                Tokens
              </button>
            </div>
          </div>
          <div className="h-64">
            {donutMode === "money" ? (
              <ModelDonut data={snapshot.byModel} fmt={fmt} />
            ) : (
              <TokensDonut data={snapshot.byModel} />
            )}
          </div>
        </Card>
      </div>

      <Card className="glass border-white/10 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-violet-300" />
            <h3 className="text-sm font-semibold">Calendário de uso</h3>
            <MetricTooltip content="Heatmap estilo GitHub: cada quadradinho representa um dia, mais escuro = mais uso." />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {snapshot.daily.length} dias
          </span>
        </div>
        <div className="h-40">
          <CalendarHeatmap data={snapshot.daily} fmt={fmt} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="glass border-white/10 p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Top modelos no período</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={onJumpToModels}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Ver todos
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="h-64">
            <BarBreakdown
              items={snapshot.byModel.slice(0, 7).map((b) => ({
                label: b.label,
                value: b.aggregate.cost,
              }))}
              fmt={fmt}
            />
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="glass border-white/10 p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Hoje</h3>
              <span className="text-[11px] text-muted-foreground">
                {today.sessions} sessões
              </span>
            </div>
            <div className="text-3xl font-semibold tabular">
              <Money usd={today.cost} fmt={fmt} tone="gradient" />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <TokenCount n={todayTokensCount} /> processados hoje
            </div>
            <Separator className="my-3 bg-white/5" />
            <div className="text-[11px] text-muted-foreground">Orçamento diário</div>
            {dailyLimitUsd > 0 ? (
              <>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className="tabular">
                    <Money usd={today.cost} fmt={fmt} size="sm" hideSecondary />
                  </span>
                  <span className="tabular text-muted-foreground">
                    / {dailyLimitCurrency} {dailyLimit.toFixed(2)}
                  </span>
                </div>
                <BudgetBar className="mt-2" value={today.cost} limit={dailyLimitUsd} />
              </>
            ) : (
              <a
                href="#/settings"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenSettings?.();
                }}
                className="mt-1 inline-block text-[11px] text-violet-300 underline-offset-2 hover:underline"
              >
                definir orçamento diário →
              </a>
            )}
          </Card>

          <Card className="glass border-white/10 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-300" />
              <h3 className="text-sm font-semibold">Projeção do mês</h3>
              <MetricTooltip content={TOOLTIPS.projection} />
            </div>
            <div className="text-2xl font-semibold tabular">
              <Money usd={monthlyUsed} fmt={fmt} />
            </div>
            {monthlyLimit > 0 ? (
              <>
                <div className="mt-2">
                  <BudgetBar
                    value={monthlyUsed}
                    limit={convertToUsd(monthlyLimit, settings.currency, fmt)}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>
                    Limite: {settings.currency} {monthlyLimit.toFixed(2)}
                  </span>
                  <span>
                    restante{" "}
                    <Money
                      usd={Math.max(
                        convertToUsd(monthlyLimit, settings.currency, fmt) -
                          monthlyUsed,
                        0,
                      )}
                      fmt={fmt}
                      size="xs"
                      hideSecondary
                    />
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Sem orçamento mensal definido.
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="glass border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Sessão atual</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onJumpToSessions}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Ver todas
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
        {snapshot.currentSession ? (
          <CurrentSessionDetail session={snapshot.currentSession} fmt={fmt} />
        ) : (
          <div className="rounded-md border border-white/5 bg-white/5 p-4 text-center text-sm text-muted-foreground">
            Nenhuma sessão ativa no momento.
          </div>
        )}
      </Card>
    </div>
  );
}

function CurrentSessionDetail({
  session,
  fmt,
}: {
  session: NonNullable<Snapshot["currentSession"]>;
  fmt: MoneyFmt;
}): React.JSX.Element {
  const t: TokenTotals = session.aggregate.tokens;
  const total = totalTokens(t);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-base font-medium">{session.title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          agente <span className="text-foreground">{session.agent}</span> ·
          modelo <span className="text-foreground">{session.model}</span> ·
          {session.aggregate.messages} mensagens
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SmallStat
          label="Custo"
          value={<Money usd={session.aggregate.cost} fmt={fmt} size="sm" hideSecondary />}
        />
        <SmallStat label="Tokens" value={<TokenCount n={total} />} />
        <SmallStat label="Entrada" value={<TokenCount n={t.input} />} />
        <SmallStat label="Saída" value={<TokenCount n={t.output} />} />
        <SmallStat label="Cache lido" value={<TokenCount n={t.cacheRead} />} />
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-md border border-white/5 bg-white/5 p-2"
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm tabular">{value}</div>
    </motion.div>
  );
}

function convertToUsd(value: number, currency: "BRL" | "USD", fmt: MoneyFmt): number {
  if (currency === "USD") return value;
  if (fmt.usdBrlRate && fmt.usdBrlRate > 0) return value / fmt.usdBrlRate;
  return value;
}