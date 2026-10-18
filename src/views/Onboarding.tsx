import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Coins,
  Wallet,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Globe,
  Power,
  CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProviderBillingHelp, ProviderRow } from "@/components/hud/ProviderRow";
import type { MoneyFmt } from "@/lib/ui/format";
import type {
  ProviderInfo,
  Settings,
  Snapshot,
} from "@/lib/data/types";

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  fmt: MoneyFmt;
  /** Fecha a overlay sem marcar onboardingDone (ex.: debug). */
  onSkip?: () => void;
};

/**
 * Tela de boas-vindas em 3 passos. Renderizada por cima do conteúdo do
 * dashboard quando `snapshot.needsOnboarding` é true. Concluir salva
 * `onboardingDone: true` e some com animação.
 */
export function Onboarding({
  snapshot,
  settings,
  update,
  fmt,
  onSkip,
}: Props): React.JSX.Element {
  const [step, setStep] = React.useState<0 | 1 | 2>(0);
  const [done, setDone] = React.useState(false);

  const providers = snapshot.providers ?? [];

  const onFinish = async (): Promise<void> => {
    setDone(true);
    await update({ onboardingDone: true });
  };

  const onSkipLocal = async (): Promise<void> => {
    if (onSkip) onSkip();
    await onFinish();
  };

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-label="Boas-vindas do opencode HUD"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-xl"
          >
            <button
              type="button"
              onClick={() => void onSkipLocal()}
              className="absolute -right-2 -top-2 z-10 rounded-full border border-white/10 bg-black/60 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Pular boas-vindas"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <Card className="glass-strong overflow-hidden border-white/10 p-0">
              {/* Banner gradiente no topo */}
              <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-violet-500/25 via-blue-500/15 to-fuchsia-500/15 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 shadow">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className="text-base font-semibold">Bem-vindo ao opencode HUD</div>
                    <div className="text-xs text-muted-foreground">
                      Vamos configurar o básico em 3 passos rápidos.
                    </div>
                  </div>
                </div>
                {/* Steps */}
                <ol className="mt-4 flex items-center gap-2">
                  {[0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= step
                          ? "bg-gradient-to-r from-violet-400 to-blue-400"
                          : "bg-white/10"
                      }`}
                    />
                  ))}
                </ol>
              </div>

              {/* Conteúdo do passo */}
              <div className="px-6 py-5">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18 }}
                  >
                    {step === 0 && (
                      <StepWelcome settings={settings} update={update} />
                    )}
                    {step === 1 && (
                      <StepProviders
                        providers={providers}
                        settings={settings}
                        update={update}
                        fmt={fmt}
                      />
                    )}
                    {step === 2 && (
                      <StepBudget settings={settings} update={update} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Rodapé com navegação */}
              <div className="flex items-center justify-between gap-2 border-t border-white/5 bg-black/20 px-6 py-3">
                <div className="text-[11px] text-muted-foreground">
                  Passo {step + 1} de 3
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onSkipLocal()}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Pular
                  </Button>
                  {step > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep((s) => (s - 1) as 0 | 1 | 2)}
                    >
                      <ChevronLeft className="mr-1 h-3 w-3" /> Voltar
                    </Button>
                  )}
                  {step < 2 ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}
                      className="bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-400 hover:to-blue-400"
                    >
                      Próximo <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => void onFinish()}
                      className="bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-400 hover:to-blue-400"
                    >
                      <Check className="mr-1 h-3 w-3" /> Concluir
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- passos ----------

function StepWelcome({
  settings,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Este app mostra, em tempo real, quanto você gasta com o opencode —
        e quanto economiza com suas assinaturas. Ele compara o que cada
        modelo custaria na API com o que você realmente paga.
      </p>
      <ul className="space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <Coins className="mt-0.5 h-4 w-4 text-violet-300" />
          <span>
            <strong className="text-foreground">Gasto real variável</strong> —
            só o que sai do seu bolso por token.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CircleDollarSign className="mt-0.5 h-4 w-4 text-blue-300" />
          <span>
            <strong className="text-foreground">Equivalente na API</strong> —
            quanto custaria se você pagasse tudo por token.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 text-fuchsia-300" />
          <span>
            <strong className="text-foreground">Suas assinaturas valem a
            pena?</strong> — compare cada assinatura com o uso real.
          </span>
        </li>
      </ul>

      <div>
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Moeda
        </Label>
        <ToggleGroup
          type="single"
          value={settings.currency}
          onValueChange={(v) => v && void update({ currency: v as "BRL" | "USD" })}
          variant="outline"
          size="sm"
          className="mt-1"
        >
          <ToggleGroupItem
            value="BRL"
            className="border-white/10 bg-white/5 text-xs data-[state=on]:border-violet-300/40 data-[state=on]:bg-violet-500/20 data-[state=on]:text-foreground"
          >
            <Globe className="mr-1 h-3 w-3" /> R$ (BRL)
          </ToggleGroupItem>
          <ToggleGroupItem
            value="USD"
            className="border-white/10 bg-white/5 text-xs data-[state=on]:border-violet-300/40 data-[state=on]:bg-violet-500/20 data-[state=on]:text-foreground"
          >
            <span className="mr-1">US$</span> (USD)
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Todos os valores são convertidos de USD usando a cotação do dia.
        </p>
      </div>
    </div>
  );
}

function StepProviders({
  providers,
  settings,
  update,
  fmt,
}: {
  providers: ProviderInfo[];
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  fmt: MoneyFmt;
}): React.JSX.Element {
  if (providers.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Assim que você usar o opencode, listaremos aqui os provedores
          detectados. Você poderá dizer para cada um como você paga — e a
          gente separa <strong className="text-foreground">gasto variável</strong>{" "}
          de <strong className="text-foreground">mensalidade de assinatura</strong>.
        </p>
        <div className="rounded-md border border-white/10 bg-white/5 p-3 text-[11px] text-muted-foreground">
          Use o opencode por alguns minutos e volte aqui.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Detectamos <strong className="text-foreground">{providers.length}</strong>{" "}
        provedor{providers.length === 1 ? "" : "es"} no seu uso. Diga como você
        paga cada um — preparamos um palpite, mas é bom você confirmar.
      </p>
      <ProviderBillingHelp />
      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {providers.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            setting={settings.providers[p.id]}
            settings={settings}
            update={update}
            fmt={fmt}
            showInferredBadge
          />
        ))}
      </div>
    </div>
  );
}

function StepBudget({
  settings,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}): React.JSX.Element {
  const [daily, setDaily] = React.useState(
    settings.budgetDaily !== undefined ? String(settings.budgetDaily) : "",
  );
  const [monthly, setMonthly] = React.useState(
    settings.budgetMonthly !== undefined ? String(settings.budgetMonthly) : "",
  );
  const [autostart, setAutostart] = React.useState<boolean>(settings.autostart);

  React.useEffect(() => {
    setDaily(settings.budgetDaily !== undefined ? String(settings.budgetDaily) : "");
    setMonthly(
      settings.budgetMonthly !== undefined ? String(settings.budgetMonthly) : "",
    );
    setAutostart(settings.autostart);
  }, [settings.budgetDaily, settings.budgetMonthly, settings.autostart]);

  const commitBudget = (
    key: "budgetDaily" | "budgetMonthly",
    raw: string,
  ): void => {
    if (raw === "") {
      void update({ [key]: undefined });
      return;
    }
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) void update({ [key]: n });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure limites opcionais e como o HUD deve se comportar ao ligar o
        Windows. Você pode mudar tudo isso depois em Configurações.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={`Orçamento diário (${settings.currency})`}
          hint="Opcional. Avisa quando chegar a 80% ou 100%."
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            onBlur={() => commitBudget("budgetDaily", daily)}
            placeholder="ex: 50"
          />
        </Field>
        <Field
          label={`Orçamento mensal (${settings.currency})`}
          hint="Usado na projeção do mês."
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            onBlur={() => commitBudget("budgetMonthly", monthly)}
            placeholder="ex: 800"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-emerald-300" />
          <div>
            <div className="text-sm">Iniciar com o Windows</div>
            <div className="text-[11px] text-muted-foreground">
              Abre o HUD minimizado na bandeja ao fazer login.
            </div>
          </div>
        </div>
        <Switch
          checked={autostart}
          onCheckedChange={(v) => {
            setAutostart(v);
            void update({ autostart: v });
          }}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Pronto — pode usar o app. Você sempre pode voltar aqui em{" "}
        <Wallet className="mx-1 inline h-3 w-3" />{" "}
        <span className="text-foreground/90">Configurações</span>.
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}