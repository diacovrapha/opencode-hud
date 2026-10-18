# opencode HUD

Painel desktop para Windows que mostra em tempo real quanto você gasta (e
economiza) usando o [opencode](https://opencode.ai).

![version](https://img.shields.io/badge/version-0.3.0-7c3aed?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square&logo=windows&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![tauri](https://img.shields.io/badge/Tauri-2-24c8d8?style=flat-square&logo=tauri&logoColor=white)

> **English summary**: opencode HUD is a lightweight desktop panel (Tauri 2 +
> React + TypeScript) for Windows that reads opencode's local SQLite database
> read-only to show real-time cost, tokens, sessions, and savings. It bundles
> a tiny always-on-top widget plus a full dashboard with filters for today,
> 7/30 days, the current month, and all time, breakdowns by model, agent,
> project, and a session tree with sub-sessions. It works with **any provider
> supported by opencode** — the ones you actually use are detected from the
> database (names come from the `models.dev` table that opencode ships),
> and you can tag each one with its **billing type**: pay-as-you-go
> (`Por token`), subscription with a monthly fee in BRL or USD
> (`Assinatura`), or free/local (`Gratuito ou local`). Budget alerts fire
> at 80% and 100% via Windows notifications, USD/BRL rates come from
> `economia.awesomeapi.com.br`, and the only outbound network calls are the
> FX rate and an optional `models.dev` lookup. MIT licensed.

![dashboard-overview](docs/screenshots/dashboard-overview.png)

<table>
  <tr>
    <td><img src="docs/screenshots/widget.png" width="320" alt="widget compacto"></td>
    <td><img src="docs/screenshots/widget-expanded.png" width="320" alt="widget expandido"></td>
  </tr>
  <tr>
    <td align="center"><em>Widget no canto superior direito (compacto)</em></td>
    <td align="center"><em>Widget expandido, com top modelos, agentes e sessões</em></td>
  </tr>
</table>

## Por que existe

O opencode já registra custo e tokens em cada mensagem, mas não oferece uma
visão clara do total gasto nem de quanto a sua assinatura realmente economiza
em relação ao preço por token de cada modelo. O HUD lê esses mesmos dados
localmente e mostra três números lado a lado:

- **Gasto real (variável)** — só o que sai do seu bolso **por token**. É a
  soma do que o opencode registrou para provedores marcados como `Por token`
  (pay-as-you-go). **Provedores marcados como `Assinatura` ou `Gratuito ou
  local` contam 0 aqui**, mesmo que o opencode tenha registrado um custo —
  é o caso típico de **GitHub Copilot**, **Claude Pro/Max** e **ChatGPT
  Plus** quando você entra pelo login da conta: o opencode escreve um custo
  por token que você não paga de verdade.
- **Custo equivalente na API** — quanto custaria se você tivesse pagado por
  token em todos os modelos, incluindo os de assinatura. Para modelos em
  provedores de assinatura, o HUD procura o mesmo `modelId` em provedores
  pay-as-you-go equivalentes (via `FALLBACK_PROVIDERS` em
  `src/lib/data/pricing.ts`).
- **Suas assinaturas valem a pena?** — para cada assinatura você configura
  (com mensalidade em R$ ou US$), o card mostra o **múltiplo** entre o
  equivalente na API do mês e a mensalidade. Ex.: `2,5×` significa que o
  uso do mês, pago por token, sairia por 2,5 vezes o valor da assinatura
  — a assinatura se pagou (e sobrou).

## Recursos

- **Widget sempre visível** — uma janela compacta sem decorações, com
  *always-on-top*, posicionada automaticamente no canto superior direito
  do monitor principal. Arrastável por toda a superfície; pode ser
  expandida para mostrar top modelos, agentes e últimas sessões. Sai da
  barra de tarefas (`skipTaskbar: true`).
- **Dashboard completo** com filtros para **Hoje**, **7 dias**, **30 dias**,
  **Mês** e **Tudo**, e as seções:
  - **Visão geral** — KPIs (gasto real variável, custo equivalente na
    API, economia vs. referência, tokens), gráfico de gasto diário,
    distribuição por modelo (donut), calendário de uso (heatmap), top
    modelos no período, card de hoje com orçamento diário e projeção do
    mês, card "Suas assinaturas valem a pena?" e detalhe da sessão
    atual.
  - **Modelos** — barras por custo e por tokens, tabela completa com
    provider, tokens, custo, custo equivalente e referência.
  - **Agentes** — mesmas barras e tabela, mais a configuração lida de
    `opencode.jsonc`/`agents/*.md`.
  - **Projetos** — gasto agregado por diretório (última pasta do path).
  - **Sessões** — árvore com sub-sessões (filhos recursivos), detalhe ao
    lado e *breakdown* de tokens. Sub-sessões são somadas na raiz sem
    dupla contagem.
  - **Configurações** — *Seus provedores*, moeda (BRL/USD), orçamento
    diário e mensal, modelo de referência, preços manuais de modelos sem
    preço (Avançado), intervalo de polling (s), *autostart* e
    preferência expandida do widget.
- **Funciona com qualquer provedor do opencode** — Anthropic, OpenAI,
  Google, OpenRouter, MiniMax, Groq, Ollama, GitHub Copilot, providers
  locais (LM Studio, llama.cpp)… os **provedores são detectados
  automaticamente** pelo uso (a partir do `providerID`/`modelID` em cada
  mensagem gravada pelo opencode) e ganham nome legível a partir da
  tabela `models.json` que o próprio opencode já mantém (dados de
  `models.dev`). Não há lista hardcoded: se aparecer um provedor novo
  no seu uso, ele aparece aqui.
- **Seus provedores** (aba *Configurações*) — para cada provedor detectado,
  você diz **como você paga**, com um palpite inicial automático:
  - **Por token** — pago por uso na API do provedor (entra no gasto
    variável).
  - **Assinatura** — você paga uma mensalidade fixa (Copilot, Claude
    Pro/Max, ChatGPT Plus…). Informe a mensalidade em R$ ou US$ e ela
    aparece no card "Suas assinaturas valem a pena?".
  - **Gratuito ou local** — sem custo direto (Ollama, LM Studio,
    modelos locais).
  - O palpite vem de regras simples (sufixos `-plan`/`coding-plan`,
    nomes `ollama`/`lmstudio`/`llama.cpp`, e inspeção do `models.json`)
    e mostra um selo "palpite automático — confirme" até você confirmar.
- **Modelo de referência** — pode ser **automático** ou **manual**. No
  modo automático, o HUD lê o agente principal do opencode a partir de
  `default_agent` no `opencode.jsonc` (e do frontmatter em `agents/*.md`
  ou do campo `agent.<nome>.model`); se não achar, usa o `model` global
  do `opencode.jsonc`; em último caso cai no **modelo mais usado** nos
  últimos 30 dias (maior custo API-equivalente). No modo manual, você
  escolhe qualquer modelo através de uma **busca no catálogo inteiro**
  (todos os modelos do `models.json`, não só os que você já usou).
- **Preços manuais** (Avançado, em Configurações) — quando um modelo não
  tem preço na tabela `models.json` (modelos locais muito novos ou
  provedores pouco populares), a coluna "real" fica zerada e aparece um
  aviso. Você pode cadastrar um preço manual por 1M de tokens (entrada,
  saída, cache lido e cache escrito) e a comparação volta a funcionar
  imediatamente.
- **Orçamento com alertas do Windows** — ao cruzar **80%** e **100%** do
  limite diário ou mensal, dispara uma notificação nativa. Disparo único
  por limite por dia/mês (estado persistido em `budget-watcher.json`).
- **Projeção do mês** — gasto atual extrapolado pelos dias restantes,
  mostrado ao lado da barra de orçamento mensal.
- **Calendário de uso** — heatmap estilo GitHub para até 365 dias.
- **R$/US$ com cotação automática** — busca em `economia.awesomeapi.com.br`
  (USD→BRL), com cache local de 6 h e *fallback* silencioso para o último
  valor conhecido.
- **Ícone na bandeja** com menu para abrir/ocultar dashboard, mostrar/ocultar
  widget, alternar *autostart* e sair. Clique esquerdo abre o dashboard.
- **Inicia com o Windows** via plugin `tauri-plugin-autostart` (configurável
  pela tela de Configurações e pelo menu da bandeja). A escolha do usuário
  é respeitada — o HUD não religa sozinho se você desligar.
- **Instância única** — uma segunda execução do executável apenas traz a
  janela do dashboard para frente (via `tauri-plugin-single-instance`).
- **Leve** — instalador `.exe` (NSIS) com cerca de **3,4 MB**; usa o
  **WebView2** que já vem instalado no Windows 11. Em Windows 10 o HUD usa
  o WebView2 presente no sistema (ou baixa silenciosamente na primeira
  execução).

## Galeria

| Tela | |
|---|---|
| **Visão geral** | ![](docs/screenshots/dashboard-overview.png) |
| **Seus provedores: como você paga cada um** | ![](docs/screenshots/dashboard-providers.png) |
| **Modelos** | ![](docs/screenshots/dashboard-models.png) |
| **Agentes** | ![](docs/screenshots/dashboard-agents.png) |
| **Sessões** | ![](docs/screenshots/dashboard-sessions.png) |
| **Configurações** | ![](docs/screenshots/dashboard-settings.png) |

## Instalação

Baixe o instalador na página de
[Releases](https://github.com/diacovrapha/opencode-hud/releases/latest).
O artefato recomendado é `opencode-hud_0.3.0_x64-setup.exe` (instalador
NSIS por usuário, em `%LOCALAPPDATA%\opencode HUD`). O `.msi` está
disponível como alternativa.

> **Aviso sobre o SmartScreen.** Como o executável ainda **não é assinado
> digitalmente**, o Windows pode mostrar a tela "O Windows protegeu o
> computador". Clique em **Mais informações** → **Executar assim mesmo**
> para prosseguir. Esse aviso deve deixar de aparecer assim que o
> *signing* for configurado (veja o roadmap).

**Requisitos:**

- Windows 10 ou 11 (x64).
- **WebView2 Runtime** — já vem pré-instalado no Windows 11. Em Windows 10,
  a presença é detectada na primeira execução e o download silencioso é
  iniciado, se necessário.
- **opencode** instalado e com pelo menos uma sessão registrada — o HUD lê
  o banco local dele (veja a próxima seção).

## Como funciona e o que sai do seu PC

O HUD lê **apenas em modo leitura** o banco SQLite local do opencode em
`%USERPROFILE%\.local\share\opencode\opencode.db`. A camada nativa em Rust
(`src-tauri/src/db.rs`) abre o banco com `SQLITE_OPEN_READ_ONLY`, valida
que cada consulta enviada pelo front começa com `SELECT` ou `WITH`, rejeita
`;` no meio da query e impõe um **timeout de 10 s** via `progress_handler`
(consultas runaway são abortadas em vez de travar a thread).

O HUD também lê, do mesmo jeito, três arquivos que o próprio opencode já
guarda em disco:

- `%USERPROFILE%\.cache\opencode\models.json` — tabela de preços por modelo
  (dados de `models.dev`), usada para calcular custo equivalente na API e
  o custo no modelo de referência. Parseado uma vez e mantido em índice
  em memória, recarregado a cada 6 h.
- `%USERPROFILE%\.config\opencode\opencode.jsonc` (ou `.json`) — para
  identificar o modelo configurado em cada agente e resolver o modelo de
  referência no modo automático.
- `%USERPROFILE%\.config\opencode\agents\*.md` — agentes personalizados.

**As únicas chamadas de rede que o HUD faz** são:

1. A cotação USD→BRL em `https://economia.awesomeapi.com.br/json/last/USD-BRL`.
2. Nada mais obrigatório. Opcionalmente, se o `models.json` do opencode
   ainda não estiver presente no host, o front pode disparar uma busca em
   `models.dev` — comportamento idêntico ao do opencode.

Nenhum conteúdo das suas conversas, prompts ou respostas sai do seu PC.
O HUD só lê `cost`, `tokens`, `providerID`, `modelID`, `agent` e
metadados de sessão que o opencode já grava localmente.

### Como os números são calculados

#### Regra de cobrança (por provedor)

O **gasto real variável** (coluna `cost`) é regido pelo tipo de cobrança
que você marcou para cada provedor em **Configurações → Seus provedores**:

- **Por token** — `cost = custo registrado` se o opencode gravou um valor
  maior que zero; senão `cost = tokens × preço (entrada/saída/cache)`.
- **Assinatura** — `cost = 0`. Você paga uma mensalidade fixa; o uso do
  provedor **não entra** no gasto variável, mesmo que o opencode tenha
  registrado um custo. A mensalidade entra no card **Suas assinaturas
  valem a pena?** e o uso entra no custo equivalente na API.
- **Gratuito ou local** — `cost = 0`. Modelos sem custo direto (Ollama,
  LM Studio, etc.) não entram no gasto variável, mas continuam contando
  para o custo equivalente (se houver preço de API conhecido) e para
  o total de tokens.

O **custo equivalente na API** (coluna `apiEquivalentCost`) é sempre
`max(registrado, tokens × preço)` — ou seja, mesmo em assinatura ele usa
o preço *pay-as-you-go* para te mostrar quanto você teria pago se não
tivesse a assinatura.

#### Prioridade de preços (por modelo)

Para cada par `provider/model`, o preço usado segue a ordem:

1. **Preço manual** que você cadastrou em *Configurações → Preços
   manuais* (por 1M de tokens, com `input`/`output`/`cacheRead`/
   `cacheWrite` separados). Tem prioridade máxima e sobrescreve qualquer
   outra fonte.
2. **Tabela `models.json` do opencode** (via `findPrice` em
   `src/lib/data/pricing.ts`). É a tabela que o próprio opencode consome
   de `models.dev`.
3. **Fallback pay-as-you-go** para modelos em provedores de assinatura:
   `models.json` geralmente traz preço 0 nesses casos (ex.: `coding-mini`
   em `minimax-coding-plan`), então o HUD procura o mesmo `modelId` em
   provedores pay-as-you-go equivalentes listados em `FALLBACK_PROVIDERS`
   (ex.: `minimax-coding-plan` → `minimax`). Se encontrar, usa esse preço
   como o "pay-as-you-go equivalente" e marca o lookup como `fallback`.
   Se não encontrar nenhum dos três, marca o grupo como `priceMissing` e
   o valor fica zerado (até você cadastrar um preço manual).

#### Demais regras

- **Referência** — o mesmo cálculo de tokens, mas usando o modelo de
  referência (automático ou manual; padrão `anthropic/claude-sonnet-5-5`).
- **"Hoje"** — é o dia local da *mensagem* (`time_created`), não da sessão
  inteira: uma mensagem gravada às 23:50 conta em "hoje" mesmo que a
  sessão tenha sido aberta ontem.
- **Sub-sessões** — somadas no aggregate da raiz; cada nó contribui
  *apenas* seu próprio aggregate, evitando dupla contagem.

## Integração com o opencode (opcional)

Para garantir que o HUD esteja aberto quando o opencode inicia, o repositório
irmão
[`opencode-config`](https://github.com/diacovrapha/opencode-config)
disponibiliza o arquivo
[`plugins/hud-launcher.js`](https://github.com/diacovrapha/opencode-config/blob/main/plugins/hud-launcher.js).
Basta copiar o arquivo para `~/.config/opencode/plugins/` (ou referenciá-lo
pela sua config) e ele será carregado automaticamente.

O plugin passa o argumento `--background` ao executar o HUD. Se o HUD já
estiver aberto, esse argumento é detectado por
`is_background_launch` em `src-tauri/src/lib.rs` e a chamada não cria uma
segunda janela. Caso contrário, o HUD abre em modo normal (dashboard
escondido e widget visível).

## Desenvolvimento

**Stack:**

- **Tauri 2** (Rust, `rusqlite` em modo somente leitura + `sysinfo` para
  detectar processos do opencode) e os plugins oficiais
  `single-instance`, `autostart`, `notification`, `store`,
  `window-state`, `http` e `opener`.
- **React 19 + TypeScript** (strict) com **Vite 5**.
- **Tailwind v4** e componentes baseados em **shadcn/ui** (copiados
  manualmente).
- **ECharts** para os gráficos de área, barras e *donut*; **Motion** para
  animações e **Zustand** para o estado de configurações.
- Testes em **Vitest** (lógica pura em `src/lib/data/*.test.ts`).

**Pré-requisitos:**

- **Node.js 20+**
- **Rust** (`stable-msvc` no Windows)
- **Visual Studio Build Tools** com a workload *C++* (para compilar o
  *crate* Rust em Windows).

**Comandos úteis:**

```bash
npm install                 # instala as deps do front
npm run test                # roda a suíte Vitest
npx tsc -b --noEmit         # só checagem de tipos
npx tauri dev               # dev: front + nativo juntos
npx tauri build             # gera o .exe e o .msi em src-tauri/target/release/bundle/
```

Os testes Rust ficam em `src-tauri/` e podem ser rodados com
`cd src-tauri && cargo test --lib` (um dos testes abre o `opencode.db`
real em modo somente leitura; se o banco não existir, o teste é pulado).

**Estrutura de pastas (resumida):**

```
src/
  lib/data/          lógica de dados pura e testada (Vitest)
    real.ts          DataSource que consome o SQLite + models.json
    aggregate.ts     funções puras (breakdowns, daily, session tree)
    pricing.ts       índice de preços + fallback de assinatura → pay-as-you-go
    providers.ts     billing por provedor, "Seus provedores", catálogo de
                     assinaturas
    reference.ts     resolução do modelo de referência (auto/manual)
    catalog.ts       busca no models.json para "Modelo de referência manual"
    periods.ts       janelas temporais ("hoje", 7d, 30d, mês, tudo)
    settings.ts      persistência de Settings (plugin-store)
    budget.ts        projeção do mês + checagem de limites
    budget-watcher.ts notificações nativas ao cruzar 80% e 100%
    usdbrl.ts        cotação USD→BRL com cache de 6 h
  views/             telas (Dashboard, Widget) e seções do dashboard
  components/        HUD + componentes UI
src-tauri/
  src/
    commands.rs      comandos IPC: db_query, read_opencode_file,
                     opencode_running, opencode_status_cmd, db_path_info
    db.rs            SQLite read-only com trava de tempo
    paths.rs         caminhos do opencode (db, models.json, config, agents)
    process.rs       detecção leve do processo do opencode
    opencode_files.rs leitura whitelisted (models, config, agents)
```

> **Rodando no navegador** (`npm run dev`), a UI usa dados de exemplo
> (mock) já que não há Tauri/IPC. Tudo o que envolve o banco de verdade
> só funciona dentro do app compilado (`npx tauri dev` ou `tauri build`).

## Roadmap

- Assinatura digital do executável para eliminar o aviso do Windows.
- Auto-update integrado.
- Mais idiomas além de pt-BR.

Sem prazos definidos — itens podem entrar e sair conforme a demanda.

## Licença

[MIT](LICENSE) — © 2026 diacovrapha.
