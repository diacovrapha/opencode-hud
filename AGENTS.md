# AGENTS.md

> Contexto rápido para agentes de IA e contribuidores. Este arquivo é
> carregado automaticamente pelo opencode. Tudo aqui é **público** e técnico;
> a memória local e pessoal vive em `C:\projetos\_memoria\` (ver `INDEX.md`).

## 1. O que é

Painel desktop (Tauri 2 + React) para Windows que mostra em tempo real quanto
você gasta (e economiza) usando o opencode. Lê o SQLite local do opencode em
modo somente leitura. **Versão atual: 0.3.0** (lida de `package.json`).

## 2. Stack

- **Tauri 2** (Rust) + `rusqlite` somente leitura + `sysinfo` (detecção do
  processo do opencode). Plugins: `single-instance`, `autostart`,
  `notification`, `store`, `window-state`, `http`, `opener`.
- **React 19 + TypeScript strict** com **Vite 5**.
- **Tailwind v4** + componentes baseados em shadcn/ui (copiados manualmente
  em `src/components/ui/`).
- **ECharts** (área, donut, barras, heatmap), **Motion** (animações),
  **Zustand** (settings).
- Testes: **Vitest** (`src/lib/data/*.test.ts`) e `cargo test --lib` (em `src-tauri/`).

## 3. Comandos

```powershell
npm install                       # deps do front
npm run test                      # Vitest (src/lib/data)
npx tsc -b --noEmit               # só checagem de tipos
npx vite build                    # build só do front (dist/)
cargo test --lib                  # testes Rust (em src-tauri/)
npx tauri build --debug --no-bundle   # build rápido (target/debug/opencode-hud.exe)
npx tauri build                   # release: .exe/.msi em src-tauri/target/release/bundle/
```

> No Windows, o `cargo` geralmente fica em `%USERPROFILE%\.cargo\bin` e pode
> não estar no `PATH` da sessão. Se não for reconhecido, faça antes:
> `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.

## 4. Mapa da arquitetura

- **`src/lib/data/`** — lógica pura e testada (Vitest):
  - `real.ts` — DataSource real (consome SQLite + `models.json` via IPC).
  - `mock.ts` — DataSource de exemplo, usado no `npm run dev` (navegador).
  - `aggregate.ts` — funções puras: breakdowns, daily, session tree.
  - `pricing.ts` — índice de preços + `FALLBACK_PROVIDERS` (assinatura → pay-as-you-go).
  - `providers.ts` — billing por provedor, "Seus provedores", catálogo de assinaturas.
  - `reference.ts` — resolve o modelo de referência (auto/manual).
  - `catalog.ts` — busca no `models.json` para o "Modelo de referência manual".
  - `periods.ts` — janelas temporais ("Hoje", 7d, 30d, mês, tudo).
  - `settings.ts` — persistência via plugin-store.
  - `budget.ts` / `budget-watcher.ts` — projeção do mês + alertas 80%/100%.
  - `usdbrl.ts` — cotação USD→BRL com cache de 6 h; `types.ts` — contrato de tipos.
- **`src/views/`** — `Dashboard.tsx`, `Widget.tsx`, `TitleBar.tsx` e
  `views/dashboard/*` (Overview, Models, Agents, Projects, Sessions, SettingsView).
- **`src/components/hud/`** — UI específica do HUD (KPIs, gráficos, tabelas).
- **`src/components/ui/`** — primitivos shadcn/ui (não mexer sem necessidade).
- **`src-tauri/src/`** — comandos nativos **genéricos** (não conhecem regras de negócio):
  - `commands.rs` — expõe `db_query` (somente leitura), `read_opencode_file` (whitelist), `opencode_running`, `opencode_status_cmd`, `db_path_info`.
  - `db.rs` — SQLite read-only com `progress_handler` (timeout 10 s); `opencode_files.rs` — leitura whitelisted de `models.json`, config e agents.
  - `paths.rs`, `process.rs`, `db_info.rs` — caminhos e detecção do opencode.
  - `lib.rs` — janela `dashboard` (escondida por padrão) + `widget` (always-on-top, sem decorações), bandeja, autostart, single-instance, posicionamento inicial do widget no canto superior direito.

**Regra:** lógica nova vai em **TypeScript** (`src/lib/data`) com testes
Vitest. O Rust fica mínimo — só comandos genéricos de IO/leitura.

## 5. Convenções

- UI em **pt-BR** (textos, mensagens de orçamento, ajuda).
- Valores monetários do Snapshot **sempre em USD** (`cost`,
  `apiEquivalentCost`, `projectedMonthCost`); a conversão para `BRL`/`USD`
  do usuário acontece na UI, em `src/lib/ui/format.ts`.
- `Aggregate.cost` = **gasto variável**: assinatura e gratuito contam 0,
  mesmo que o opencode tenha registrado um custo.
- Tipos/contrato centralizados em `src/lib/data/types.ts`. Nada de modelo
  ou provedor **fixo** na UI — usar o que veio do banco e do `models.json`.
- Catálogo de preços vem do `models.json` (`models.dev`), com fallback
  pay-as-you-go via `FALLBACK_PROVIDERS` e preços manuais (Avançado).

## 6. Armadilhas conhecidas (lições reais)

- O **terminal do agente espera todos os processos filhos**: NUNCA rode `npm run dev`, `vite`, `tauri dev` ou o `.exe` em primeiro plano (trava). Para abrir o app: `Invoke-CimMethod Win32_Process Create`; para inspecionar, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` + Playwright `connectOverCDP`; depois, `taskkill /IM opencode-hud.exe /T /F`.
- Comandos Tauri **síncronos** (`pub fn`) rodam na thread principal: todo comando deve ser `async` + `spawn_blocking` (antes travava toda a IPC).
- `sysinfo`: nunca `System::new_all()` em polling; atualize só processos, com cache.
- SQLite: a CTE recursiva precisa carregar o **id** do nó (descer por `parent_id = id` do nó, **nunca** da raiz), com limite de profundidade; há uma trava de 10 s por consulta via `progress_handler`.
- Datas: não converta `'YYYY-MM-DD ...'` com `CAST` para `INTEGER` (vira o ano); calcule o dia local em TypeScript.
- React: **hooks sempre antes de qualquer `return` condicional**.
- Tailwind v4: o bloco `@theme inline` em `src/index.css` é **obrigatório** para `bg-primary`/`bg-background` etc. existirem; o `Card` **não** usa `bg-card` — o fundo vem das classes `.glass`.
- As janelas declaradas em `tauri.conf.json` **já existem** no `setup`: `ensure_*` não pode retornar cedo sem posicionar. Posição em `PhysicalPosition` (`work_area` em pixels físicos). O `window-state` só grava ao sair normalmente.
- O **WebView2 transparente não desfoca a área de trabalho** (`backdrop-filter` não funciona): o fundo do widget precisa ser quase opaco.
- A build **debug** abre uma janela de console (normal; a release não abre).
- `--background`/`--autostart`: uma segunda instância **não abre** o dashboard. O autostart é regravado com o caminho do exe atual quando já está ligado.

## 7. Fluxo de release

1. Subir a versão em **três lugares** (a UI lê do `package.json`):
   `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
2. `npm install` (se houver mudança de deps), `npm run test`, `npx tsc -b --noEmit`.
3. `npx tauri build` — instaladores em `src-tauri/target/release/bundle/`
   (`.exe` NSIS e `.msi`).
4. **Renomear** para tirar espaços do `productName`
   (`opencode-hud_<versão>_x64-setup.exe` e `..._x64_en-US.msi`).
5. `SHA256SUMS.txt` + commit + push + `gh release create <tag> <artefatos> SHA256SUMS.txt`.