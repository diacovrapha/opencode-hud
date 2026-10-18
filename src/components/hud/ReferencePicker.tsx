import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, Sparkles, Bot, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Money } from "./Money";
import { cn } from "@/lib/utils";
import { searchCatalog } from "@/lib/ui/v2-bridge";
import type { MoneyFmt } from "@/lib/ui/format";
import type {
  CatalogModel,
  ResolvedReference,
  Settings,
} from "@/lib/data/types";

type Props = {
  settings: Settings;
  /** Modelo de referência efetivo, vindo do Snapshot. */
  resolved: ResolvedReference | null;
  /** Função de update do settings store. */
  update: (p: Partial<Settings>) => Promise<void>;
  fmt: MoneyFmt;
  /**
   * Conjunto de modelos já usados (chaves "provider/model").
   * Vindo normalmente de `snapshot.byModel.map(b => b.key)`.
   */
  usedKeys?: Set<string>;
  className?: string;
};

const DEBOUNCE_MS = 200;

/**
 * Controle de modelo de referência: "Automático (modelo do agente principal)"
 * vs "Escolher". Quando manual, mostra um combobox com busca debounced via
 * `searchCatalog`. Modelos já usados ganham um destaque "você usa".
 */
export function ReferencePicker({
  settings,
  resolved,
  update,
  fmt,
  usedKeys,
  className,
}: Props): React.JSX.Element {
  const mode = settings.referenceMode ?? "auto";

  const setMode = async (next: "auto" | "manual"): Promise<void> => {
    await update({ referenceMode: next });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <ModeButton
          active={mode === "auto"}
          label="Automático"
          description="Modelo do seu agente principal"
          icon={<Bot className="h-3.5 w-3.5" />}
          onClick={() => void setMode("auto")}
        />
        <ModeButton
          active={mode === "manual"}
          label="Escolher"
          description="Buscar e selecionar manualmente"
          icon={<Search className="h-3.5 w-3.5" />}
          onClick={() => void setMode("manual")}
        />
      </div>

      {mode === "auto" ? (
        <AutoResolved resolved={resolved} fmt={fmt} />
      ) : (
        <ManualPicker
          settings={settings}
          update={update}
          fmt={fmt}
          usedKeys={usedKeys}
          initial={resolved?.model ?? settings.referenceModel}
        />
      )}
    </div>
  );
}

function ModeButton({
  active,
  label,
  description,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
        active
          ? "border-violet-400/50 bg-violet-500/15 text-foreground"
          : "border-white/10 bg-white/5 text-muted-foreground hover:border-violet-300/40 hover:text-foreground",
      )}
    >
      <span className={cn("shrink-0", active ? "text-violet-300" : "")}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{label}</span>
        <span className="block text-[11px] text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function AutoResolved({
  resolved,
  fmt: _fmt,
}: {
  resolved: ResolvedReference | null;
  fmt: MoneyFmt;
}): React.JSX.Element {
  if (!resolved) {
    return (
      <div className="rounded-md border border-white/10 bg-white/5 p-3 text-[11px] text-muted-foreground">
        Ainda não conseguimos resolver um modelo principal. Use o modo
        "Escolher" para definir manualmente.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-300" />
        <span className="font-medium">{resolved.label}</span>
        {resolved.priceMissing && (
          <Badge
            variant="outline"
            className="border-amber-400/40 bg-amber-500/10 text-amber-300"
          >
            sem preço
          </Badge>
        )}
      </div>
      {resolved.source && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          origem: {resolved.source}
        </div>
      )}
    </div>
  );
}

function ManualPicker({
  settings,
  update,
  fmt,
  usedKeys,
  initial,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  fmt: MoneyFmt;
  usedKeys?: Set<string>;
  initial: string;
}): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CatalogModel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Debounce da busca.
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length === 0) {
      // Sem query: lista inicial com "você usa" primeiro + alguns do catálogo
      // vazio. A outra tarefa deve popular searchCatalog("", N) com pelo
      // menos os modelos mais comuns; se não devolver nada, mostramos só
      // os usados.
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        const base = await searchCatalog("", 30);
        setResults(base);
        setLoading(false);
      }, DEBOUNCE_MS);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const r = await searchCatalog(q, 30);
      setResults(r);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Fecha ao clicar fora.
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const choose = async (key: string): Promise<void> => {
    await update({ referenceModel: key, referenceMode: "manual" });
    setOpen(false);
  };

  // Ordena: usados primeiro, depois alfabético.
  const sorted = React.useMemo(() => {
    return [...results].sort((a, b) => {
      const ua = usedKeys?.has(a.key) ? 0 : 1;
      const ub = usedKeys?.has(b.key) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return a.name.localeCompare(b.name);
    });
  }, [results, usedKeys]);

  const display = initial || settings.referenceModel;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Buscar provedor ou modelo…"
            className="pl-8 pr-8"
            aria-label="Buscar modelo de referência"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {display && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden max-w-[200px] truncate rounded-md border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-200 sm:inline">
                {display}
              </span>
            </TooltipTrigger>
            <TooltipContent className="glass-strong max-w-xs text-xs">
              Modelo de referência atual
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-white/10 bg-[#0d0d1a]/95 shadow-lg backdrop-blur"
          >
            <ul className="max-h-72 overflow-y-auto py-1">
              {loading && (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">
                  Buscando…
                </li>
              )}
              {!loading && sorted.length === 0 && (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">
                  Nada encontrado para "{query}".
                </li>
              )}
              {!loading &&
                sorted.map((m) => {
                  const used = usedKeys?.has(m.key) ?? false;
                  const isCurrent = display === m.key;
                  return (
                    <li key={m.key}>
                      <button
                        type="button"
                        onClick={() => void choose(m.key)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5",
                          isCurrent && "bg-violet-500/10",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{m.name}</span>
                            {used && (
                              <Badge
                                variant="outline"
                                className="border-violet-400/40 bg-violet-500/10 px-1 py-0 text-[10px] text-violet-200"
                              >
                                você usa
                              </Badge>
                            )}
                            {isCurrent && (
                              <Check className="h-3 w-3 text-violet-300" />
                            )}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {m.providerLabel} · {m.key}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                          {typeof m.input === "number" &&
                          typeof m.output === "number" ? (
                            <>
                              <Money
                                usd={m.input}
                                fmt={fmt}
                                size="xs"
                                hideSecondary
                              />{" "}
                              /{" "}
                              <Money
                                usd={m.output}
                                fmt={fmt}
                                size="xs"
                                hideSecondary
                              />
                              <span className="ml-1 opacity-70">ent / sai · 1M</span>
                            </>
                          ) : (
                            <span className="opacity-70">sem preço</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}