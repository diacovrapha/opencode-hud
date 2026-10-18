import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Github, Info, Wallet, RefreshCw, Power, Globe } from "lucide-react";
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
import type { Settings } from "@/lib/data/types";

const REFERENCE_MODELS = [
  { value: "anthropic/claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { value: "anthropic/claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "anthropic/claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

type Props = {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
};

export function SettingsView({ settings, update }: Props): React.JSX.Element {
  const [refModel, setRefModel] = React.useState(settings.referenceModel);
  React.useEffect(() => {
    setRefModel(settings.referenceModel);
  }, [settings.referenceModel]);

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

  const knownRef = REFERENCE_MODELS.find((m) => m.value === refModel);
  const customRef = !knownRef && refModel.trim().length > 0;

  return (
    <div className="space-y-4">
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
              onValueChange={(v) => update({ currency: v as Settings["currency"] })}
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

      <Card className="glass border-white/10 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-300" />
          <h3 className="text-sm font-semibold">Cálculo de economia</h3>
          <MetricTooltip content="Modelo usado como referência para calcular quanto você teria gasto na API. A economia é a diferença entre esse custo e o custo real." />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Modelo de referência" hint="Sugeridos:">
            <Select
              value={knownRef ? knownRef.value : "__custom__"}
              onValueChange={(v) => {
                if (v !== "__custom__") {
                  setRefModel(v);
                  update({ referenceModel: v });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">Personalizado…</SelectItem>
              </SelectContent>
            </Select>
            {(customRef || !knownRef) && (
              <Input
                className="mt-2"
                placeholder="provider/modelo"
                value={refModel}
                onChange={(e) => setRefModel(e.target.value)}
                onBlur={() => {
                  if (refModel.trim().length > 0) {
                    update({ referenceModel: refModel.trim() });
                  }
                }}
              />
            )}
          </Field>
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
        </div>
      </Card>

      <Card className="glass border-white/10 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Power className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-semibold">Sistema</h3>
        </div>
        <div className="space-y-3">
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
            Versão: <span className="tabular text-foreground">0.2.0</span>
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
    <div className="flex flex-col gap-1.5">
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