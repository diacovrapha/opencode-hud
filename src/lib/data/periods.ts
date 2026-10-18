// Cálculo de janelas temporais (períodos, dias a renderizar, "hoje").
// Mantém apenas funções puras — sem dependência de Tauri — para que sejam
// testáveis com Vitest. Todos os horários são locais.

import type { PeriodKey } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Início do dia local de uma data (00:00:00.000). */
export function startOfLocalDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Início do dia de hoje (local). */
export function todayStart(now: Date = new Date()): Date {
  return startOfLocalDay(now);
}

/**
 * Início (inclusivo) do período `period` relativo a `now`, no fuso local.
 * Para `all`, retorna `null` (significa "sem limite inferior").
 */
export function periodStart(period: PeriodKey, now: Date = new Date()): Date | null {
  switch (period) {
    case "today":
      return startOfLocalDay(now);
    case "7d": {
      const d = startOfLocalDay(now);
      d.setDate(d.getDate() - 6);
      return d;
    }
    case "30d": {
      const d = startOfLocalDay(now);
      d.setDate(d.getDate() - 29);
      return d;
    }
    case "month": {
      const d = new Date(now.getTime());
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "all":
      return null;
  }
}

/**
 * Lista de dias (instantes `Date` no início do dia local) que devem
 * aparecer em `Snapshot.daily` para o período escolhido.
 *  - `today`: só hoje.
 *  - `7d` / `30d`: últimos N dias, incluindo hoje.
 *  - `month`: do dia 1 até hoje.
 *  - `all`: até os últimos 365 dias (clamp para o heatmap).
 */
export function listDailyDays(period: PeriodKey, now: Date = new Date()): Date[] {
  const today = startOfLocalDay(now);
  switch (period) {
    case "today":
      return [today];
    case "7d": {
      const out: Date[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today.getTime());
        d.setDate(d.getDate() - i);
        out.push(d);
      }
      return out;
    }
    case "30d": {
      const out: Date[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today.getTime());
        d.setDate(d.getDate() - i);
        out.push(d);
      }
      return out;
    }
    case "month": {
      const start = new Date(today.getTime());
      start.setDate(1);
      const out: Date[] = [];
      for (let d = new Date(start.getTime()); d.getTime() <= today.getTime(); d = new Date(d.getTime() + MS_PER_DAY)) {
        out.push(d);
      }
      return out;
    }
    case "all": {
      // Cap em 365 dias para evitar custo e alinhar com o heatmap.
      const out: Date[] = [];
      for (let i = 364; i >= 0; i--) {
        const d = new Date(today.getTime());
        d.setDate(d.getDate() - i);
        out.push(d);
      }
      return out;
    }
  }
}

/**
 * Limite inferior para a query SQL (em ms epoch) para um determinado
 * período. Diferente de `periodStart`, isto é útil para `WHERE time_created >= ?`.
 * Retorna `null` para `all`.
 */
export function periodStartMs(period: PeriodKey, now: Date = new Date()): number | null {
  const d = periodStart(period, now);
  return d === null ? null : d.getTime();
}

/** Quantos dias (inteiro ≥ 1) tem o mês da data `now`. */
export function daysInMonth(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/**
 * Fração do dia já decorrida em horário local (0 quando agora == 00:00:00,
 * ≈1 quando agora == 23:59:59). Sempre em [0, 1].
 */
export function fractionOfDayElapsed(now: Date = new Date()): number {
  const start = startOfLocalDay(now).getTime();
  const end = start + MS_PER_DAY;
  const t = now.getTime();
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / MS_PER_DAY;
}

/**
 * Dias decorridos no mês atual, contando o dia de hoje como fração.
 * Ex.: se hoje é dia 10 às 12h de um mês de 30 dias → 9.5.
 */
export function elapsedMonthDays(now: Date = new Date()): number {
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = startOfLocalDay(now);
  const fullDays = Math.round((today.getTime() - firstOfMonth.getTime()) / MS_PER_DAY);
  return Math.max(0, fullDays) + fractionOfDayElapsed(now);
}

/**
 * Converte um dia local em uma chave `YYYY-MM-DD` sem usar libs externas.
 * (Mantém um comportamento determinístico nos testes.)
 */
export function dayKey(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}