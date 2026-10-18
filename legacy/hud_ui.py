"""
opencode HUD - tkinter window. Borderless, topmost, dark, draggable,
WS_EX_TOOLWINDOW (no taskbar), compact/expandido, context menu.
"""
import tkinter as tk
import tkinter.font as tkfont
import ctypes
import os
import sys
import time
import json
import logging

import hud_core

log = logging.getLogger('opencode_hud.ui')

BG       = '#1e1e1e'
PANEL    = '#252526'
FG       = '#e6e6e6'
ACCENT   = '#4ec9b0'
HILITE   = '#569cd6'
DIM      = '#9b9b9b'
WARN     = '#ce9178'
COST_G   = '#b5cea8'
SEP      = '#3a3a3a'
ERR      = '#f48771'
NO_RUN   = '#808080'

FONT_FAMILY = 'Consolas'
if sys.platform == 'win32':
    for cand in ('Consolas', 'Cascadia Mono', 'Cascadia Code',
                 'Lucida Console', 'Segoe UI Mono', 'Consolas'):
        try:
            tkfont.Font(family=cand, size=9)
            FONT_FAMILY = cand
            break
        except Exception:
            pass

F       = (FONT_FAMILY, 9)
FB      = (FONT_FAMILY, 9, 'bold')
FS      = (FONT_FAMILY, 8)
FSB     = (FONT_FAMILY, 8, 'bold')

# Use hud_core helpers
fmt_tokens = hud_core.fmt_tokens
fmt_usd    = hud_core.fmt_usd
fmt_brl    = hud_core.fmt_brl
fmt_age    = hud_core.fmt_age

WIN_W = 360
WIN_H_COMPACT = 56
MARGIN = 12

# ====================================================================
# Helpers
# ====================================================================
def _set_text(lbl, text, color=None):
    if color:
        try: lbl.configure(fg=color)
        except Exception: pass
    lbl.configure(text=text)

def _toggle_pack(widget, show):
    if show:
        widget.pack(fill='x', padx=8, pady=0)
    else:
        widget.pack_forget()

# ====================================================================
# Main HUD app
# ====================================================================
class HUDApp:
    def __init__(self):
        self.compact = False
        self.drag = None  # (x_root, y_root, win_x, win_y)
        self.cfg = {}
        self.cfg_mtime_seen = 0.0
        self.stats = hud_core.StatsCache()
        self.currency = hud_core.Currency()
        self.last_data_refresh = 0.0
        self.last_currency_refresh = 0.0
        self.last_opencode_check = 0.0
        self.opencode_running = None
        self.compact_var = None  # created inside _build_window after Tk()

        self._build_window()
        self._build_ui()
        self._reload_config(initial=True)
        self._refresh_loop()
        self._schedule_currency()

    # ----- window setup -----
    def _build_window(self):
        # DPI awareness
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

        self.root = tk.Tk()
        self.root.title('opencode HUD')
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.attributes('-alpha', 0.92)
        self.root.configure(bg=BG)
        self.root.minsize(WIN_W, 40)
        self.compact_var = tk.BooleanVar(value=False)
        self._restore_position()
        self.root.update_idletasks()

        # WS_EX_TOOLWINDOW (hide from taskbar)
        try:
            GWL_EXSTYLE = -20
            WS_EX_TOOLWINDOW = 0x00000080
            WS_EX_APPWINDOW  = 0x00040000
            user32 = ctypes.windll.user32
            user32.SetWindowPos.restype = ctypes.wintypes.BOOL
            user32.SetWindowPos.argtypes = [ctypes.wintypes.HWND, ctypes.c_void_p,
                                            ctypes.wintypes.INT, ctypes.wintypes.INT,
                                            ctypes.wintypes.INT, ctypes.wintypes.INT,
                                            ctypes.wintypes.UINT]
            hwnd = user32.GetParent(self.root.winfo_id()) or self.root.winfo_id()
            ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            new_ex = (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_ex)
            user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0,
                                0x0017)  # NOMOVE|NOSIZE|NOACTIVATE
        except Exception as e:
            log.warning('WS_EX_TOOLWINDOW setup: %s', e)

        # Bindings
        self.root.bind('<Button-1>', self._on_drag_start)
        self.root.bind('<B1-Motion>', self._on_drag_motion)
        self.root.bind('<ButtonRelease-1>', lambda e: self._save_position())
        self.root.bind('<Double-Button-1>', lambda e: self.toggle_compact())
        self.root.bind('<Button-3>', self._on_right_click)
        self.root.bind('<Map>', lambda e: self._reinforce_topmost())
        self.root.protocol('WM_DELETE_WINDOW', self._quit)

    def _on_drag_start(self, event):
        self.drag = (event.x_root, event.y_root,
                     self.root.winfo_x(), self.root.winfo_y())

    def _on_drag_motion(self, event):
        if not self.drag:
            return
        x0, y0, wx, wy = self.drag
        dx = event.x_root - x0
        dy = event.y_root - y0
        nx, ny = wx + dx, wy + dy
        # clamp onto primary screen
        try:
            sw = self.root.winfo_screenwidth()
            sh = self.root.winfo_screenheight()
            nx = max(0, min(nx, sw - WIN_W))
            ny = max(0, min(ny, sh - 40))
        except Exception:
            pass
        self.root.geometry(f'+{nx}+{ny}')

    def _on_right_click(self, event):
        menu = tk.Menu(self.root, tearoff=0, bg=BG, fg=FG,
                       activebackground=ACCENT, activeforeground=BG,
                       activeborderwidth=0, borderwidth=0)
        menu.add_command(label='Recarregar config', command=self._reload_config)
        menu.add_checkbutton(label='Modo compacto', variable=self.compact_var,
                             command=self.toggle_compact)
        menu.add_command(label='Resetar posição', command=self._reset_position)
        menu.add_separator()
        menu.add_command(label='Sair', command=self._quit)
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def toggle_compact(self):
        self.compact = not self.compact
        self.compact_var.set(self.compact)
        self._apply_compact()
        self._save_position()

    def _apply_compact(self):
        if self.compact:
            # hide all sections except header + compact summary row
            self._toggle_section(self.body_frame, False)
            self._toggle_section(self.compact_summary_frame, True)
            self.root.minsize(WIN_W, WIN_H_COMPACT)
        else:
            self._toggle_section(self.compact_summary_frame, False)
            self._toggle_section(self.body_frame, True)
            self.root.minsize(WIN_W, 180)
        self.root.update_idletasks()

    def _toggle_section(self, frame, show):
        try:
            if show:
                frame.pack(fill='x', padx=8, pady=0, after=self.header_frame)
            else:
                frame.pack_forget()
        except Exception as e:
            log.debug('toggle section: %s', e)

    def _restore_position(self):
        x, y = None, None
        try:
            if os.path.exists(hud_core.STATE_FILE):
                with open(hud_core.STATE_FILE, 'r', encoding='utf-8') as f:
                    st = json.load(f)
                x = int(st.get('x')); y = int(st.get('y'))
                self.compact = bool(st.get('compact', False))
                self.compact_var.set(self.compact)
        except Exception:
            pass
        if x is None or y is None:
            x, y = self._default_position()
        self.root.geometry(f'{WIN_W}x180+{x}+{y}')

    def _default_position(self):
        try:
            sw = self.root.winfo_screenwidth()
        except Exception:
            sw = 1920
        try:
            sh = self.root.winfo_screenheight()
        except Exception:
            sh = 1080
        return sw - WIN_W - MARGIN, MARGIN

    def _reset_position(self):
        x, y = self._default_position()
        self.root.geometry(f'+{x}+{y}')
        self._save_position()

    def _save_position(self):
        try:
            os.makedirs(hud_core.APP_DIR, exist_ok=True)
            st = {'x': self.root.winfo_x(),
                  'y': self.root.winfo_y(),
                  'compact': self.compact}
            with open(hud_core.STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(st, f)
        except Exception as e:
            log.debug('save state: %s', e)

    # ----- UI build -----
    def _build_ui(self):
        outer = tk.Frame(self.root, bg=BG, bd=0, highlightthickness=1,
                         highlightbackground=SEP)
        outer.pack(fill='both', expand=True, padx=1, pady=1)

        # ----- Header -----
        self.header_frame = tk.Frame(outer, bg=BG)
        self.header_frame.pack(fill='x', padx=8, pady=(6, 2))

        self.status_lbl = tk.Label(self.header_frame, text='·', font=FB,
                                   fg=NO_RUN, bg=BG, anchor='w')
        self.status_lbl.pack(side='left')
        self.header_title = tk.Label(self.header_frame, text='opencode HUD',
                                     font=FB, fg=FG, bg=BG, anchor='w')
        self.header_title.pack(side='left', padx=(6, 0))
        # Close icon
        self.close_lbl = tk.Label(self.header_frame, text='×', font=('Segoe UI', 11, 'bold'),
                                  fg=DIM, bg=BG, cursor='hand2')
        self.close_lbl.pack(side='right')
        self.close_lbl.bind('<Button-1>', lambda e: self._quit())
        self.close_lbl.bind('<Enter>', lambda e: self.close_lbl.configure(fg=ERR))
        self.close_lbl.bind('<Leave>', lambda e: self.close_lbl.configure(fg=DIM))

        # ----- Compact summary (hidden by default) -----
        self.compact_summary_frame = tk.Frame(outer, bg=BG)
        self.compact_summary_lbl = tk.Label(self.compact_summary_frame, text='...',
                                            font=F, fg=FG, bg=BG, justify='left',
                                            anchor='w')
        self.compact_summary_lbl.pack(fill='x', padx=8, pady=(2, 6))

        # ----- Body -----
        self.body_frame = tk.Frame(outer, bg=BG)
        self.body_frame.pack(fill='x', padx=8, pady=0)

        # Separator
        sep1 = tk.Frame(self.body_frame, bg=SEP, height=1)
        sep1.pack(fill='x', pady=(0, 4))
        sep2 = tk.Frame(self.body_frame, bg=SEP, height=1)
        sep2.pack(fill='x', pady=(4, 4))

        # Session section
        self._section_header(self.body_frame, 'Sessão atual')
        self.session_title_lbl = tk.Label(self.body_frame, text='(aguardando)',
                                          font=FS, fg=DIM, bg=BG, anchor='w',
                                          justify='left', wraplength=WIN_W-24)
        self.session_title_lbl.pack(fill='x', anchor='w')
        self.session_lines_frame = tk.Frame(self.body_frame, bg=BG)
        self.session_lines_frame.pack(fill='x')
        self.session_total_lbl = tk.Label(self.body_frame, text='', font=FB,
                                          fg=COST_G, bg=BG, anchor='w')
        self.session_total_lbl.pack(fill='x', anchor='w', pady=(2, 0))

        # Models configured
        self._section_header(self.body_frame, 'Modelos configurados')
        self.config_frame = tk.Frame(self.body_frame, bg=BG)
        self.config_frame.pack(fill='x')

        # Daily totals
        self._section_header(self.body_frame, 'Hoje')
        self.today_lbl = tk.Label(self.body_frame, text='', font=F, fg=FG,
                                  bg=BG, anchor='w', justify='left')
        self.today_lbl.pack(fill='x', anchor='w')
        self.today_brl_lbl = tk.Label(self.body_frame, text='', font=FS,
                                      fg=DIM, bg=BG, anchor='w')
        self.today_brl_lbl.pack(fill='x', anchor='w')

        # All-time totals
        self._section_header(self.body_frame, 'Total')
        self.total_lbl = tk.Label(self.body_frame, text='', font=F, fg=FG,
                                  bg=BG, anchor='w', justify='left')
        self.total_lbl.pack(fill='x', anchor='w')
        self.total_brl_lbl = tk.Label(self.body_frame, text='', font=FS,
                                      fg=DIM, bg=BG, anchor='w')
        self.total_brl_lbl.pack(fill='x', anchor='w')

        # footer (small print)
        self.footer_lbl = tk.Label(self.body_frame,
                                   text='\u2248 custo equivalente API',
                                   font=FS, fg=WARN, bg=BG, anchor='w')
        self.footer_lbl.pack(fill='x', anchor='w', pady=(4, 6))

        self._apply_compact()

    def _section_header(self, parent, text):
        lbl = tk.Label(parent, text=text, font=FSB, fg=HILITE, bg=BG,
                       anchor='w')
        lbl.pack(fill='x', anchor='w', pady=(4, 0))

    # ----- data refresh -----
    def _reload_config(self, initial=False):
        try:
            mt = hud_core.config_file_mtime()
            if initial or mt != self.cfg_mtime_seen or not self.cfg:
                self.cfg = hud_core.load_opencode_config()
                self.cfg_mtime_seen = mt
                self._render_config()
                if initial:
                    log.info('config loaded; agents=%s', [k for k in self.cfg if k != '_global'])
        except Exception as e:
            log.warning('reload config: %s', e)

    def _render_config(self):
        # Wipe previous rows
        for w in self.config_frame.winfo_children():
            w.destroy()
        g = self.cfg.get('_global', {})
        # Global line
        line = tk.Frame(self.config_frame, bg=BG)
        line.pack(fill='x', anchor='w')
        l = tk.Label(line, text='default', font=FS, fg=DIM, bg=BG, width=12, anchor='w')
        l.pack(side='left')
        l = tk.Label(line, text=g.get('model_short') or '?', font=FS,
                     fg=FG, bg=BG, anchor='w')
        l.pack(side='left')
        l2 = tk.Label(line, text='   small: ' + (g.get('small_model_short') or '?'),
                      font=FS, fg=DIM, bg=BG, anchor='w')
        l2.pack(side='left')
        # Per-agent lines (skip _global)
        for name, info in self.cfg.items():
            if name == '_global':
                continue
            line = tk.Frame(self.config_frame, bg=BG)
            line.pack(fill='x', anchor='w')
            tag = name + ('*' if info.get('inherited') else '')
            color = DIM if info.get('inherited') else FG
            model_short = info.get('model_short') or '?'
            full = info.get('model_full') or ''
            l = tk.Label(line, text=tag, font=FS, fg=ACCENT, bg=BG,
                         width=12, anchor='w')
            l.pack(side='left')
            l2 = tk.Label(line, text=model_short, font=FS, fg=color, bg=BG,
                          anchor='w')
            l2.pack(side='left')
            # tooltip via tooltip-like widget binding
            tip = f"{name}: {full}  ({info.get('mode')}, {info.get('source')})"
            self._bind_tooltip(l2, tip)
            self._bind_tooltip(l, tip)

    def _bind_tooltip(self, widget, text):
        # Lightweight tooltip (no ttk) — show on hover, hide after 4s
        tip = [None]
        def enter(e):
            tip[0] = tk.Toplevel(widget)
            tip[0].overrideredirect(True)
            tip[0].attributes('-topmost', True)
            tip[0].configure(bg='#333')
            lbl = tk.Label(tip[0], text=text, font=FS, fg='#eee', bg='#333',
                           padx=6, pady=2, justify='left')
            lbl.pack()
            x = widget.winfo_rootx() + widget.winfo_width() + 4
            y = widget.winfo_rooty()
            tip[0].geometry(f'+{x}+{y}')
        def leave(e):
            if tip[0] is not None:
                try: tip[0].destroy()
                except Exception: pass
                tip[0] = None
        widget.bind('<Enter>', enter, add='+')
        widget.bind('<Leave>', leave, add='+')

    def _refresh_loop(self):
        now = time.time()
        # refresh config if mtime changed (every ~10s)
        if now - self.last_currency_refresh > 10:
            self._reload_config()
            self.last_currency_refresh = now
        # refresh stats
        self.stats.update()
        # opencode process check ~ every 10s
        if now - self.last_opencode_check > 10:
            self.opencode_running = hud_core.is_opencode_running()
            self.last_opencode_check = now
        # render
        self._render_stats()
        # reaffirm topmost every cycle
        self._reinforce_topmost()
        self.root.after(3000, self._refresh_loop)

    def _schedule_currency(self):
        self.currency.refresh_async()
        self.root.after(6 * 3600 * 1000 // 4, self._schedule_currency)  # 6h-ish check
        # Also refresh at boot after 30s (give network a chance)
        self.root.after(30000, lambda: self.currency.refresh_async())

    def _reinforce_topmost(self):
        try:
            self.root.attributes('-topmost', True)
            self.root.lift()
            user32 = ctypes.windll.user32
            HWND_TOPMOST = -1
            SWP_NOMOVE = 0x0002; SWP_NOSIZE = 0x0001
            SWP_NOACTIVATE = 0x0010
            hwnd = self.root.winfo_id()
            user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        except Exception:
            pass

    def _render_stats(self):
        snap = self.stats.snapshot()
        bid, _ = self.currency.get()
        age_now_ms = int(time.time() * 1000)

        # Status header (opencode process)
        if self.opencode_running:
            _set_text(self.status_lbl, '\u25cf opencode', ACCENT)
        else:
            _set_text(self.status_lbl, '\u25cb idle', NO_RUN)
        # Title
        cs = snap.get('current_session')
        if cs:
            title = cs.get('title') or '(sem título)'
            upd = cs.get('time_updated') or 0
            age = fmt_age(upd, age_now_ms)
            header = f" {title[:42]}{'…' if len(title) > 42 else ''}"
            if age:
                header = f" ·{age}{header}"
            self.header_title.configure(text=header)
            self._render_session(cs, bid)
        else:
            self.header_title.configure(text=' (nenhuma sessão ativa)')
            self.session_title_lbl.configure(text='(sem sessão raiz encontrada)', fg=DIM)
            self._reset_session_lines()

        # Today + total
        self._render_totals('today', snap.get('today', {}), bid)
        self._render_totals('total', snap.get('total', {}), bid)

        # Compact summary
        self._render_compact_summary(snap, bid)

        # Update window height if needed (approx based on content)
        self.root.update_idletasks()
        try:
            # Anchor to top-right on first render
            pass
        except Exception:
            pass

    def _render_session(self, cs, bid):
        title = cs.get('title') or '(sem título)'
        self.session_title_lbl.configure(text=title, fg=FG)
        # Per-agent breakdown
        for w in self.session_lines_frame.winfo_children():
            w.destroy()
        buckets = cs.get('by_buckets') or {}
        ordered = sorted(buckets.items(), key=lambda kv: -kv[1].get('cost', 0))
        if not ordered:
            lbl = tk.Label(self.session_lines_frame, text='(sem movimento)',
                           font=FS, fg=DIM, bg=BG, anchor='w')
            lbl.pack(fill='x', anchor='w')
        for (agent, mkey), b in ordered:
            line = tk.Frame(self.session_lines_frame, bg=BG)
            line.pack(fill='x', anchor='w')
            agent_disp = agent
            model_short = hud_core.short_model_id(mkey.split('/', 1)[-1])
            tok = fmt_tokens(b.get('tokens', 0))
            cost_us = fmt_usd(b.get('cost', 0))
            text = f" {agent_disp}/{model_short}:  {tok}  {cost_us}"
            tip = (f"{agent} usando {mkey}\n"
                   f"input={b.get('input',0)}  output={b.get('output',0)}  "
                   f"reasoning={b.get('reasoning',0)}\n"
                   f"cache_read={b.get('cache_read',0)}  cache_write={b.get('cache_write',0)}\n"
                   f"cost USD={b.get('cost',0):.6f}")
            lbl = tk.Label(line, text=text, font=F, fg=FG, bg=BG, anchor='w')
            lbl.pack(side='left')
            self._bind_tooltip(lbl, tip)
        # Total
        total_tok = fmt_tokens(cs.get('total_tokens', 0))
        total_us = fmt_usd(cs.get('total_cost', 0))
        brl = cs.get('total_cost', 0) * bid
        total_brl = fmt_brl(brl)
        text = f" Total sessão:  {total_tok}  {total_us}  ≈ {total_brl}"
        self.session_total_lbl.configure(text=text)

    def _reset_session_lines(self):
        for w in self.session_lines_frame.winfo_children():
            w.destroy()
        self.session_total_lbl.configure(text='')

    def _render_totals(self, which, data, bid):
        total_tok = fmt_tokens(data.get('total_tokens', 0))
        total_us = fmt_usd(data.get('total_cost', 0))
        brl = data.get('total_cost', 0) * bid
        total_brl = fmt_brl(brl)
        if which == 'today':
            self.today_lbl.configure(text=f" {total_tok}  {total_us}")
            self.today_brl_lbl.configure(text=f" ≈ {total_brl}")
        else:
            self.total_lbl.configure(text=f" {total_tok}  {total_us}")
            self.total_brl_lbl.configure(text=f" ≈ {total_brl}")

    def _render_compact_summary(self, snap, bid):
        cs = snap.get('current_session')
        if cs:
            t = fmt_tokens(cs.get('total_tokens', 0))
            u = fmt_usd(cs.get('total_cost', 0))
            brl = fmt_brl(cs.get('total_cost', 0) * bid)
            sess = f"{t}  {u}  ≈ {brl}"
        else:
            sess = '--'
        td = snap.get('today', {})
        t = fmt_tokens(td.get('total_tokens', 0))
        u = fmt_usd(td.get('total_cost', 0))
        brl = fmt_brl(td.get('total_cost', 0) * bid)
        today = f"{t}  {u}  ≈ {brl}"
        txt = f" sessão: {sess}     hoje: {today}"
        self.compact_summary_lbl.configure(text=txt)

    # ----- close -----
    def _quit(self):
        try:
            self._save_position()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass
        sys.exit(0)

    def run(self):
        self.root.mainloop()

# Expose a small helper if module is run directly (rare; for --dump)
if __name__ == '__main__':
    print('This module is meant to be launched via hud.pyw')
    sys.exit(0)
