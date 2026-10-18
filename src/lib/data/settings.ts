// Persistência de Settings usando `@tauri-apps/plugin-store`.
//
// Hook `useSettings()` retorna o estado atual + um `update(partial)` que
// mescla o patch, salva e sincroniza o `autostart` com o plugin nativo.
//
// Quando rodando fora do Tauri (browser), as operações de store e autostart
// são silenciosamente ignoradas (mantendo o app funcionando em dev).
//
// A partir da v2, `providers` e `customPrices` são objetos.Record<string, ...>
// e DEVEM ser mesclados campo a campo no `update` — do contrário, um patch
// com `{ providers: { anthropic: ... } }` apagaria os outros provedores
// que já estavam salvos. As helpers (`setProviderSetting`, `setCustomPrice`,
// `completeOnboarding`) encapsulam essa regra.

import { create } from "zustand";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { load, type Store } from "@tauri-apps/plugin-store";

import {
  DEFAULT_SETTINGS,
  type CustomPrice,
  type ProviderSetting,
  type Settings,
} from "./types";

const STORE_PATH = "settings.json";
const STORE_KEY = "settings";

const SETTINGS_KEYS = [
  "budgetDaily",
  "budgetMonthly",
  "currency",
  "referenceModel",
  "referenceMode",
  "providers",
  "customPrices",
  "onboardingDone",
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

/** Faz merge profundo dos campos Record (providers/customPrices) sobre os defaults. */
function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS };
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    providers: mergeRecord(base.providers, saved.providers),
    customPrices: mergeRecord(base.customPrices, saved.customPrices),
  };
}

function mergeRecord<T>(
  base: Record<string, T>,
  saved: Record<string, T> | undefined,
): Record<string, T> {
  if (!saved) return { ...base };
  const out: Record<string, T> = { ...base };
  for (const [k, v] of Object.entries(saved)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Lê Settings do store, mesclando com os defaults (deep merge dos Records). */
export async function loadSettings(): Promise<Settings> {
  const store = await getStore();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const v = await store.get<Partial<Settings>>(STORE_KEY);
    return mergeSettings(v ?? null);
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

// ---------- helpers públicos para a UI ----------

/**
 * Atualiza (ou remove, com `setting` faltando `billing`) a configuração de UM
 * provedor, preservando todos os outros. Bypassa o "merge" do `update`
 * genérico (que só adiciona/atualiza entradas), porque o caller aqui manda o
 * `set` completo de providers.
 */
export async function setProviderSetting(
  providerId: string,
  setting: ProviderSetting,
): Promise<void> {
  const cur = useSettings.getState().settings;
  const nextProviders: Record<string, ProviderSetting> = { ...cur.providers };
  if (!setting || (setting as { billing?: unknown }).billing === undefined) {
    delete nextProviders[providerId];
  } else {
    nextProviders[providerId] = setting;
  }
  const next: Settings = { ...cur, providers: nextProviders };
  useSettings.setState({ settings: next });
  await saveSettings(next);
}

/**
 * Define (ou remove, com `price = null`) o preço manual de um modelo
 * ("provider/model"). Preserva os outros preços já salvos.
 */
export async function setCustomPrice(
  key: string,
  price: CustomPrice | null,
): Promise<void> {
  const cur = useSettings.getState().settings;
  const nextPrices: Record<string, CustomPrice> = { ...cur.customPrices };
  if (price === null) {
    delete nextPrices[key];
  } else {
    nextPrices[key] = price;
  }
  const next: Settings = { ...cur, customPrices: nextPrices };
  useSettings.setState({ settings: next });
  await saveSettings(next);
}

/**
 * Marca a tela de boas-vindas como concluída. Idempotente.
 */
export async function completeOnboarding(): Promise<void> {
  const cur = useSettings.getState().settings;
  if (cur.onboardingDone) return;
  const next: Settings = { ...cur, onboardingDone: true };
  useSettings.setState({ settings: next });
  await saveSettings(next);
}

// ---------- store (zustand) ----------

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
    const cur = get().settings;
    // Merge profundo dos Records: `partial.providers` é fundido com `cur.providers`,
    // não substituído. Sem essa regra, "atualizar 1 provedor" apagaria os outros.
    const nextProviders = mergeRecord(cur.providers, partial.providers);
    const nextPrices = mergeRecord(cur.customPrices, partial.customPrices);
    const next: Settings = {
      ...cur,
      ...partial,
      providers: nextProviders,
      customPrices: nextPrices,
    };
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
