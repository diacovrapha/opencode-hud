// Persistência de Settings usando `@tauri-apps/plugin-store`.
//
// Hook `useSettings()` retorna o estado atual + um `update(partial)` que
// mescla o patch, salva e sincroniza o `autostart` com o plugin nativo.
//
// Quando rodando fora do Tauri (browser), as operações de store e autostart
// são silenciosamente ignoradas (mantendo o app funcionando em dev).

import { create } from "zustand";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { load, type Store } from "@tauri-apps/plugin-store";

import { DEFAULT_SETTINGS, type Settings } from "./types";

const STORE_PATH = "settings.json";
const STORE_KEY = "settings";

const SETTINGS_KEYS = [
  "budgetDaily",
  "budgetMonthly",
  "currency",
  "referenceModel",
  "refreshSeconds",
  "autostart",
  "widgetExpanded",
] as const;

let _store: Store | null = null;
let _autostartInFlight = false;

async function getStore(): Promise<Store | null> {
  if (_store) return _store;
  try {
    _store = await load(STORE_PATH, { autoSave: true });
    return _store;
  } catch {
    return null;
  }
}

/** Lê Settings do store, mesclando com os defaults. */
export async function loadSettings(): Promise<Settings> {
  const store = await getStore();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const v = await store.get<Partial<Settings>>(STORE_KEY);
    return { ...DEFAULT_SETTINGS, ...(v ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Já existe alguma configuração salva (ou seja, não é a primeira execução)? */
async function hasSavedSettings(): Promise<boolean> {
  const store = await getStore();
  if (!store) return true; // sem store (navegador): não mexe no autostart
  try {
    return (await store.get(STORE_KEY)) != null;
  } catch {
    return true;
  }
}

/** Persiste Settings no store. */
export async function saveSettings(s: Settings): Promise<void> {
  const store = await getStore();
  if (!store) return;
  try {
    await store.set(STORE_KEY, s);
  } catch {
    // silencioso
  }
}

/**
 * Sincroniza o estado do autostart do OS com o setting. Idempotente.
 * Se o valor já bate com o do OS, não faz nada.
 */
export async function syncAutostart(desired: boolean): Promise<void> {
  if (_autostartInFlight) return;
  _autostartInFlight = true;
  try {
    const enabled = await isAutostartEnabled().catch(() => null);
    if (enabled === null) return;
    if (enabled === desired) return;
    if (desired) await enableAutostart().catch(() => {});
    else await disableAutostart().catch(() => {});
  } finally {
    _autostartInFlight = false;
  }
}

type SettingsState = {
  settings: Settings;
  hydrated: boolean;
  update: (partial: Partial<Settings>) => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useSettings = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    const firstRun = !(await hasSavedSettings());
    const s = await loadSettings();
    if (firstRun) {
      // Primeira execução: liga o "iniciar com o Windows" (padrão do app)
      // e grava as configurações, para isso não acontecer de novo.
      await syncAutostart(s.autostart);
      await saveSettings(s);
    } else {
      // Depois disso, quem manda é o estado REAL do Windows: o usuário pode
      // ter desligado pelo menu da bandeja. Nunca religamos por conta própria.
      const osEnabled = await isAutostartEnabled().catch(() => null);
      if (osEnabled !== null && osEnabled !== s.autostart) {
        s.autostart = osEnabled;
        await saveSettings(s);
      }
      // Se está ligado, regrava a entrada para apontar para ESTE executável
      // (ex.: depois de instalar/atualizar, ou se antes rodava uma build de
      // desenvolvimento em outro caminho). Não muda a escolha do usuário.
      if (osEnabled) await enableAutostart().catch(() => {});
    }
    set({ settings: s, hydrated: true });
  },
  update: async (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    await saveSettings(next);
    if (partial.autostart !== undefined) {
      await syncAutostart(next.autostart);
    }
  },
}));

// Re-export para evitar que o linter reclame de chaves não usadas.
export const _SETTING_KEYS = SETTINGS_KEYS;

// Re-exporta o `runBudgetWatcher` para que consumidores que importam apenas
// este módulo (ex.: bridge de descoberta via `import.meta.glob`) consigam
// encontrá-lo. A implementação vive em `budget-watcher.ts`.
export { runBudgetWatcher } from "./budget-watcher";