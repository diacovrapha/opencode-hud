import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Cpu, Wallet, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MetricTooltip } from "./MetricTooltip";
import { Money } from "./Money";
import { cn } from "@/lib/utils";
import type { MoneyFmt } from "@/lib/ui/format";
import type {
  BillingType,
  ProviderInfo,
  ProviderSetting,
  Settings,
} from "@/lib/data/types";
import { patchProviders } from "@/lib/ui/v2-bridge";

const BILLING_OPTIONS: Array<{
  value: BillingType;
  label: string;
  description: string;
}> = [
  {
    value: "api",
    label: "Por token",
    description: "Pago por uso na API do provedor.",
  },
  {
    value: "subscription",
    label: "Assinatura",
    description: "Mensalidade fixa (Copilot, Claude Pro/Max, ChatGPT Plus…).",
  },
  {
    value: "free",
    label: "Gratuito/local",
    description: "Sem custo direto (Ollama, LM Studio, modelos locais).",
  },
];

type Props = {
  provider: ProviderInfo;
  /** Configuração atual efetiva. Pode ser undefined se o usuário nunca salvou. */
  setting?: ProviderSetting;
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  fmt: MoneyFmt;
  /** Esconde o badge "inferred" (ex.: quando o onboarding já confirmou). */
  showInferredBadge?: boolean;
};

/**
 * Linha de configuração de um provedor detectado no uso. Mostra nome/label,
 * modelos usados, último uso e uso do mês, além do controle de billing
 * ("Como você paga").
 *
 * É reaproveitada na aba de Configurações e no passo 2 do Onboarding — não
 * embute nenhum conhecimento da rota onde está sendo usada.
 */
export function ProviderRow({
  provider,
  setting,
  settings,
  update,
  fmt,
  showInferredBadge = true,
}: Props): React.JSX.Element {
  const effectiveBilling: BillingType = setting?.billing ?? provider.billing;
  const isInferred = provider.inferred && !setting && showInferredBadge;

  const onChangeBilling = async (next: string): Promise<void> => {
    if (!next || next === effectiveBilling) return;
    await patchProviders(update, settings, provider.id, {
      billing: next as BillingType,
    });
  };

  const onChangeFee = async (raw: string): Promise<void> => {
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    await patchProviders(update, settings, provider.id, {
      monthlyFee: n,
      feeCurrency: setting?.feeCurrency ?? "BRL",
    });
  };

  const onChangeFeeCurrency = async (v: "BRL" | "USD"): Promise<void> => {
    await patchProviders(update, settings, provider.id, {
      feeCurrency: v,
    });
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/5 p-4 transition-colors",
        isInferred && "border-amber-400/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold">{provider.label}</div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {provider.id}
            </span>
            {isInferred && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="border-amber-400/40 bg-amber-500/10 text-[10px] text-amber-300"
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    palpite automático — confirme
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="glass-strong max-w-xs text-xs">
                  Detectamos que este provedor parece ser cobrado por assinatura,
                  mas é só um palpite. Escolha "Como você paga" abaixo para
                  confirmar; o selo some depois disso.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {provider.models.length} modelo
              {provider.models.length === 1 ? "" : "s"}
            </span>
            {provider.lastUsed > 0 && (
              <span>
                último uso {relativeDateSafe(provider.lastUsed)}
              </span>
            )}
            <span>
              {effectiveBilling === "api" ? "este mês " : "este mês ≈ "}
              <Money
                usd={
                  effectiveBilling === "api"
                    ? provider.monthAggregate.cost
                    : provider.monthAggregate.apiEquivalentCost
                }
                fmt={fmt}
                size="xs"
                hideSecondary
              />
              {effectiveBilling === "api" ? "" : " em API"} · {provider.monthAggregate.messages} mensagens
            </span>
          </div>
          {provider.models.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {provider.models.slice(0, 4).map((m) => (
                <span
                  key={m}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {m}
                </span>
              ))}
              {provider.models.length > 4 && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                  +{provider.models.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Como você paga
            </Label>
            <MetricTooltip
              content={
                effectiveBilling === "subscription"
                  ? "Assinatura: você paga uma mensalidade fixa. O uso deste provedor não entra no gasto real (variável); ele aparece em \"Suas assinaturas valem a pena?\", comparado com a mensalidade."
                  : effectiveBilling === "free"
                    ? "Gratuito/local: modelos que não custam nada (ex.: Ollama, LM Studio). Entram como R$ 0."
                    : "Por token: você paga pelo que usa. O gasto real é o custo que o opencode registrou."
              }
            />
          </div>
          <ToggleGroup
            type="single"
            value={effectiveBilling}
            onValueChange={(v) => void onChangeBilling(v)}
            variant="outline"
            size="sm"
            className="flex-wrap justify-start"
          >
            {BILLING_OPTIONS.map((o) => (
              <ToggleGroupItem
                key={o.value}
                value={o.value}
                aria-label={o.label}
                className="border-white/10 bg-white/5 text-xs data-[state=on]:border-violet-300/40 data-[state=on]:bg-violet-500/20 data-[state=on]:text-foreground"
              >
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {effectiveBilling === "subscription" && (
          <motion.div
            key="fee"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <div>
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Mensalidade
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    defaultValue={
                      setting?.monthlyFee !== undefined
                        ? String(setting.monthlyFee)
                        : ""
                    }
                    onBlur={(e) => void onChangeFee(e.target.value)}
                    placeholder="ex: 100"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Moeda
                </Label>
                <ToggleGroup
                  type="single"
                  value={setting?.feeCurrency ?? "BRL"}
                  onValueChange={(v) => v && void onChangeFeeCurrency(v as "BRL" | "USD")}
                  variant="outline"
                  size="sm"
                  className="mt-1"
                >
                  <ToggleGroupItem
                    value="BRL"
                    className="border-white/10 bg-white/5 text-xs data-[state=on]:border-violet-300/40 data-[state=on]:bg-violet-500/20 data-[state=on]:text-foreground"
                  >
                    R$
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="USD"
                    className="border-white/10 bg-white/5 text-xs data-[state=on]:border-violet-300/40 data-[state=on]:bg-violet-500/20 data-[state=on]:text-foreground"
                  >
                    US$
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Quanto você paga por mês neste plano. É comparado com o quanto o seu
              uso custaria pagando por token.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

/**
 * Explicação exibida UMA vez acima da lista de provedores (antes ela se
 * repetia dentro de cada linha).
 */
export function ProviderBillingHelp({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-white/5 bg-black/20 p-2.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" />
      <span>
        Se você usa <strong className="text-foreground/90">GitHub Copilot</strong>,{" "}
        <strong className="text-foreground/90">Claude Pro/Max</strong> ou{" "}
        <strong className="text-foreground/90">ChatGPT Plus</strong> pelo login da conta, marque como{" "}
        <strong className="text-foreground/90">Assinatura</strong>: o opencode registra um custo por token
        que você não paga de verdade. Assim o gasto real mostra só o que é cobrado por token, e a
        mensalidade aparece em "Suas assinaturas valem a pena?".
      </span>
    </div>
  );
}

// Formato "há 3 dias" sem importar date-fns aqui (mantém o componente leve
// e tolerante a snapshots sem lastUsed).
function relativeDateSafe(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "agora";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} dia${d === 1 ? "" : "s"}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `há ${mo} mês${mo === 1 ? "" : "es"}`;
  const y = Math.round(mo / 12);
  return `há ${y} ano${y === 1 ? "" : "s"}`;
}