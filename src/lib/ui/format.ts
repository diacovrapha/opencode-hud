/**
 * Helpers de formatação: moeda, tokens, datas relativas e números.
 * Locale: pt-BR.
 */
import { formatDistanceToNowStrict, format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ---------- moeda ----------

export type MoneyFmt = {
  /** "BRL" ou "USD" */
  primary: "BRL" | "USD";
  /** Taxe USD→BRL; se null, só USD é mostrado e o caller deve avisar. */
  usdBrlRate: number | null;
  /** Quando a cotação foi obtida (ISO). */
  rateUpdatedAt?: string;
};

const BR_MANY = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

/**
 * Formata um número em pt-BR com N casas decimais (padrão 2).
 * Útil para o sufixo "R$ ..." em linhas curtas (cotação, totais).
 */
export function formatBrlNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtUsd(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtBrl(value: number, digits: number): string {
  const num = value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `R$ ${num}`;
}

export type MoneyOpts = {
  /** 0–6 casas decimais. Padrão: escolhe com base no tamanho. */
  digits?: number;
  /** Quando true, suprime o equivalente em USD (ex.: em cards secundários). */
  hideSecondary?: boolean;
  /** Quando true, devolve `<span>` em HTML com primary + secondary. */
  asHtml?: boolean;
};

export type MoneyResult = {
  primary: string;
  secondary: string | null;
  /** Texto pronto pra usar como tooltip explicando a métrica. */
  tooltip: string;
};

/**
 * Formata um custo (em USD) na moeda da UI, com secundário em USD quando
 * a moeda primária é BRL e há cotação disponível.
 */
export function formatMoney(usd: number, opts: MoneyFmt, o: MoneyOpts = {}): MoneyResult {
  const digits = o.digits ?? pickDigits(usd);
  let primary: string;
  let secondary: string | null = null;
  if (opts.primary === "BRL") {
    const brl = opts.usdBrlRate !== null ? usd * opts.usdBrlRate : null;
    if (brl !== null) {
      primary = fmtBrl(brl, digits);
      if (!o.hideSecondary) secondary = fmtUsd(usd, digits);
    } else {
      primary = fmtUsd(usd, digits);
    }
  } else {
    primary = fmtUsd(usd, digits);
    if (!o.hideSecondary && opts.usdBrlRate !== null) {
      secondary = fmtBrl(usd * opts.usdBrlRate, digits);
    }
  }
  return {
    primary,
    secondary,
    tooltip:
      opts.primary === "BRL" && opts.usdBrlRate === null
        ? "Cotação USD/BRL indisponível: mostrando apenas USD."
        : "",
  };
}

function pickDigits(value: number): number {
  // Dinheiro sempre com 2 casas (R$ 1,14), exceto valores grandes.
  return Math.abs(value) >= 10_000 ? 0 : 2;
}

// ---------- tokens ----------

const ONE_MILLION = 1_000_000;
const ONE_THOUSAND = 1_000;

/**
 * Formata uma quantidade de tokens em pt-BR, sem zeros inúteis:
 *   1.234.567 → "1,2 mi"
 *   135.000.000 → "135 mi"
 *   345.000   → "345 mil"
 *   999       → "999"
 */
export function formatTokens(n: number): string {
  return formatTokensShort(n);
}

/**
 * Versão curta: "1,2 mi", "563 mil", "999". Mantém consistência com a
 * versão longa — sem "k" solto, no máximo 1 casa decimal em "mi",
 * e zero casas em "mil".
 */
export function formatTokensShort(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= ONE_MILLION) {
    const v = n / ONE_MILLION;
    return `${v.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })} mi`;
  }
  if (abs >= ONE_THOUSAND) {
    return `${BR_MANY.format(Math.round(n / ONE_THOUSAND))} mil`;
  }
  return BR_MANY.format(Math.round(n));
}

export type TokenTotals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export function totalTokens(t: TokenTotals): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

// ---------- datas ----------

export function relativeDate(iso: string | number | Date): string {
  const d = new Date(iso);
  return formatDistanceToNowStrict(d, {
    addSuffix: true,
    locale: ptBR,
  });
}

export function absoluteDate(iso: string | number | Date, withTime = true): string {
  const d = new Date(iso);
  if (withTime) {
    return format(d, "dd 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
  }
  return format(d, "dd 'de' MMM 'de' yyyy", { locale: ptBR });
}

export function shortDate(iso: string | number | Date): string {
  return format(new Date(iso), "dd/MM", { locale: ptBR });
}

// ---------- números ----------

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((value / total) * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}