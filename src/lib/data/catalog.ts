// Catálogo de modelos para a busca nas Configurações.
//
// Usa o `ModelIndex` já carregado pelo `RealDataSource` (sem reler os ~6 MB
// do `models.json` a cada busca). Para isso, o data source se REGISTRA como
// "source" através de `_setCatalogSource` no construtor — uma vez registrado,
// `searchCatalog` fica disponível para a UI sem precisar passar o índice.
//
// A função é `async` para dar flexibilidade ao data source (no futuro, pode
// fazer I/O para contar uso), mas hoje é completamente síncrona.
//
// Ordenação dos resultados:
//   1) `used` (true) antes;
//   2) com `query` não-vazia, por relevância (match em `name` > `modelId` >
//      `providerLabel` > `providerId`, posição no texto penalizada);
//   3) sem `query`, depois os populares (anthropic, openai, google, minimax,
//      deepseek, xai, github-copilot);
//   4) por `name` alfabeticamente.
//
// Fora do Tauri (mock), devolve uma lista pequena de exemplo.

import type { CatalogModel } from "./types";
import type { ModelIndex } from "./pricing";

export type CatalogSource = {
  /** Devolve o índice atual (ou `null` se ainda não carregado). */
  getModels(): ModelIndex | null;
  /** "provider/model" usado pelo usuário. Pode ser um Set já computado. */
  getUsedKeys(): Promise<Set<string>>;
};

let _source: CatalogSource | null = null;

/**
 * Chamado pelo `RealDataSource` ao montar (e `null` em testes para resetar).
 * NÃO exportado como parte do contrato público da UI — só data sources usam.
 */
export function _setCatalogSource(s: CatalogSource | null): void {
  _source = s;
}

/** Lista de provedores "populares" exibidos quando a busca está vazia. */
const POPULAR_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "minimax",
  "deepseek",
  "xai",
  "github-copilot",
];

/** Modelo de catálogo mínimo retornado quando não há data source (mock/navegador). */
const MOCK_CATALOG: CatalogModel[] = [
  { key: "anthropic/claude-sonnet-5-5", providerId: "anthropic", providerLabel: "Anthropic", modelId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", input: 3, output: 15, used: false },
  { key: "anthropic/claude-haiku-4-5", providerId: "anthropic", providerLabel: "Anthropic", modelId: "claude-haiku-4-5", name: "Claude Haiku 4.5", input: 0.8, output: 4, used: false },
  { key: "anthropic/claude-opus-4-7", providerId: "anthropic", providerLabel: "Anthropic", modelId: "claude-opus-4-7", name: "Claude Opus 4.7", input: 15, output: 75, used: false },
  { key: "minimax-coding-plan/coding-mini", providerId: "minimax-coding-plan", providerLabel: "MiniMax Coding Plan", modelId: "coding-mini", name: "Coding Mini", input: 0.4, output: 2, used: false },
  { key: "minimax-coding-plan/coding-pro", providerId: "minimax-coding-plan", providerLabel: "MiniMax Coding Plan", modelId: "coding-pro", name: "Coding Pro", input: 1, output: 5, used: false },
];

/**
 * Busca no catálogo. Quando chamada sem data source registrado (mock / sem
 * Tauri), devolve `MOCK_CATALOG` filtrada.
 */
export async function searchCatalog(
  query: string,
  limit: number = 30,
): Promise<CatalogModel[]> {
  if (!_source) {
    return filterMock(query, limit);
  }
  const idx = _source.getModels();
  if (!idx || idx.size === 0) return filterMock(query, limit);
  const usedKeys = await _source.getUsedKeys();
  return searchCatalogSync(query, idx, usedKeys, limit);
}

/**
 * Versão síncrona exposta para testes (e para o data source, que já tem tudo
 * em mãos). Quando a UI chama `searchCatalog`, ela já chama essa por baixo.
 */
export function searchCatalogSync(
  query: string,
  models: ModelIndex,
  usedKeys: Set<string>,
  limit: number = 30,
): CatalogModel[] {
  const q = query.trim().toLowerCase();
  // Para a busca com query, calculamos um score para ordenar.
  const rows: Array<CatalogModel & { _score: number }> = [];
  for (const [, entry] of models) {
    const providerMeta = models.providers.get(entry.providerId);
    const providerLabel = providerMeta?.name ?? providerMeta?.id ?? entry.providerId;
    const key = `${entry.providerId}/${entry.modelId}`;
    const used = usedKeys.has(key);
    const name = entry.modelId;
    let score = 0;
    if (q) {
      const haystack = `${name.toLowerCase()}\n${entry.modelId.toLowerCase()}\n${providerLabel.toLowerCase()}\n${entry.providerId.toLowerCase()}`;
      const idx = haystack.indexOf(q);
      if (idx < 0) continue;
      // Match no nome/modelId vale mais; mais cedo no texto vale mais.
      if (idx < name.length) score = 100 - idx;
      else if (idx < name.length + 1 + entry.modelId.length) score = 50 - idx;
      else score = 10 - idx;
    }
    rows.push({
      key,
      providerId: entry.providerId,
      providerLabel,
      modelId: entry.modelId,
      name,
      input: entry.cost.input,
      output: entry.cost.output,
      used,
      _score: score,
    });
  }

  rows.sort((a, b) => {
    // 1) usados
    if (a.used !== b.used) return a.used ? -1 : 1;
    // 2) com query: relevância; sem query: populares
    if (q) {
      if (a._score !== b._score) return b._score - a._score;
    } else {
      const ap = popularityRank(a.providerId);
      const bp = popularityRank(b.providerId);
      if (ap !== bp) return ap - bp;
    }
    // 3) nome (ou id) alfabético
    return a.name.localeCompare(b.name) || a.modelId.localeCompare(b.modelId);
  });

  return rows.slice(0, limit).map(({ _score, ...rest }) => rest);
}

function popularityRank(providerId: string): number {
  const idx = POPULAR_PROVIDERS.indexOf(providerId);
  return idx < 0 ? 1_000_000 : idx;
}

function filterMock(query: string, limit: number): CatalogModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return MOCK_CATALOG.slice(0, limit);
  return MOCK_CATALOG.filter((c) =>
    `${c.providerId} ${c.modelId} ${c.providerLabel} ${c.name}`.toLowerCase().includes(q),
  ).slice(0, limit);
}
