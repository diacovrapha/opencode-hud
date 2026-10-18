// Cotação USD→BRL.
//
// Persiste em um store do plugin-store (`usdbrl.json`) o último valor
// conhecido. Faz a consulta via `@tauri-apps/plugin-http` para
// https://economia.awesomeapi.com.br/json/last/USD-BRL (campo USDBRL.bid).
//
// Se a consulta falhar, devolvemos o valor persistido (mesmo que antigo)
// e marcamos o `updatedAt` original — a UI pode exibir "atualizado há 3h".

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { load, type Store } from "@tauri-apps/plugin-store";

import type { UsdBrlRate } from "./types";

const STORE_PATH = "usdbrl.json";
const STORE_KEY = "rate";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

const ENDPOINT = "https://economia.awesomeapi.com.br/json/last/USD-BRL";

let _store: Store | null = null;
let _inflight: Promise<UsdBrlRate | null> | null = null;

async function getStore(): Promise<Store | null> {
  if (_store) return _store;
  try {
    _store = await load(STORE_PATH, { autoSave: true });
    return _store;
  } catch {
    return null;
  }
}

async function readCached(): Promise<UsdBrlRate | null> {
  const store = await getStore();
  if (!store) return null;
  try {
    const v = await store.get<UsdBrlRate>(STORE_KEY);
    return v ?? null;
  } catch {
    return null;
  }
}

async function writeCached(rate: UsdBrlRate): Promise<void> {
  const store = await getStore();
  if (!store) return;
  try {
    await store.set(STORE_KEY, rate);
  } catch {
    // silencioso
  }
}

/**
 * Busca a cotação atual. Reusa uma promise em voo para não martelar a API
 * durante a janela de polling (5s).
 */
export async function fetchUsdBrl(): Promise<UsdBrlRate | null> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const cached = await readCached();
    const now = Date.now();
    if (cached && now - Date.parse(cached.updatedAt) < CACHE_TTL_MS) {
      return cached;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await tauriFetch(ENDPOINT, { method: "GET", signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { USDBRL?: { bid?: string | number } };
      const bidStr = json?.USDBRL?.bid;
      const bid = typeof bidStr === "string" ? parseFloat(bidStr) : bidStr;
      if (!bid || !Number.isFinite(bid)) throw new Error("parse error");
      const fresh: UsdBrlRate = { rate: bid, updatedAt: new Date().toISOString() };
      await writeCached(fresh);
      return fresh;
    } catch {
      // Falhou: usa cache, mesmo que antigo.
      return cached;
    }
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** Limpa o cache (útil em testes). */
export function _resetUsdBrlForTests(): void {
  _store = null;
  _inflight = null;
}