"""
opencode HUD - entry point.
- Single-instance via Windows named mutex (ctypes).
- --dump prints collected data to stdout (no window).
- Otherwise launches the tkinter window via hud_ui.
"""
import sys
import os
import argparse
import json
import time
import logging

import hud_core

log = logging.getLogger('opencode_hud.main')

def _dump_mode():
    """Print everything we know: config, stats, currency. No UI."""
    cfg = hud_core.load_opencode_config()
    stats = hud_core.read_stats()
    cur = hud_core.Currency()
    cur.refresh_async(force=False)
    # wait briefly for the first refresh
    deadline = time.time() + 2.5
    while time.time() < deadline and cur.ts < time.time() - 1:
        time.sleep(0.1)
    bid, ts = cur.get()
    cur.refresh_async(force=True)
    deadline = time.time() + 5.0
    while time.time() < deadline and cur.ts == ts:
        time.sleep(0.1)
    bid, ts = cur.get()

    print('=' * 72)
    print('CONFIGS / AGENTES')
    print('=' * 72)
    g = cfg.get('_global', {})
    print(f"default_agent     = {g.get('default_agent')}")
    print(f"model (padrão)    = {g.get('model_full')}  -> {g.get('model_short')}")
    print(f"small_model       = {g.get('small_model_full')}  -> {g.get('small_model_short')}")
    print()
    print("Agentes:")
    for name, info in cfg.items():
        if name == '_global': continue
        marker = '*' if info.get('inherited') else ' '
        print(f" {marker} {name:14s} model={info.get('model_full')}  "
              f"({info.get('model_short')})  mode={info.get('mode')}  "
              f"src={info.get('source')}")
    print("  (* = herdado do model padrão; sem .md e sem bloco em jsonc)")
    print()

    print('=' * 72)
    print('SESSÃO ATUAL (raiz + descendentes recursivos)')
    print('=' * 72)
    cs = stats.get('current_session')
    if cs:
        print(f"id      = {cs.get('id')}")
        print(f"title   = {cs.get('title')}")
        print(f"agent   = {cs.get('agent')}")
        print(f"upd     = {fmt_age_str(cs.get('time_updated') or 0)}")
        print('  Quebra por (agente/modelo):')
        for (agent, mkey), b in sorted((cs.get('by_buckets') or {}).items(),
                                        key=lambda kv: -kv[1].get('cost', 0)):
            print(f"   - {agent}  {mkey}")
            print(f"       tokens={b.get('tokens')}  cost=${b.get('cost'):.6f}"
                  f"  i/o/r/cR/cW = "
                  f"{b.get('input')}/{b.get('output')}/{b.get('reasoning')}/"
                  f"{b.get('cache_read')}/{b.get('cache_write')}")
        print(f"  TOTAL: tokens={cs.get('total_tokens')}  cost=${cs.get('total_cost'):.4f}"
              f"  ≈ R$ {cs.get('total_cost', 0) * bid:.2f}")
    else:
        print('  (nenhuma sessão raiz encontrada)')
    print()

    print('=' * 72)
    print('HOJE (time_created >= meia-noite local)')
    print('=' * 72)
    td = stats.get('today', {})
    print(f"tokens={td.get('total_tokens')}  cost=${td.get('total_cost'):.4f}"
          f"  ≈ R$ {td.get('total_cost', 0) * bid:.2f}")
    if td.get('by_buckets'):
        for (agent, mkey), b in sorted(td['by_buckets'].items(),
                                        key=lambda kv: -kv[1].get('cost', 0)):
            print(f"   {agent:10s} {mkey:50s} t={b.get('tokens'):>7d}  "
                  f"c=${b.get('cost'):.4f}")
    print()

    print('=' * 72)
    print('TOTAL (não-arquivadas)')
    print('=' * 72)
    tt = stats.get('total', {})
    print(f"sessões (linhas) inclusas no agregado")
    print(f"tokens={tt.get('total_tokens')}  cost=${tt.get('total_cost'):.4f}"
          f"  ≈ R$ {tt.get('total_cost', 0) * bid:.2f}")
    if tt.get('by_buckets'):
        for (agent, mkey), b in sorted(tt['by_buckets'].items(),
                                        key=lambda kv: -kv[1].get('cost', 0)):
            print(f"   {agent:10s} {mkey:50s} t={b.get('tokens'):>7d}  "
                  f"c=${b.get('cost'):.4f}")
    print()

    print('=' * 72)
    print('COTAÇÃO USD->BRL')
    print('=' * 72)
    print(f"bid = {bid:.4f}")
    print(f"ts  = {ts}  ({time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts)) if ts else 'never'})")
    print()

    print('=' * 72)
    print(f"último erro de DB: {stats.get('error')}")
    print('=' * 72)


def fmt_age_str(ms_ts):
    if not ms_ts:
        return ''
    now_ms = int(time.time() * 1000)
    diff = max(0, (now_ms - ms_ts) // 1000)
    if diff < 60: return f'{diff}s ago'
    if diff < 3600: return f'{diff//60}m ago'
    if diff < 86400: return f'{diff//3600}h ago'
    return f'{diff//86400}d ago'

def main():
    parser = argparse.ArgumentParser(description='opencode HUD')
    parser.add_argument('--dump', action='store_true',
                        help='Coleta e imprime dados sem abrir janela.')
    parser.add_argument('--no-instance-check', action='store_true',
                        help='NÃO usar mutex (apenas debug).')
    args = parser.parse_args()

    hud_core.setup_logging()

    # --dump NÃO deve adquirir/checar o mutex — só o modo janela deve.
    if args.dump:
        try:
            _dump_mode()
        except Exception as e:
            log.exception('dump failed')
            print('DUMP FAILED:', e, file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    if not args.no_instance_check:
        handle = hud_core.acquire_mutex('Local\\opencode-hud')
        if handle is None:
            # Outra instância já está rodando. Sai silenciosamente.
            log.info('Outra instância do HUD já está rodando. Saindo.')
            sys.exit(0)

    # launch UI
    try:
        import hud_ui
        app = hud_ui.HUDApp()
        log.info('HUD started (pid=%s)', os.getpid())
        app.run()
    except SystemExit:
        raise
    except Exception as e:
        log.exception('HUD crashed')
        try:
            # show error in a tk message box if possible
            import tkinter as tk
            from tkinter import messagebox
            r = tk.Tk(); r.withdraw()
            messagebox.showerror('opencode HUD', f'Erro fatal:\n{e}')
        except Exception:
            pass
        sys.exit(1)


if __name__ == '__main__':
    main()
