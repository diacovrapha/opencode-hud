# opencode HUD

Pequeno aplicativo desktop (tkinter, apenas stdlib) para Windows que mostra, em uma janela sempre visível no canto superior direito da tela:

- **Modelos configurados por agente** (de `~/.config/opencode/opencode.jsonc` e de `~/.config/opencode/agents/*.md`), exibidos com nomes curtos ("Opus 5.5", "M3", "M2.7-hs") e tooltip com o id completo.
- **Tokens e custo da SESSÃO ATUAL** (a sessão raiz mais recente + todos os descendentes recursivamente, somando agente/M3, chefe/Opus etc.).
- **Tokens e custo de HOJE** e **TOTAL** (somando todas as sessões não-arquivadas).
- **Cotação USD→BRL** obtida em background em https://economia.awesomeapi.com.br/json/last/USD-BRL , com cache em arquivo JSON (válido por 6 h, fallback para 5,50).
- Indicador se o opencode.exe está rodando e título da sessão atual.
- Aviso visual "≈ custo equivalente API" (o usuário pode usar plano de assinatura, então o custo real é só uma referência).

## Como lançar

```
"C:\Python315\pythonw.exe" "C:\projetos\opencode-hud\hud.pyw"
```

(Usar `python.exe` em vez de `pythonw.exe` faz abrir com janela de console — útil pra depurar.)

O aplicativo respeita **instância única** via mutex nomeado do Windows (`Local\opencode-hud`). Se já houver uma instância rodando, a segunda sai silenciosamente (log registrado).

## Modos de operação

- **Expandido (padrão)**: mostra tudo — modelos, sessão atual com quebra por agente, hoje, total, cotação.
- **Compacto**: uma linha só (`sessão: X ≈ R$ Y   hoje: X ≈ R$ Y`). Alterna com **clique duplo** na janela.
- Arrastar com botão esquerdo para mover; posição é salva em `%LOCALAPPDATA%\opencode-hud\state.json` e restaurada.
- Botão direito: `Recarregar config`, `Modo compacto`, `Resetar posição`, `Sair`.
- O botão `×` no canto fecha a aplicação.

## Atualização automática

- Estatísticas e cotação a cada 3 s.
- Config (jsonc/agents/*.md): relida quando `mtime` muda (≈ a cada 10 s) ou sob demanda via menu.
- Checagem do processo `opencode.exe` via `tasklist` a cada 10 s.
- Topost refirmado a cada ciclo (o Windows às vezes "perde" o `-topmost`).

## Modo de depuração: `--dump`

Imprime no console tudo que o HUD coleta, sem abrir janela:

```
"C:\Python315\python.exe" "C:\projetos\opencode-hud\hud.pyw" --dump
```

Útil para validar rapidamente os dados com a saída de `opencode stats`.

## O que o HUD **NÃO** faz

- Não escreve em `opencode.db` (somente leitura, abre e fecha a cada ciclo, tolera "database is locked").
- Não usa bibliotecas externas (`pip` não é necessário).
- Não aparece na barra de tarefas (usa `WS_EX_TOOLWINDOW` via `ctypes`).

## Dependências

- Windows 10/11
- Python 3.15 (testado em `C:\Python315\python.exe`)
- Tkinter (vem com o Python)
- SQLite3 (vem com o Python)

## Arquivos

| Arquivo            | Função                                                              |
|--------------------|----------------------------------------------------------------------|
| `hud.pyw`          | Ponto de entrada. Faz argparse, mutex e `--dump` ou abre a UI.       |
| `hud_core.py`      | Parser JSONC, frontmatter YAML dos agentes, leitura do DB (read-only), cotação USD→BRL com cache, formatação, logging com rotação. |
| `hud_ui.py`        | Janela tkinter (overrideredirect, topmost, WS_EX_TOOLWINDOW, drag, menu de contexto, modo compacto). |
| `README.md`        | Este arquivo. |
| `_discover_schema.py` | (dev) Listou tabelas/colunas de `opencode.db`.                   |
| `_inspect_data.py`    | (dev) Inspecionou amostras de dados das tabelas `session` e `message`. |

## Arquivos gerados em tempo de execução

Em `%LOCALAPPDATA%\opencode-hud\`:

- `hud.log` (com rotação: `.1`, `.2`, `.3`)
- `state.json` (posição da janela + modo compacto)
- `usdbrl_cache.json` (cotação)

## Limitações conhecidas

- O custo de modelos cobertos por **plano de assinatura** (ex.: `minimax-coding-plan`) vem como `0` no banco. O HUD mostra os tokens consumidos normalmente; a linha "≈ custo equivalente API" deixa claro que o valor é referência de preço de API, não cobrança real.
- O token total = input + output + reasoning + cache.read + cache.write; detalhe aparece em tooltip.
- Sem ícones/asset gráfico (a janela é minimalista por design). Se quiser personalizar, edite as constantes em `hud_ui.py` (`BG`, `FG`, `FONT`, etc.).
- O `tasklist` é chamado a cada 10 s; em ambientes sem `opencode.exe` ele apenas retorna `False` (não crasha).
