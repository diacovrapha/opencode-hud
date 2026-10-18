# opencode HUD

HUD desktop para acompanhar uso (tokens, custo, modelos) do [opencode](https://github.com/sst/opencode).

## v2 (Tauri 2 + React + TypeScript) — em desenvolvimento

Branch `v2-tauri`. A versão anterior em Python/tkinter foi para `legacy/`.

### Estrutura

- `src/` — frontend React + Vite + Tailwind v4 + shadcn/ui.
- `src-tauri/` — casca nativa em Rust + plugins oficiais do Tauri 2
  (`single-instance`, `autostart`, `notification`, `store`, `window-state`,
  `http`) e comandos para `opencode.db`/arquivos de configuração.
- `legacy/` — código Python/tkinter da v1 (mantido para referência).

### Comandos

- `npm install` — instala dependências JS.
- `npm run tauri:dev` — abre o app em modo dev (front + Rust).
- `npm run tauri:build` — gera um instalador.
- `cd src-tauri && cargo test --lib` — roda os testes Rust (incluindo um
  teste real que abre `opencode.db` em read-only e conta sessões).

### Versões

- Tauri 2.12.x (estável).
- React 19 + Vite 5 + TypeScript 5.6 (strict).
- Tailwind v4 + shadcn/ui (componentes copiados manualmente a partir do padrão).