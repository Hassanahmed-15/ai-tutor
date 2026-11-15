"""
Renders ONE model-written slide with Manim inside a sandbox (lib/screen/slide.ts runs it).

    python runner.py <work dir> <scene file> <output name>

The scene file is Python an AI wrote from what a student marked on their screen, so it is treated
as hostile: a page can carry text written to talk the model into code that reads the server's keys
or reaches the network. lib/screen/slide.ts already refuses imports and names a slide never needs;
this is the second wall, enforced while the code runs:

  - limits: CPU seconds, memory, file size;
  - a clean environment (no keys) with HOME inside the work dir;
  - a Python audit hook, installed after Manim is loaded and before the slide is read, that refuses
    every socket, every new process, ctypes, and any file read of another process (/proc/<pid>),
    the system's secrets or the app's env files, and any file write outside the work dir.

In production the server also runs this as its own system user (Dockerfile: "slides", through
sudo), so even a way past the hook finds no keys: the server's environment belongs to another user.
"""

import os
import resource
import sys
import tempfile

if sys.argv[1:2] == ["--check"]:
    # The deploy check (app/api/screen/status): can this user see the server's environment at all?
    # Asked before any hook, so it measures the user separation alone. argv[2] is the server's pid
    # (under sudo the parent is sudo itself, not the server).
    import json

    server = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].isdigit() else str(os.getppid())
    try:
        with open(f"/proc/{server}/environ", "rb") as f:
            seen = len(f.read()) > 0
    except OSError:
        seen = False
    try:
        import manim  # noqa: F401

        has_manim = True
    except Exception:
        has_manim = False
    print(json.dumps({"uid": os.getuid(), "serverEnvReadable": seen, "manim": has_manim}))
    sys.exit(0)

WORK, SCENE, NAME = sys.argv[1:4]
WORK = os.path.realpath(WORK)
KIT = os.path.dirname(os.path.realpath(__file__))
TMP = os.path.realpath(tempfile.gettempdir())

# Files written here are cleaned up by the server, which may be another user.
os.umask(0)
os.chdir(WORK)
os.environ.clear()
os.environ.update({"HOME": WORK, "LANG": "en_US.UTF-8", "NO_COLOR": "1", "TERM": "dumb", "PATH": "/usr/bin:/bin", "MPLCONFIGDIR": WORK})
# Fontconfig's cache is kept outside the work folder (and reused between slides): it makes its own
# folders private, which the server, as another user, could not delete.
os.environ["XDG_CACHE_HOME"] = os.path.join(TMP, f"aria-screen-cache-{os.getuid()}")
sys.path.insert(0, KIT)


def limit(kind, value):
    try:
        soft, hard = resource.getrlimit(kind)
        cap = value if hard == resource.RLIM_INFINITY else min(value, hard)
        resource.setrlimit(kind, (cap, hard))
    except (ValueError, OSError):
        pass  # some limits do not exist on every system (macOS has no RLIMIT_AS cap that works)


limit(resource.RLIMIT_CPU, 150)
limit(resource.RLIMIT_FSIZE, 300 * 1024 * 1024)
if sys.platform.startswith("linux"):
    limit(resource.RLIMIT_AS, 4 * 1024 * 1024 * 1024)

# Everything Manim needs is loaded before the hook, so the hook only has to judge the slide.
import manim  # noqa: E402,F401
import manim.__main__ as manim_main  # noqa: E402
import aria_slide  # noqa: E402,F401

PID = str(os.getpid())
WRITE_OK = (WORK + os.sep, TMP + os.sep)
SECRET_PARTS = ("/.env", "/run/secrets", "/var/run/secrets", "/etc/shadow", "/etc/sudoers", "/root/", "/.ssh/", "/.azure/")
BLOCKED_EVENTS = (
    "socket.", "subprocess.", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty",
    "pty.", "ctypes.", "os.kill", "os.killpg", "signal.pthread_kill", "urllib.", "http.client.", "ftplib.",
    "smtplib.", "poplib.", "imaplib.", "nntplib.", "telnetlib.", "webbrowser.",
    "os.chown", "os.lchown", "os.setuid", "os.setgid", "winreg.", "cpython.remote_debugger_script",
)
WRITE_EVENTS = {"os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.chmod", "os.symlink", "os.link", "os.truncate", "shutil.rmtree", "shutil.move", "shutil.copyfile", "os.utime"}


class Refused(PermissionError):
    pass


def real(path):
    if isinstance(path, int):
        return None
    if isinstance(path, bytes):
        path = path.decode("utf-8", "replace")
    try:
        return os.path.realpath(os.fspath(path))
    except TypeError:
        return None


def readable(path):
    if path is None:
        return True
    if path.startswith("/proc/"):
        rest = path[len("/proc/"):].split("/", 1)[0]
        # Its own /proc entry is fine; another process's (the server's environment) never is.
        return not rest.isdigit() or rest == PID
    if path.startswith("/sys/"):
        return False
    return not any(part in path + "/" for part in SECRET_PARTS)


def writable(path):
    return path is None or path.startswith(WRITE_OK) or path in (WORK, TMP)


def is_write(mode, flags):
    if isinstance(mode, str) and any(c in mode for c in "wax+"):
        return True
    return isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))


def guard(event, args):
    if event.startswith(BLOCKED_EVENTS):
        raise Refused(f"slides may not use {event}")
    if event == "open":
        path = real(args[0])
        mode = args[1] if len(args) > 1 else None
        flags = args[2] if len(args) > 2 else None
        if not readable(path):
            raise Refused("slides may not read that file")
        if is_write(mode, flags) and not writable(path):
            raise Refused("slides may only write in their own folder")
    elif event in WRITE_EVENTS:
        for a in args:
            if isinstance(a, (str, bytes, os.PathLike)):
                path = real(a)
                if path is not None and not writable(path):
                    raise Refused(f"slides may not change files outside their folder ({event})")
    elif event in ("os.listdir", "os.scandir", "glob.glob"):
        path = real(args[0]) if args and args[0] is not None else WORK
        if path is not None and not readable(path):
            raise Refused("slides may not list that folder")


sys.addaudithook(guard)

sys.argv = ["manim", "render", "-qm", "--disable_caching", "--format", "mp4", "--media_dir", os.path.join("media", NAME), "-o", NAME, SCENE, "Slide"]
try:
    manim_main.main()
finally:
    # Everything made here opened up, so the server (another user) can read the video and delete the folder.
    for root, dirs, files in os.walk(WORK):
        for name in dirs + files:
            try:
                os.chmod(os.path.join(root, name), 0o777 if name in dirs else 0o666, follow_symlinks=False)
            except (OSError, NotImplementedError):
                pass
