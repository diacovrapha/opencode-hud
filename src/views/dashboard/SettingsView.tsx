import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Github, Info, Wallet, RefreshCw, Globe, Plug, Settings as SettingsIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { MetricTooltip } from "@/components/hud/MetricTooltip";
import { ProviderBillingHelp, ProviderRow } from "@/components/hud/ProviderRow";
import { ReferencePicker } from "@/components/hud/ReferencePicker";
import { CustomPricesEditor } from "@/components/hud/CustomPricesEditor";
import { EmptyState } from "@/components/hud/EmptyState";
import { cn } from "@/lib/utils";
import { getProviders, getReference } from "@/lib/ui/v2-bridge";
import type {
  Settings as SettingsType,
  Snapshot,
} from "@/lib/data/types";
import type { MoneyFmt } from "@/lib/ui/format";

type Props = {
  settings: SettingsType;
  update: (p: Partial<SettingsType>) => Promise<void>;
  snapshot?: Snapshot | null;
  fmt: MoneyFmt;
};

export function SettingsView({
  settings,
  update,
  snapshot,
  fmt,
}: Props): React.JSX.Element {
  const [budgetDaily, setBudgetDaily] = React.useState(
    settings.budgetDaily !== undefined ? String(settings.budgetDaily) : "",
  );
  const [budgetMonthly, setBudgetMonthly] = React.useState(
    settings.budgetMonthly !== undefined ? String(settings.budgetMonthly) : "",
  );
  React.useEffect(() => {
    setBudgetDaily(settings.budgetDaily !== undefined ? String(settings.budgetDaily) : "");
    setBudgetMonthly(
      settings.budgetMonthly !== undefined ? String(settings.budgetMonthly) : "",
    );
  }, [settings.budgetDaily, settings.budgetMonthly]);

  const [refresh, setRefresh] = React.useState(String(settings.refreshSeconds));
  React.useEffect(() => {
    setRefresh(String(settings.refreshSeconds));
  }, [settings.refreshSeconds]);

  const commitNumeric = (key: "budgetDaily" | "budgetMonthly", raw: string): void => {
    if (raw === "") {
      update({ [key]: undefined });
      return;
    }
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) {
      update({ [key]: n });
    }
  };

  const onOpenRepo = async (): Promise<void> => {
    try {
      await openUrl("https://github.com/diacovrapha/opencode-hud");
    } catch (e) {
      console.error("open repo", e);
    }
  };

  const providers = getProviders(snapshot);
  const resolved = getReference(snapshot);
  const usedKeys = React.useMemo(
    () => new Set((snapshot?.byModel ?? []).map((b) => b.key)),
    [snapshot?.byModel],
  );
  const missingModels = (snapshot?.byModel ?? []).filter(
    (b) => (b as { priceMissing?: boolean }).priceMissing === true,
  );

  return (
    <div className="space-y-4">
      {/* Seus provedores — primeiro da lista, conforme pedido */}
      <Card className="glass border-white/10 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Plug className="h-4 w-4 text-violet-300" />
          <h3 className="text-sm font-semibold">Seus provedores</h3>
          <MetricTooltip
            content={
              <div className="space-y-1">
                <div>
                  Detectamos quem você usa para rodar o opencode. Para cada um,
                  diga como você paga: a gente separa o <strong>gasto variável
                  (por token)</strong> das <strong>mensalidades de assinatura</strong>
                  {" "}no cálculo de economia.
                </div>
                <div className="opacity-80">
                  Provedores como GitHub Copilot, Claude Pro/Max e ChatGPT Plus
                  aparecem como custo 0 na coluna "real" porque são
                  assinaturas — mas continuam contando para o "equivalente na
                  API".
                </div>
              </div>
            }
          />
        </div>

        {providers.length === 0 ? (
          <EmptyState
            title="Nenhum provedor detectado ainda"
            description="Use o opencode para gerar dados; os provedores aparecem aqui assim que houver uso."
            className="bg-transparent"
          />
        ) : (
          <div className="space-y-2">
            <ProviderBillingHelp />
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
        )}
      </Card>

      {/* Orçamento */}
      <Card className="glass border-white/10 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-violet-300" />
          <h3 className="text-sm font-semibold">Orçamento</h3>
          <MetricTooltip content="Limites de gasto diário e mensal. Quando atingidos, a barra fica âmbar (80%) ou vermelha (100%)." />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Moeda" hint="Moeda em que os limites são exibidos.">
            <Select
              value={settings.currency}
              onValueChange={(v) => update({ currency: v as SettingsType["currency"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BRL">BRL (R$)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={`Orçamento diário (${settings.currency})`}
            hint="Se vazio, sem limite diário."
          >
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={budgetDaily}
              onChange={(e) => setBudgetDaily(e.target.value)}
              onBlur={() => commitNumeric("budgetDaily", budgetDaily)}
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
              value={budgetMonthly}
              onChange={(e) => setBudgetMonthly(e.target.value)}
              onBlur={() => commitNumeric("budgetMonthly", budgetMonthly)}
              placeholder="ex: 800"
            />
          </Field>
        </div>
      </Card>

      {/* Modelo de referência */}
      <Card className="glass border-white/10 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-300" />
          <h3 className="text-sm font-semibold">Modelo de referência</h3>
          <MetricTooltip
            content={
              <div className="space-y-1">
                <div>
                  O modelo de referência é o "se tudo rodasse nele" usado no
                  cálculo de economia. Pode ser o do seu agente principal
                  (detectado automaticamente) ou um que você escolha.
                </div>
                <div className="opacity-80">
                  Se a referência estiver sem preço, a economia vs. referência
                  fica indisponível até você cadastrar o valor em "Preços
                  manuais" abaixo.
                </div>
              </div>
            }
          />
        </div>
        <ReferencePicker
          settings={settings}
          resolved={resolved}
          update={update}
          fmt={fmt}
          usedKeys={usedKeys}
        />
      </Card>

      {/* Preços manuais (colapsável) */}
      <CustomPricesEditor
        settings={settings}
        update={update}
        missing={missingModels}
      />

      {/* Sistema + outras preferências */}
      <Card className="glass border-white/10 p-5">
        <div className="mb-4 flex items-center gap-2">
          <SettingsIcon className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-semibold">Sistema</h3>
        </div>
        <div className="space-y-3">
          <Field
            label="Intervalo de atualização (segundos)"
            hint="Com que frequência os dados do opencode são lidos."
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={3600}
                value={refresh}
                onChange={(e) => setRefresh(e.target.value)}
                onBlur={() => {
                  const n = Number(refresh);
                  if (Number.isFinite(n) && n >= 1) {
                    update({ refreshSeconds: Math.floor(n) });
                  } else {
                    setRefresh(String(settings.refreshSeconds));
                  }
                }}
              />
            </div>
          </Field>
          <Separator className="bg-white/5" />
          <ToggleRow
            label="Iniciar com o Windows"
            description="Abre o HUD minimizado na bandeja ao fazer login."
            checked={settings.autostart}
            onChange={(v) => update({ autostart: v })}
          />
          <Separator className="bg-white/5" />
          <ToggleRow
            label="Widget inicia expandido"
            description="Abre o widget no formato detalhado (340x460)."
            checked={settings.widgetExpanded}
            onChange={(v) => update({ widgetExpanded: v })}
          />
        </div>
      </Card>

      <Card className="glass border-white/10 p-5">
        <div className="mb-2 flex items-center gap-2">
          <Github className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Sobre</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          <div>
            Versão: <span className="tabular text-foreground">{__APP_VERSION__}</span>
          </div>
          <div className="mt-1">
            Repositório:{" "}
            <button
              onClick={() => void onOpenRepo()}
              className="inline-flex items-center gap-1 text-violet-300 underline-offset-2 hover:underline"
            >
              <Globe className="h-3 w-3" />
              github.com/diacovrapha/opencode-hud
            </button>
          </div>
        </div>
      </Card>
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
    <div className={cn("flex flex-col gap-1.5")}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground">{description}</div>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}