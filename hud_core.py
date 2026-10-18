"""
opencode HUD - core (config, db stats, USD->BRL currency). Stdlib only.
NUNCA escreve em opencode.db. Acessa em modo read-only com timeout,
abre/fecha a cada ciclo, tolera "database is locked" sem crashar.
"""
import os
import sys
import json
import re
import time
import threading
import subprocess
import urllib.request
import urllib.error
import sqlite3
import ctypes
import ctypes.wintypes
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime

# ---- paths ----
APP_NAME = 'opencode-hud'
APP_DIR = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), APP_NAME)
DB_PATH = os.path.expanduser('~/.local/share/opencode/opencode.db')
CFG_DIR = os.path.expanduser('~/.config/opencode')
CFG_FILE = os.path.join(CFG_DIR, 'opencode.jsonc')
AGENT_DIRS = [os.path.join(CFG_DIR, 'agents'), os.path.join(CFG_DIR, 'agent')]
CACHE_FILE = os.path.join(APP_DIR, 'usdbrl_cache.json')
STATE_FILE = os.path.join(APP_DIR, 'state.json')
LOG_FILE = os.path.join(APP_DIR, 'hud.log')

log = logging.getLogger('opencode_hud.core')

# ====================================================================
# JSONC parser (state-machine, respects strings w/ //://, https://...)
# ====================================================================
def strip_jsonc(text: str) -> str:
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i+1] if i+1 < n else ''
        if c == '"':
            out.append(c); i += 1
            while i < n:
                cc = text[i]
                if cc == '\\' and i + 1 < n:
                    out.append(cc); out.append(text[i+1]); i += 2; continue
                out.append(cc)
                if cc == '"':
                    i += 1; break
                i += 1
            continue
        if c == '/' and nxt == '/':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if c == '/' and nxt == '*':
            i += 2
            while i + 1 < n and not (text[i] == '*' and text[i+1] == '/'):
                i += 1
            i = min(i + 2, n)
            continue
        out.append(c); i += 1
    return ''.join(out)

def _strip_trailing_commas(s: str) -> str:
    return re.sub(r',(\s*[\]\}])', r'\1', s)

def parse_jsonc_file(path: str):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        return None
    except Exception as e:
        log.warning('jsonc read %s: %s', path, e); return None
    cleaned = _strip_trailing_commas(strip_jsonc(text))
    try:
        return json.loads(cleaned)
    except Exception as e:
        log.warning('jsonc parse %s: %s', path, e)
        return None

# ====================================================================
# Agent .md frontmatter parser (simple line-by-line)
# ====================================================================
def parse_agent_frontmatter(text: str) -> dict:
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == '---':
            start = i; break
    if start is None:
        return {}
    end = None
    for i in range(start + 1, len(lines)):
        if lines[i].strip() == '---':
            end = i; break
    if end is None:
        return {}
    out = {}
    for line in lines[start + 1:end]:
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        if ':' in s:
            k, v = s.split(':', 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out

def read_agents_meta() -> dict:
    """name -> {model, mode, description, ...} from frontmatter."""
    result = {}
    for d in AGENT_DIRS:
        if not os.path.isdir(d):
            continue
        try:
            for fname in os.listdir(d):
                if not fname.endswith('.md'):
                    continue
                name = fname[:-3]
                if name in result:
                    continue
                try:
                    with open(os.path.join(d, fname), 'r', encoding='utf-8') as f:
                        fm = parse_agent_frontmatter(f.read())
                    if fm:
                        result[name] = fm
                except Exception as e:
                    log.warning('agent read %s/%s: %s', d, fname, e)
        except Exception as e:
            log.warning('listdir %s: %s', d, e)
    return result

# ====================================================================
# Model short-name
# ====================================================================
_MODEL_TAG_ALIAS = {
    'highspeed': 'hs', 'default': 'df', 'fast': 'fs',
    'turbo': 'tb', 'pro': 'pr', 'lite': 'lt', 'mini': 'mn',
}

def short_model_id(mid: str) -> str:
    if not mid:
        return '?'
    # Strip provider prefix like "anthropic/claude-opus-5-5" -> "claude-opus-5-5"
    if '/' in mid:
        mid = mid.split('/', 1)[1]
    if mid.startswith('MiniMax-'):
        s = mid[len('MiniMax-'):]
        if '-' in s:
            base, tag = s.split('-', 1)
            abbr = _MODEL_TAG_ALIAS.get(tag.lower(), tag[:3])
            return f"{base}-{abbr}"
        return s
    low = mid.lower()
    for prefix, label in (('opus', 'Opus'), ('sonnet', 'Sonnet'), ('haiku', 'Haiku')):
        if prefix in low:
            rest = low.split(prefix + '-')[-1]
            rest = rest.replace('-', '.')
            digits = ''
            for c in rest:
                if c.isdigit() or c == '.':
                    digits += c
                else:
                    break
            digits = digits.rstrip('.')
            return f"{label} {digits}" if digits else label
    return mid

# ====================================================================
# Config aggregation
# ====================================================================
def load_opencode_config() -> dict:
    cfg = parse_jsonc_file(CFG_FILE) or {}
    meta = read_agents_meta()
    default_model = cfg.get('model')
    small_model = cfg.get('small_model')
    default_agent = cfg.get('default_agent')
    overrides = cfg.get('agent') or {}

    all_agents = set()
    all_agents.update(meta.keys())
    all_agents.update(overrides.keys())
    if default_agent:
        all_agents.add(default_agent)
    for a in ('build', 'plan', 'general', 'explore'):
        all_agents.add(a)

    out = {}
    for name in sorted(all_agents):
        fm = meta.get(name, {}) or {}
        ov = overrides.get(name, {}) or {}
        explicit = bool(fm.get('model') or ov.get('model'))
        model = fm.get('model') or ov.get('model') or default_model
        mode = fm.get('mode') or 'subagent'
        out[name] = {
            'model_full': model,
            'model_short': short_model_id(model),
            'mode': mode,
            'inherited': not explicit,
            'source': 'agents/*.md' if fm.get('model')
                       else ('jsonc agent' if ov.get('model') else 'inherited (model)'),
        }
    out['_global'] = {
        'default_agent': default_agent,
        'model_full': default_model,
        'model_short': short_model_id(default_model),
        'small_model_full': small_model,
        'small_model_short': short_model_id(small_model),
    }
    return out

def config_file_mtime() -> float:
    best = 0.0
    paths = [CFG_FILE] + [os.path.join(d, f) for d in AGENT_DIRS
                           for f in (os.listdir(d) if os.path.isdir(d) else [])
                           if f.endswith('.md')]
    for p in paths:
        try:
            best = max(best, os.path.getmtime(p))
        except OSError:
            pass
    return best

# ====================================================================
# Stats from opencode.db (read-only, tolerant to locks)
# ====================================================================
_SELECT_ALL_SESSIONS = (
    "SELECT json_extract(model, '$.providerID'), "
    "       json_extract(model, '$.id'), "
    "       agent, cost, "
    "       tokens_input, tokens_output, tokens_reasoning, "
    "       tokens_cache_read, tokens_cache_write "
    "FROM session"
)

_SELECT_TREE_SESSIONS = (
    "WITH RECURSIVE tree(id) AS ("
    "  SELECT id FROM session WHERE id = ?"
    "  UNION ALL"
    "  SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id"
    ") "
    "SELECT json_extract(s.model, '$.providerID'), "
    "       json_extract(s.model, '$.id'), "
    "       s.agent, s.cost, "
    "       s.tokens_input, s.tokens_output, s.tokens_reasoning, "
    "       s.tokens_cache_read, s.tokens_cache_write "
    "FROM session s JOIN tree t ON s.id = t.id"
)

def today_midnight_ms() -> int:
    now = datetime.now()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(midnight.timestamp() * 1000)

def _aggregate_rows(rows):
    """rows = iterable of (provider, model_id, agent, cost, ti, to, tr, tcr, tcw)"""
    buckets = {}
    for provider, model_id, agent, cost, ti, to, tr, tcr, tcw in rows:
        agent = agent or '?'
        mkey = f"{(provider or '?')}/{(model_id or '?')}"
        b = buckets.setdefault((agent, mkey), {
            'input': 0, 'output': 0, 'reasoning': 0,
            'cache_read': 0, 'cache_write': 0, 'cost': 0.0, 'tokens': 0,
        })
        b['input']       += ti or 0
        b['output']      += to or 0
        b['reasoning']   += tr or 0
        b['cache_read']  += tcr or 0
        b['cache_write'] += tcw or 0
        b['cost']        += cost or 0.0
        b['tokens']       = b['input'] + b['output'] + b['reasoning'] + b['cache_read'] + b['cache_write']
    total = {'input': 0, 'output': 0, 'reasoning': 0,
             'cache_read': 0, 'cache_write': 0, 'tokens': 0, 'cost': 0.0}
    for b in buckets.values():
        for k, v in b.items():
            total[k] += v
    return buckets, total

def read_stats():
    """Returns dict with current_session, today, total. Opens/closes DB read-only."""
    out = {
        'current_session': None,
        'today':     {'total_tokens': 0, 'total_cost': 0.0, 'by_buckets': {}},
        'total':     {'total_tokens': 0, 'total_cost': 0.0, 'by_buckets': {}},
        'error': None,
    }
    if not os.path.exists(DB_PATH):
        out['error'] = 'db not found'
        return out
    try:
        con = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True, timeout=5)
        try:
            cur = con.cursor()
            # Current session: most recently updated root, not archived
            cur.execute(
                "SELECT id, title, agent, time_updated FROM session "
                "WHERE parent_id IS NULL AND (time_archived IS NULL OR time_archived = 0) "
                "ORDER BY time_updated DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row:
                cur_id, cur_title, cur_agent, cur_upd = row
                cur.execute(_SELECT_TREE_SESSIONS, (cur_id,))
                buckets, total = _aggregate_rows(cur.fetchall())
                out['current_session'] = {
                    'id': cur_id, 'title': cur_title or '(sem título)',
                    'agent': cur_agent or '?', 'time_updated': cur_upd,
                    'by_buckets': buckets,
                    'total_tokens': total['tokens'],
                    'total_cost': total['cost'],
                    'breakdown': {k: v for k, v in total.items() if k != 'cost' and k != 'tokens'},
                }
            # Today
            tmid = today_midnight_ms()
            cur.execute(_SELECT_ALL_SESSIONS + " "
                        "WHERE time_created >= ? AND (time_archived IS NULL OR time_archived = 0)",
                        (tmid,))
            buckets, total = _aggregate_rows(cur.fetchall())
            out['today'] = {
                'total_tokens': total['tokens'],
                'total_cost': total['cost'],
                'by_buckets': buckets,
                'breakdown': {k: v for k, v in total.items() if k != 'cost' and k != 'tokens'},
            }
            # Total (non-archived)
            cur.execute(_SELECT_ALL_SESSIONS + " "
                        "WHERE (time_archived IS NULL OR time_archived = 0)")
            buckets, total = _aggregate_rows(cur.fetchall())
            out['total'] = {
                'total_tokens': total['tokens'],
                'total_cost': total['cost'],
                'by_buckets': buckets,
                'breakdown': {k: v for k, v in total.items() if k != 'cost' and k != 'tokens'},
            }
        finally:
            try: con.close()
            except Exception: pass
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        if 'locked' in msg or 'busy' in msg:
            log.info('db locked; keeping previous stats.')
            out['error'] = 'locked'
        else:
            log.warning('db OperationalError: %s', e)
            out['error'] = f'operational: {e}'
    except Exception as e:
        log.warning('db read error: %s', e)
        out['error'] = str(e)
    return out

class StatsCache:
    """Thread-safe cache of last good stats; keeps last values on db lock."""
    def __init__(self):
        self.lock = threading.Lock()
        self.last = {
            'current_session': None,
            'today':     {'total_tokens': 0, 'total_cost': 0.0, 'by_buckets': {}},
            'total':     {'total_tokens': 0, 'total_cost': 0.0, 'by_buckets': {}},
            'error': None,
        }
    def update(self):
        data = read_stats()
        with self.lock:
            if data['error'] is None or data['current_session'] is not None:
                # update if we got something fresh, even if today's aggregates are zero
                if data['error'] == 'locked':
                    pass  # keep last
                else:
                    self.last = data
            elif data['error'] == 'locked':
                pass
            else:
                # update anyway, with error tag
                self.last = data
    def snapshot(self):
        with self.lock:
            return self.last

# ====================================================================
# Currency (USD -> BRL) with cache + background refresh
# ====================================================================
CACHE_MAX_AGE_S = 6 * 3600
DEFAULT_USDBRL = 5.50
URL_USDBRL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL'

def _read_cache():
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data.get('bid'), (int, float)):
            return float(data['bid']), float(data.get('ts', 0))
    except Exception:
        pass
    return None

def _write_cache(bid, ts):
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump({'bid': bid, 'ts': ts}, f)
    except Exception as e:
        log.warning('usdbrl cache write: %s', e)

class Currency:
    def __init__(self):
        self.lock = threading.Lock()
        self.bid = DEFAULT_USDBRL
        self.ts = 0
        self.fetching = False
        c = _read_cache()
        if c:
            self.bid, self.ts = c
    def get(self):
        with self.lock:
            return self.bid, self.ts
    def refresh_async(self, force=False):
        with self.lock:
            if self.fetching:
                return
            now = time.time()
            if not force and (now - self.ts) < CACHE_MAX_AGE_S and self.ts > 0:
                return
            self.fetching = True
        def work():
            ok = False
            try:
                req = urllib.request.Request(URL_USDBRL,
                    headers={'User-Agent': 'opencode-hud/1.0 (+stdlib)'})
                with urllib.request.urlopen(req, timeout=10) as r:
                    data = json.load(r)
                bid = float(data['USDBRL']['bid'])
                ts = time.time()
                with self.lock:
                    self.bid = bid; self.ts = ts
                _write_cache(bid, ts)
                log.info('usdbrl refreshed: %.4f', bid)
                ok = True
            except Exception as e:
                log.info('usdbrl refresh failed (keeping %.4f): %s', self.bid, e)
            finally:
                with self.lock:
                    self.fetching = False
            return ok
        threading.Thread(target=work, daemon=True, name='usdbrl').start()

# ====================================================================
# Opencode process check
# ====================================================================
def is_opencode_running():
    if sys.platform != 'win32':
        return None
    try:
        si = None
        if hasattr(subprocess, 'STARTUPINFO'):
            si = subprocess.STARTUPINFO()
            si.dwFlags |= getattr(subprocess, 'STARTF_USESHOWWINDOW', 1)
        flags = 0
        if sys.platform == 'win32':
            flags = 0x08000000  # CREATE_NO_WINDOW
        out = subprocess.check_output(
            ['tasklist', '/fi', 'imagename eq opencode.exe', '/fo', 'csv', '/nh'],
            timeout=3, startupinfo=si, creationflags=flags)
        return b'opencode.exe' in out.lower()
    except subprocess.CalledProcessError:
        return False
    except Exception as e:
        log.debug('tasklist error: %s', e)
        return None

# ====================================================================
# Logging with simple rotation (UTF-8)
# ====================================================================
_initialized_logging = False
def setup_logging():
    global _initialized_logging
    if _initialized_logging:
        return
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    # RotatingFileHandler herda de FileHandler; passamos encoding='utf-8'.
    handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=262144,
        backupCount=3,
        encoding='utf-8',
    )
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # remove any handlers we might have inadvertently added
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    _initialized_logging = True

# ====================================================================
# Formatting
# ====================================================================
def fmt_tokens(n) -> str:
    n = int(n or 0)
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        s = f'{n/1000:.1f}'
        if s.endswith('.0'):
            s = s[:-2]
        return f'{s}k'
    s = f'{n/1_000_000:.2f}'
    if s.endswith('.00'):
        s = s[:-3]
    elif s.endswith('0'):
        s = s[:-1]
    return f'{s}M'

def fmt_usd(v) -> str:
    try:
        x = float(v or 0)
    except Exception:
        x = 0.0
    if x == 0:
        return '$0'
    if x < 0.01:
        return f'${x:.4f}'
    if x < 1:
        return f'${x:.3f}'
    return f'${x:.2f}'

def fmt_brl(v) -> str:
    try:
        x = float(v or 0)
    except Exception:
        x = 0.0
    s = f'{x:.2f}'.replace('.', ',')
    if s.startswith('0,'):
        return f'R$ 0{s[1:]}'
    return f'R$ {s}'

def fmt_age(ms_ts, now_ms=None) -> str:
    if not ms_ts:
        return ''
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    diff = max(0, (now_ms - ms_ts) // 1000)
    if diff < 60: return f'{diff}s'
    if diff < 3600: return f'{diff//60}m'
    if diff < 86400: return f'{diff//3600}h'
    return f'{diff//86400}d'

# ====================================================================
# Single-instance mutex (named Windows mutex via ctypes)
# ====================================================================
ERROR_ALREADY_EXISTS = 183

def acquire_mutex(name='Local\\opencode-hud'):
    """Returns the mutex handle if acquired, else None (already running)."""
    if sys.platform != 'win32':
        return True  # no enforcement outside Windows
    CreateMutexW = ctypes.windll.kernel32.CreateMutexW
    CreateMutexW.restype = ctypes.wintypes.HANDLE
    CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.wintypes.BOOL, ctypes.wintypes.LPCWSTR]
    GetLastError = ctypes.windll.kernel32.GetLastError
    GetLastError.restype = ctypes.wintypes.DWORD
    handle = CreateMutexW(None, False, ctypes.c_wchar_p(name))
    if not handle:
        log.warning('CreateMutexW failed; proceeding without single-instance protection')
        return True
    if GetLastError() == ERROR_ALREADY_EXISTS:
        ctypes.windll.kernel32.CloseHandle(handle)
        return None
    return handle
