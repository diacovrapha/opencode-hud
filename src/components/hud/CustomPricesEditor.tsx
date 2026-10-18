import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MetricTooltip } from "./MetricTooltip";
// Money não é usado direto aqui — o cálculo de preço atual usa `fmtUsdShort`.
import { cn } from "@/lib/utils";
import { patchCustomPrice } from "@/lib/ui/v2-bridge";
// MoneyFmt não é usado aqui — usamos `fmtUsdShort` que formata em USD fixo.
import type { Breakdown, Settings } from "@/lib/data/types";

type Props = {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  /** Modelos com `priceMissing = true` no Snapshot. */
  missing: Breakdown[];
  className?: string;
};

/**
 * Editor de preços manuais (USD por 1M tokens) para modelos que aparecem
 * no uso mas não têm preço conhecido. Permite também adicionar/remover
 * preços para qualquer modelo usado.
 *
 * Salva em `Settings.customPrices` (chave = "provider/modelId").
 */
export function CustomPricesEditor({
  settings,
  update,
  missing,
  className,
}: Props): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [newKey, setNewKey] = React.useState("");

  const customPrices = settings.customPrices ?? {};

  // Lista única: modelos sem preço do snapshot + chaves manuais.
  const rows = React.useMemo(() => {
    const keys = new Set<string>();
    const fromMissing = missing
      .filter((b) => b.priceMissing)
      .map((b) => ({ key: b.key, label: b.label, fromMissing: true as const }));
    for (const m of fromMissing) keys.add(m.key);
    for (const k of Object.keys(customPrices)) keys.add(k);
    return [...keys]
      .map((k) => {
        const existing = customPrices[k];
        const fromSnap = missing.find((b) => b.key === k);
        return {
          key: k,
          label: fromSnap?.label ?? k,
          fromMissing: fromSnap?.priceMissing ?? false,
          value: existing,
        };
      })
      .sort((a, b) => {
        if (a.fromMissing !== b.fromMissing) return a.fromMissing ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [missing, customPrices]);

  const onSave = async (
    key: string,
    raw: { input?: string; output?: string; cacheRead?: string; cacheWrite?: string },
  ): Promise<void> => {
    const input = Number((raw.input ?? "").replace(",", "."));
    const output = Number((raw.output ?? "").replace(",", "."));
    if (!Number.isFinite(input) || input < 0) return;
    if (!Number.isFinite(output) || output < 0) return;
    const cr = raw.cacheRead !== undefined && raw.cacheRead !== ""
      ? Number(raw.cacheRead.replace(",", "."))
      : undefined;
    const cw = raw.cacheWrite !== undefined && raw.cacheWrite !== ""
      ? Number(raw.cacheWrite.replace(",", "."))
      : undefined;
    await patchCustomPrice(update, settings, key, {
      input,
      output,
      ...(Number.isFinite(cr) && cr! >= 0 ? { cacheRead: cr } : {}),
      ...(Number.isFinite(cw) && cw! >= 0 ? { cacheWrite: cw } : {}),
    });
  };

  const onRemove = async (key: string): Promise<void> => {
    await patchCustomPrice(update, settings, key, null);
  };

  const onAdd = async (): Promise<void> => {
    const k = newKey.trim();
    if (!k) return;
    if (customPrices[k] === undefined) {
      // Cria entrada com defaults editáveis (não zero "falso" — começa sem
      // valor até o usuário preencher entrada/saída e salvar).
      await patchCustomPrice(update, settings, k, { input: 0, output: 0 });
    }
    setNewKey("");
    setAdding(false);
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-white/5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-white/5"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Avançado · Preços manuais
          </span>
          <MetricTooltip content="Defina preços de modelos que não estão no catálogo do opencode (ou que mudaram de preço). Use apenas se souber os valores; é em USD por 1M tokens." />
          {rows.filter((r) => r.fromMissing && r.value === undefined).length > 0 && (
            <Badge
              variant="outline"
              className="border-amber-400/40 bg-amber-500/10 text-[10px] text-amber-300"
            >
              {rows.filter((r) => r.fromMissing && r.value === undefined).length} pendente
              {rows.filter((r) => r.fromMissing && r.value === undefined).length === 1
                ? ""
                : "s"}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-white/5"
          >
            <div className="space-y-2 p-4">
              <p className="text-[11px] text-muted-foreground">
                Use para modelos que aparecem no seu uso mas não têm preço
                conhecido. Os valores entram como custo equivalente na API
                (mesmo que o custo real seja zero, como em assinaturas).
              </p>

              {rows.length === 0 && (
                <div className="rounded-md border border-white/5 bg-black/20 p-3 text-center text-[11px] text-muted-foreground">
                  Nenhum modelo sem preço no momento.
                </div>
              )}

              <ul className="space-y-2">
                {rows.map((r) => (
                  <PriceRow
                    key={r.key}
                    rowKey={r.key}
                    label={r.label}
                    fromMissing={r.fromMissing}
                    initial={r.value}
                    onSave={(raw) => onSave(r.key, raw)}
                    onRemove={() => void onRemove(r.key)}
                  />
                ))}
              </ul>

              <div className="pt-2">
                {adding ? (
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void onAdd();
                        if (e.key === "Escape") setAdding(false);
                      }}
                      placeholder="provider/modelo"
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => void onAdd()}
                      disabled={!newKey.trim()}
                    >
                      Adicionar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setNewKey("");
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setAdding(true)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Adicionar preço para outro modelo
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type RowProps = {
  rowKey: string;
  label: string;
  fromMissing: boolean;
  initial?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  onSave: (raw: {
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
  }) => Promise<void>;
  onRemove: () => void;
};

function PriceRow({
  rowKey,
  label,
  fromMissing,
  initial,
  onSave,
  onRemove,
}: RowProps): React.JSX.Element {
  const [input, setInput] = React.useState(
    initial ? String(initial.input) : "",
  );
  const [output, setOutput] = React.useState(
    initial ? String(initial.output) : "",
  );
  const [cacheRead, setCacheRead] = React.useState(
    initial?.cacheRead !== undefined ? String(initial.cacheRead) : "",
  );
  const [cacheWrite, setCacheWrite] = React.useState(
    initial?.cacheWrite !== undefined ? String(initial.cacheWrite) : "",
  );

  // Sincroniza quando o initial muda (ex.: depois de salvar).
  React.useEffect(() => {
    setInput(initial ? String(initial.input) : "");
    setOutput(initial ? String(initial.output) : "");
    setCacheRead(initial?.cacheRead !== undefined ? String(initial.cacheRead) : "");
    setCacheWrite(initial?.cacheWrite !== undefined ? String(initial.cacheWrite) : "");
  }, [initial?.input, initial?.output, initial?.cacheRead, initial?.cacheWrite]);

  const commit = (): void => {
    void onSave({ input, output, cacheRead, cacheWrite });
  };

  return (
    <li className="rounded-md border border-white/10 bg-black/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm">{label}</span>
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
            {rowKey}
          </span>
          {fromMissing && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="border-amber-400/40 bg-amber-500/10 text-[10px] text-amber-300"
                >
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  sem preço
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="glass-strong max-w-xs text-xs">
                Este modelo aparece no seu uso mas não tem preço conhecido
                no catálogo. Defina entrada/saída para o cálculo de "equivalente
                na API".
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-red-300"
          onClick={onRemove}
          aria-label={`Remover preço de ${rowKey}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field
          label="Entrada"
          hint={
            initial
              ? `atual: ${fmtUsdShort(initial.input)} / 1M`
              : undefined
          }
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={commit}
            placeholder="0"
            className="h-9"
          />
        </Field>
        <Field
          label="Saída"
          hint={
            initial
              ? `atual: ${fmtUsdShort(initial.output)} / 1M`
              : undefined
          }
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            onBlur={commit}
            placeholder="0"
            className="h-9"
          />
        </Field>
        <Field label="Cache lido" hint="opcional">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={cacheRead}
            onChange={(e) => setCacheRead(e.target.value)}
            onBlur={commit}
            placeholder="—"
            className="h-9"
          />
        </Field>
        <Field label="Cache escrito" hint="opcional">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={cacheWrite}
            onChange={(e) => setCacheWrite(e.target.value)}
            onBlur={commit}
            placeholder="—"
            className="h-9"
          />
        </Field>
      </div>
    </li>
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
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

function fmtUsdShort(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v;
}