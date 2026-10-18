// Watcher de orçamento.
//
// Dispara uma notificação do Windows ao cruzar 80% e 100% do budget
// diário e mensal. Rastreia quais limites já foram notificados (no store)
// para garantir no máximo 1 disparo por limite por dia/mês.
//
// Esse módulo deve ser chamado pela UI no widget (UMA janela apenas),
// para evitar duplicação.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { load, type Store } from "@tauri-apps/plugin-store";

import { crossedThresholds } from "./budget";
import type { Budget, UsdBrlRate } from "./types";

const STORE_PATH = "budget-watcher.json";
const STORE_KEY = "notified";
const PERMS_REQUESTED_KEY = "permissionsRequested";

type NotifiedRecord = {
  /** chave = "daily:YYYY-MM-DD:threshold" ou "monthly:YYYY-MM:threshold" */
  entries: Record<string, true>;
};

let _store: Store | null = null;

async function getStore(): Promise<Store | null> {
  if (_store) return _store;
  try {
    _store = await load(STORE_PATH, { autoSave: true });
    return _store;
  } catch {
    return null;
  }
}

async function loadNotified(): Promise<NotifiedRecord> {
  const store = await getStore();
  if (!store) return { entries: {} };
  try {
    const v = await store.get<NotifiedRecord>(STORE_KEY);
    return v ?? { entries: {} };
  } catch {
    return { entries: {} };
  }
}

async function saveNotified(record: NotifiedRecord): Promise<void> {
  const store = await getStore();
  if (!store) return;
  try {
    await store.set(STORE_KEY, record);
  } catch {
    // silencioso
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const store = await getStore();
      if (store) {
        const asked = await store.get<boolean>(PERMS_REQUESTED_KEY);
        if (!asked) {
          const res = await requestPermission().catch(() => "denied" as const);
          granted = res === "granted";
          await store.set(PERMS_REQUESTED_KEY, true);
        }
      } else {
        const res = await requestPermission().catch(() => "denied" as const);
        granted = res === "granted";
      }
    }
    return granted;
  } catch {
    return false;
  }
}

function dayKey(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKey(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Avalia o orçamento e dispara notificações para os limites recém-cruzados.
 * Não bloqueia; qualquer falha é silenciosa (a UI continua funcionando).
 *
 * `dailyCostUsd` / `monthlyCostUsd` devem ser o custo real (em USD) do
 * respectivo período (já calculado no snapshot).
 */
export async function runBudgetWatcher(
  dailyCostUsd: number,
  monthlyCostUsd: number,
  budget: Budget,
  rate: UsdBrlRate | null,
  now: Date = new Date(),
): Promise<void> {
  const dailyThresholds = crossedThresholds(dailyCostUsd, budget, rate, "daily");
  const monthlyThresholds = crossedThresholds(monthlyCostUsd, budget, rate, "monthly");
  if (dailyThresholds.length === 0 && monthlyThresholds.length === 0) return;

  const notified = await loadNotified();
  const dk = dayKey(now);
  const mk = monthKey(now);
  const newKeys: string[] = [];
  for (const t of dailyThresholds) {
    const k = `daily:${dk}:${t}`;
    if (!notified.entries[k]) {
      notified.entries[k] = true;
      newKeys.push(`daily:${dk}:${t}`);
    }
  }
  for (const t of monthlyThresholds) {
    const k = `monthly:${mk}:${t}`;
    if (!notified.entries[k]) {
      notified.entries[k] = true;
      newKeys.push(`monthly:${mk}:${t}`);
    }
  }
  if (newKeys.length === 0) return;
  await saveNotified(notified);

  const granted = await ensureNotificationPermission();
  if (!granted) return;

  const currencyLabel = budget.currency === "USD" ? "US$" : "R$";
  const rateUsed = budget.currency === "USD"
    ? 1
    : (rate?.rate ?? 0);
  const fmt = (usd: number): string => {
    if (!Number.isFinite(rateUsed) || rateUsed <= 0) return `${usd.toFixed(2)} USD`;
    return `${currencyLabel} ${(usd * rateUsed).toFixed(2)}`;
  };
  const dailyLimit = budget.daily;
  const monthlyLimit = budget.monthly;

  for (const k of newKeys) {
    const [scope, , threshStr] = k.split(":");
    const t = parseFloat(threshStr);
    const pct = Math.round(t * 100);
    if (scope === "daily") {
      sendNotification({
        title: `opencode · ${pct}% do orçamento diário`,
        body: dailyLimit
          ? `Hoje: ${fmt(dailyCostUsd)} de ${fmt(dailyLimit)}.`
          : `Hoje: ${fmt(dailyCostUsd)}.`,
      });
    } else {
      sendNotification({
        title: `opencode · ${pct}% do orçamento mensal`,
        body: monthlyLimit
          ? `Mês: ${fmt(monthlyCostUsd)} de ${fmt(monthlyLimit)}.`
          : `Mês: ${fmt(monthlyCostUsd)}.`,
      });
    }
  }
}