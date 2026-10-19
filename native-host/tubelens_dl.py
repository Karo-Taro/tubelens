#!/usr/bin/env python3
"""TubeLens Downloader — помощник загрузки для расширения TubeLens (yt-dlp).

Два режима:
  * Native Messaging (по умолчанию) — Chrome запускает помощника сам, обмен идёт
    через stdin/stdout (4 байта длины + JSON).
  * Локальный HTTP-сервер (--serve) — для браузеров, где Native Messaging не работает
    (Linken Sphere, другие сборки Chromium/CEF). Слушает только 127.0.0.1:47321
    (порт можно сменить переменной TUBELENS_PORT) и принимает запросы только от
    расширений (см. _allowed()).

Команды (в обоих режимах): ping, download {url, preset, dir?}, cancel {job},
open {path}, update. В HTTP-режиме дополнительно GET /jobs — состояние загрузок.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import re
import tempfile
import threading
import time
from urllib.parse import urlsplit

VERSION = "1.3.0"
PORT = int(os.environ.get("TUBELENS_PORT", "47321"))
SERVE = "--serve" in sys.argv

# Настройки помощника: %LOCALAPPDATA%\TubeLens\config.json (пишет установщик)
#   allowed_origins — какие расширения могут обращаться к помощнику
#   cli — свои CLI-команды для AI, например {"my-llm": {"cmd": ["llm", "-m", "gpt-4o"]}}
DATA_HOME = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
CONFIG_DIR = os.path.join(DATA_HOME, "TubeLens")
DEFAULT_ORIGINS = ["chrome-extension://mnaoadllhdlnmdccgppbbicpplfihceh"]
# Host-заголовки, которые принимает HTTP-режим (защита от DNS-rebinding)
ALLOWED_HOSTS = {"127.0.0.1", "localhost"}
MAX_BODY = 8 * 1024 * 1024        # максимальный размер JSON-запроса
MAX_PROMPT = 400_000              # символов в промпте для CLI
MAX_OUTPUT = 1_000_000            # символов в ответе CLI
MAX_JOBS = 100                    # сколько задач загрузки помнить в HTTP-режиме
LOG_LIMIT = 1024 * 1024           # helper.log больше 1 МБ → ротация в helper.log.1


def load_config():
    try:
        with open(os.path.join(CONFIG_DIR, "config.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


CONFIG = load_config()
ALLOWED_ORIGINS = set(CONFIG.get("allowed_origins") or DEFAULT_ORIGINS)

_lock = threading.Lock()
_jobs_lock = threading.Lock()
_update_lock = threading.Lock()
_cli_slots = threading.BoundedSemaphore(2)  # не больше двух CLI-агентов одновременно
_cancel = set()
_jobs = {}  # HTTP-режим: состояние задач для опроса расширением

# ---------------------------------------------------------------- вывод событий
if not SERVE:
    # stdout зарезервирован под протокол — всё остальное печатаем в stderr
    _OUT = sys.stdout.buffer
    _IN = sys.stdin.buffer
    sys.stdout = sys.stderr
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(_IN.fileno(), os.O_BINARY)
        msvcrt.setmode(_OUT.fileno(), os.O_BINARY)
else:
    # pythonw: stdout/stderr отсутствуют — пишем в лог (с простой ротацией, чтобы он не рос бесконечно)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    _log = os.path.join(CONFIG_DIR, "helper.log")
    try:
        if os.path.getsize(_log) > LOG_LIMIT:
            os.replace(_log, _log + ".1")
    except OSError:
        pass
    try:
        sys.stdout = sys.stderr = open(_log, "a", encoding="utf-8", errors="replace", buffering=1)
    except OSError:
        sys.stdout = sys.stderr = open(os.devnull, "w", encoding="utf-8")


def emit(msg):
    """Событие для расширения: в Native Messaging — в stdout, в HTTP — в таблицу задач."""
    if SERVE:
        _update_job(msg)
        return
    data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    with _lock:
        _OUT.write(struct.pack("<I", len(data)))
        _OUT.write(data)
        _OUT.flush()


def _update_job(msg):
    with _jobs_lock:
        _update_job_locked(msg)


def _add_job(job, info):
    with _jobs_lock:
        _jobs[job] = info
        # память не растёт бесконечно: удаляем самые старые завершённые задачи
        if len(_jobs) > MAX_JOBS:
            old = sorted((j for j in _jobs.values() if j.get("status") != "running"), key=lambda j: j.get("updated", 0))
            for j in old[: len(_jobs) - MAX_JOBS]:
                _jobs.pop(j["id"], None)


def _list_jobs():
    with _jobs_lock:
        return [dict(j) for j in _jobs.values()]


def _update_job_locked(msg):
    job = msg.get("id")
    if not job or job not in _jobs:
        return
    t = msg.get("type")
    j = _jobs[job]
    if t == "progress":
        j.update(percent=msg.get("percent"), speed=msg.get("speed"), eta=msg.get("eta"), stage="")
    elif t == "stage":
        j["stage"] = msg.get("stage")
    elif t == "done":
        j.update(status="done", percent=100, file=msg.get("file"), dir=msg.get("dir"), stage="")
    elif t == "error":
        cancelled = "Отменено" in str(msg.get("error")) or "cancel" in str(msg.get("error")).lower()
        j.update(status="cancelled" if cancelled else "error", error=msg.get("error"))
    j["updated"] = time.time()


# ---------------------------------------------------------------- загрузка
def default_dir():
    return os.path.join(os.path.expanduser("~"), "Downloads", "TubeLens")


def _inside_default_dir(path):
    """Путь лежит внутри папки загрузок TubeLens (после раскрытия .. и ссылок)."""
    root = os.path.realpath(default_dir())
    p = os.path.realpath(path)
    try:
        return os.path.commonpath([root, p]) == root
    except ValueError:  # разные диски
        return False


def check_url(url):
    """Только http(s)-ссылки: никаких file://, опций командной строки и т.п."""
    url = (url or "").strip() if isinstance(url, str) else ""
    parts = urlsplit(url)
    if len(url) > 2048 or parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("Нужна ссылка http(s) на видео")
    return url


def check_dir(path):
    """Папка для загрузки: только папка TubeLens в «Загрузках» или её подпапки."""
    if not path:
        return default_dir()
    if not isinstance(path, str) or not os.path.isabs(path) or not _inside_default_dir(path):
        raise ValueError(f"Сохранять можно только в {default_dir()}")
    return path


def has_ffmpeg():
    return shutil.which("ffmpeg") is not None


def ytdlp_version():
    try:
        import yt_dlp
        return yt_dlp.version.__version__
    except Exception:
        return None


def build_format(preset, ffmpeg):
    """Возвращает (format, postprocessors, merge_format)."""
    def video(h):
        cap = f"[height<={h}]" if h else ""
        if ffmpeg:
            return f"bv*{cap}[ext=mp4]+ba[ext=m4a]/bv*{cap}+ba/b{cap}", "mp4"
        return f"b{cap}[ext=mp4]/b{cap}/b", None

    if preset == "mp3":
        if not ffmpeg:
            return "ba[ext=m4a]/ba/b", [], None
        return "ba/b", [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}], None
    if preset == "audio":
        return "ba[ext=m4a]/ba/b", [], None
    heights = {"best": None, "2160": 2160, "1440": 1440, "1080": 1080, "720": 720, "480": 480, "360": 360}
    fmt, merge = video(heights.get(preset))
    return fmt, [], merge


def do_download(msg):
    job = msg["id"]
    try:
        import yt_dlp
    except ImportError:
        emit({"id": job, "type": "error", "error": "yt-dlp не установлен. Запустите установщик помощника ещё раз."})
        return

    ffmpeg = has_ffmpeg()
    fmt, pps, merge = build_format(msg.get("preset", "best"), ffmpeg)
    try:
        url = check_url(msg.get("url"))
        out_dir = check_dir(msg.get("dir"))
    except ValueError as e:
        emit({"id": job, "type": "error", "error": str(e)})
        return
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as e:
        emit({"id": job, "type": "error", "error": f"Не удалось создать папку {out_dir}: {e}"})
        return
    state = {"file": None, "last": 0}

    def hook(d):
        if job in _cancel:
            raise yt_dlp.utils.DownloadCancelled("Отменено")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            pct = round(done * 100 / total, 1) if total else None
            if pct is None or pct - state["last"] >= 1 or pct >= 100:
                state["last"] = pct or 0
                emit({"id": job, "type": "progress", "percent": pct, "speed": d.get("speed"), "eta": d.get("eta"),
                      "downloaded": done, "total": total})
        elif d["status"] == "finished":
            state["file"] = d.get("filename")
            state["last"] = 0
            emit({"id": job, "type": "stage", "stage": "Обработка…"})

    class Log:
        def debug(self, m): pass
        def info(self, m): pass
        def warning(self, m): print(m, file=sys.stderr)
        def error(self, m): print(m, file=sys.stderr)

    opts = {
        "format": fmt,
        "outtmpl": os.path.join(out_dir, "%(title).150B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        "logger": Log(),
        "progress_hooks": [hook],
        "postprocessors": pps,
        "windowsfilenames": True,
    }
    if merge:
        opts["merge_output_format"] = merge

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            req = info.get("requested_downloads") or [{}]
            path = req[0].get("filepath") or state["file"] or ydl.prepare_filename(info)
            emit({"id": job, "type": "done", "file": path, "title": info.get("title"), "dir": out_dir, "ffmpeg": ffmpeg})
    except Exception as e:  # noqa: BLE001
        emit({"id": job, "type": "error", "error": str(e).replace("\x1b[0;31mERROR:\x1b[0m ", "")})
    finally:
        _cancel.discard(job)


def open_path(path):
    """Открыть в проводнике папку загрузок (или папку скачанного файла). Только внутри
    папки TubeLens: иначе через помощника можно было бы открыть UNC-путь, URI-схему и т.п."""
    if not path:
        path = default_dir()
        os.makedirs(path, exist_ok=True)
    if not isinstance(path, str) or not os.path.isabs(path) or not _inside_default_dir(path):
        raise ValueError(f"Открывать можно только папку {default_dir()}")
    if os.path.isfile(path):
        path = os.path.dirname(path)
    if not os.path.isdir(path):
        raise ValueError("Папка не найдена — возможно, файл перемещён или удалён")
    if sys.platform == "win32":
        os.startfile(path)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def run_update():
    if not _update_lock.acquire(blocking=False):
        return False, "Обновление уже идёт"
    try:
        py = sys.executable.replace("pythonw.exe", "python.exe")
        r = subprocess.run([py, "-m", "pip", "install", "-U", "yt-dlp[default]"], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=600,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0, (r.stderr or r.stdout or "")[-500:]
    except subprocess.TimeoutExpired:
        return False, "pip не завершился за 10 минут"
    finally:
        _update_lock.release()


def status():
    return {"ok": True, "version": VERSION, "ytdlp": ytdlp_version(), "ffmpeg": has_ffmpeg(),
            "deno": shutil.which("deno") is not None, "dir": default_dir(), "python": sys.version.split()[0],
            "mode": "http" if SERVE else "native", "cli": [m["id"] for m in cli_models()] if SERVE else []}


# ---------------------------------------------------------------- AI через CLI-агентов
# Помощник принимает OpenAI-совместимые запросы (/v1/chat/completions) и передаёт текст
# установленному CLI через stdin. Модель = имя CLI. Команды фиксированы здесь или в config.json —
# из запроса приходит только имя, поэтому произвольную команду через HTTP запустить нельзя.
# Агентам отключены инструменты: в промпт попадают чужие названия/описания видео, и
# prompt-injection не должен суметь запустить команды или прочитать ваши файлы.
CLI_PRESETS = {
    "claude": {"cmd": ["claude", "-p", "--output-format", "text", "--tools", "", "--strict-mcp-config"],
               "title": "Claude Code"},
    "codex": {"cmd": ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"], "title": "OpenAI Codex CLI"},
    "gemini": {"cmd": ["gemini"], "title": "Gemini CLI"},
}
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
OLLAMA_NAME = re.compile(r"[A-Za-z0-9][\w.-]*(?:/[\w.-]+)*(?::[\w.-]+)?")
_models_cache = {"t": 0.0, "v": []}


def cli_commands():
    cmds = dict(CLI_PRESETS)
    for name, c in (CONFIG.get("cli") or {}).items():
        if isinstance(c, dict) and isinstance(c.get("cmd"), list):
            cmds[name] = {"cmd": c["cmd"], "title": c.get("title", name)}
    return cmds


def cli_models():
    # кэш на 60 с: /ping вызывается часто, а `ollama list` может идти секунды
    if time.time() - _models_cache["t"] < 60:
        return _models_cache["v"]
    out = [{"id": n, "title": c["title"]} for n, c in cli_commands().items() if c["cmd"] and shutil.which(c["cmd"][0])]
    if shutil.which("ollama"):
        try:
            r = subprocess.run(["ollama", "list"], capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            for line in r.stdout.splitlines()[1:]:
                if line.strip():
                    m = line.split()[0]
                    out.append({"id": "ollama/" + m, "title": "Ollama " + m})
        except Exception:
            pass
    _models_cache.update(t=time.time(), v=out)
    return out


def resolve_cli(model):
    model = (model or "").strip() if isinstance(model, str) else ""
    if model.startswith("ollama/"):
        name = model[7:]
        if len(name) > 80 or ".." in name or not OLLAMA_NAME.fullmatch(name):
            raise ValueError("Некорректное имя модели Ollama")
        cmd = ["ollama", "run", name]
    else:
        c = cli_commands().get(model)
        if not c:
            raise ValueError(f"Неизвестный CLI «{model}». Доступно: {', '.join(m['id'] for m in cli_models()) or 'ничего не найдено'}")
        cmd = list(c["cmd"])
    exe = shutil.which(cmd[0])
    if not exe:
        raise ValueError(f"«{cmd[0]}» не найден в PATH. Установите его и выполните вход, затем перезапустите помощника.")
    return [exe] + cmd[1:]


def messages_to_prompt(messages):
    if not isinstance(messages, list):
        raise ValueError("messages должен быть списком")
    messages = [m for m in messages if isinstance(m, dict)]
    parts = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):  # формат с частями
            content = "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
        role = m.get("role")
        if role == "system":
            parts.append(f"[Инструкции]\n{content}")
        elif role == "assistant":
            parts.append(f"[Ответ ассистента]\n{content}")
        else:
            parts.append(content if len(messages) == 1 or role != "user" else f"[Пользователь]\n{content}")
    prompt = "\n\n".join(str(p) for p in parts)
    if len(prompt) > MAX_PROMPT:
        raise ValueError(f"Слишком длинный запрос ({len(prompt)} символов, максимум {MAX_PROMPT})")
    return prompt


def _kill_tree(p):
    """claude/codex/gemini на Windows — это .cmd-обёртки над node: убиваем всё дерево процессов."""
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        else:
            os.killpg(p.pid, 9)
    except Exception:
        pass
    try:
        p.kill()
    except Exception:
        pass


def run_cli(model, messages, timeout=300):
    cmd = resolve_cli(model)
    prompt = messages_to_prompt(messages)
    if not _cli_slots.acquire(timeout=60):
        raise RuntimeError("CLI занят другими запросами — повторите позже")
    try:
        # пустая рабочая папка: агент не видит и не трогает ваши файлы
        with tempfile.TemporaryDirectory(prefix="tubelens-cli-") as cwd:
            p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, encoding="utf-8", errors="replace", cwd=cwd,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                                 start_new_session=sys.platform != "win32")
            try:
                stdout, stderr = p.communicate(prompt, timeout=timeout)
            except subprocess.TimeoutExpired:
                _kill_tree(p)
                p.communicate()
                raise
    finally:
        _cli_slots.release()
    out = ANSI.sub("", stdout or "").strip()[:MAX_OUTPUT]
    if p.returncode != 0 and not out:
        raise RuntimeError((ANSI.sub("", stderr or "") or f"{os.path.basename(cmd[0])} завершился с кодом {p.returncode}").strip()[-800:])
    return out


# ---------------------------------------------------------------- Native Messaging
def read():
    raw = _IN.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack("<I", raw)
    if length > MAX_BODY:
        return None
    try:
        msg = json.loads(_IN.read(length).decode("utf-8"))
    except ValueError:
        return {}
    return msg if isinstance(msg, dict) else {}


def native_main():
    while True:
        msg = read()
        if msg is None:
            break
        cmd, mid = msg.get("cmd"), msg.get("id")
        try:
            if cmd == "ping":
                emit({"id": mid, "type": "result", **status()})
            elif cmd == "download":
                threading.Thread(target=do_download, args=(msg,), daemon=True).start()
                emit({"id": mid, "type": "started"})
            elif cmd == "cancel":
                _cancel.add(msg.get("job"))
                emit({"id": mid, "type": "result", "ok": True})
            elif cmd == "open":
                open_path(msg.get("path"))
                emit({"id": mid, "type": "result", "ok": True})
            elif cmd == "update":
                def upd():
                    ok, err = run_update()
                    emit({"id": mid, "type": "result", "ok": True} if ok else {"id": mid, "type": "error", "error": err})
                threading.Thread(target=upd, daemon=True).start()
            else:
                emit({"id": mid, "type": "error", "error": f"Неизвестная команда: {cmd}"})
        except Exception as e:  # noqa: BLE001
            emit({"id": mid, "type": "error", "error": str(e)})


# ---------------------------------------------------------------- HTTP-режим
def _host_ok(handler):
    """Защита от DNS-rebinding: сайт evil.com, «перепривязанный» на 127.0.0.1, шлёт
    запросы как same-origin (без preflight), но с Host: evil.com — такие отклоняем."""
    host = (handler.headers.get("Host") or "").strip().lower()
    name, _, port = host.rpartition(":") if not host.endswith("]") else (host, "", "")
    if not name:
        name, port = host, ""
    return name in ALLOWED_HOSTS and port in ("", str(PORT))


def _allowed(handler):
    """Только расширения браузера: веб-страницы не могут подделать Origin, а заголовок
    X-TubeLens заставляет браузер сделать preflight, который мы не разрешаем сайтам.
    Запросы без Origin (локальные программы того же пользователя) допускаются."""
    if not _host_ok(handler):
        return False
    origin = (handler.headers.get("Origin") or "").rstrip("/")
    if origin and origin not in ALLOWED_ORIGINS:
        return False
    return handler.headers.get("X-TubeLens") == "1"


def serve_main():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            origin = (self.headers.get("Origin") or "").rstrip("/")
            if origin in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except OSError:  # клиент уже закрыл соединение (таймаут на стороне расширения)
                pass

        def do_OPTIONS(self):  # preflight: разрешаем только расширению TubeLens
            origin = (self.headers.get("Origin") or "").rstrip("/")
            if origin not in ALLOWED_ORIGINS or not _host_ok(self):
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-TubeLens, Authorization")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def _body(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = -1
            if n < 0 or n > MAX_BODY:
                raise ValueError("Некорректный размер запроса")
            obj = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
            if not isinstance(obj, dict):
                raise ValueError("Ожидался JSON-объект")
            return obj

        def do_GET(self):
            if not _allowed(self):
                return self._send(403, {"error": "forbidden"})
            if self.path == "/ping":
                return self._send(200, status())
            if self.path == "/jobs":
                return self._send(200, {"jobs": _list_jobs()})
            if self.path == "/v1/models":
                return self._send(200, {"object": "list", "data": [{"id": m["id"], "object": "model", "owned_by": m["title"]} for m in cli_models()]})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if not _allowed(self):
                return self._send(403, {"error": "forbidden"})
            try:
                try:
                    msg = self._body()
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
                if self.path == "/download":
                    job = str(msg.get("id") or f"j{int(time.time() * 1000)}")[:80]
                    msg["id"] = job
                    try:
                        check_url(msg.get("url"))
                        check_dir(msg.get("dir"))
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                    _add_job(job, {"id": job, "url": msg.get("url"), "preset": msg.get("preset"), "status": "running",
                                   "percent": 0, "updated": time.time()})
                    threading.Thread(target=do_download, args=(msg,), daemon=True).start()
                    return self._send(200, {"ok": True, "id": job})
                if self.path == "/cancel":
                    _cancel.add(msg.get("job"))
                    return self._send(200, {"ok": True})
                if self.path == "/open":
                    try:
                        open_path(msg.get("path"))
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                    return self._send(200, {"ok": True})
                if self.path == "/v1/chat/completions":
                    try:
                        text = run_cli(msg.get("model"), msg.get("messages"))
                    except subprocess.TimeoutExpired:
                        return self._send(504, {"error": {"message": "CLI не ответил за 5 минут"}})
                    except (ValueError, RuntimeError) as e:
                        return self._send(400, {"error": {"message": str(e)}})
                    return self._send(200, {"id": f"cli-{int(time.time())}", "object": "chat.completion", "model": msg.get("model"),
                                            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}]})
                if self.path == "/update":
                    ok, err = run_update()
                    return self._send(200 if ok else 500, {"ok": ok, "error": None if ok else err})
                self._send(404, {"error": "not found"})
            except Exception as e:  # noqa: BLE001
                self._send(500, {"error": str(e)})

    class Server(ThreadingHTTPServer):
        # Иначе на Windows SO_REUSEADDR позволяет второму экземпляру занять тот же порт,
        # и запросы случайно уходят то в старый, то в новый процесс.
        allow_reuse_address = sys.platform != "win32"
        daemon_threads = True

        def server_bind(self):
            import socket
            if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    try:
        srv = Server(("127.0.0.1", PORT), H)
    except OSError as e:
        print(f"Порт {PORT} занят ({e}) — помощник уже запущен или порт занят другой программой", file=sys.stderr)
        sys.exit(1)
    print(f"TubeLens helper {VERSION} слушает 127.0.0.1:{PORT}", file=sys.stderr)
    srv.serve_forever()


if __name__ == "__main__":
    serve_main() if SERVE else native_main()
