// Projeção mensal e checagem de alertas de orçamento.
//
// IMPORTANTE: a projeção é sobre o `cost` REAL (em USD), não sobre o
// `apiEquivalentCost` nem o `referenceCost`. Convertemos para a moeda
// configurada no momento da comparação com o orçamento.

import type { Budget, UsdBrlRate } from "./types";
import { daysInMonth, elapsedMonthDays } from "./periods";

/**
 * Projeção do mês: (gasto / dias decorridos, fração do dia de hoje inclusa)
 * × dias do mês. Garante no mínimo "1 dia decorrido" para evitar explosão
 * no início do mês (00:00:00 do dia 1).
 */
export function monthProjection(monthCostUsd: number, now: Date = new Date()): number {
  const elapsed = elapsedMonthDays(now);
  const safeElapsed = Math.max(elapsed, 1e-3);
  const total = daysInMonth(now);
  return (monthCostUsd / safeElapsed) * total;
}

/**
 * Converte USD para a moeda configurada usando a cotação mais recente.
 * Se a cotação for ausente e a moeda for BRL, devolve `null` para a UI
 * mostrar "—". Se for USD, devolve o próprio valor.
 */
export function convertUsd(
  amountUsd: number,
  currency: Budget["currency"],
  rate: UsdBrlRate | null,
): number | null {
  if (currency === "USD") return amountUsd;
  if (rate === null || !Number.isFinite(rate.rate) || rate.rate <= 0) return null;
  return amountUsd * rate.rate;
}

/**
 * Limites de alerta. Devolve os limites cruzados no formato
 * `["daily" | "monthly", threshold]`. O threshold é o limite que acabou
 * de ser atingido (0.8 ou 1.0).
 *
 * `costUsd` é o custo real (em USD) do período (hoje, ou mês até agora).
 */
export function crossedThresholds(
  costUsd: number,
  budget: Budget,
  rate: UsdBrlRate | null,
  scope: "daily" | "monthly",
): Array<0.8 | 1.0> {
  const limit = scope === "daily" ? budget.daily : budget.monthly;
  if (limit === undefined || limit <= 0) return [];
  const limitInUsd = budget.currency === "USD" ? limit : (rate ? limit / rate.rate : NaN);
  if (!Number.isFinite(limitInUsd) || limitInUsd <= 0) return [];
  const ratio = costUsd / limitInUsd;
  const out: Array<0.8 | 1.0> = [];
  if (ratio >= 1) out.push(1);
  else if (ratio >= 0.8) out.push(0.8);
  return out;
}