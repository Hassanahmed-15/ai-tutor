// The container's first process (Dockerfile CMD), as root. It does two things and nothing else:
//
//   1. starts the Aria server as the "nextjs" user (the command after this script's name), passes it
//      the container's stop signals, and exits with it;
//   2. renders screen-mark slides as the "slides" user when the server asks over a socket only the
//      server can open (lib/screen/slide.ts).
//
// WHY. A slide is Python an AI wrote from what a student marked (scripts/screen/runner.py sandboxes
// it). Run as the server's own user it could read /proc/<server>/environ, which holds every key; run
// as another user it cannot. Switching user needs root, and sudo cannot work here: Azure Container
// Apps start containers with no_new_privs, which stops sudo from gaining root. Starting as root and
// only ever dropping to a lesser user is allowed under no_new_privs, so this small process keeps root
// for exactly one job: starting runner.py as "slides" for a work folder under /tmp/aria-screen.
import { spawn } from "node:child_process";
import { chownSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(KIT, "runner.py");
const PYTHON = process.env.SCREEN_MANIM_PYTHON ?? "/opt/manimenv/bin/python";
const SOCKET = process.env.SCREEN_RENDER_BROKER ?? "/run/aria-screen/broker.sock";
const WORK_ROOT = "/tmp/aria-screen";
const SERVER_USER = process.env.SCREEN_SERVER_USER ?? "nextjs";
const SERVER_GROUP = process.env.SCREEN_SERVER_GROUP ?? "nodejs";
const SERVER_UID = Number(process.env.SCREEN_SERVER_UID ?? 1001);
const SLIDES_USER = process.env.SCREEN_SLIDES_USER ?? "slides";
const RENDER_TIMEOUT_MS = 130_000;
const NAME = /^[A-Za-z0-9_-]{1,80}$/;
const FILE = /^[A-Za-z0-9_-]{1,80}\.py$/;

const log = (...parts) => console.log("[screen-broker]", ...parts);

/** A job is a render [dir, file, name] or a check ["--check", pid]; anything else is refused. */
function argsOf(job) {
  const args = Array.isArray(job?.args) ? job.args.map(String) : [];
  if (args.length === 2 && args[0] === "--check" && /^\d{1,8}$/.test(args[1])) return { args, cwd: WORK_ROOT };
  if (args.length !== 3 || !FILE.test(args[1]) || !NAME.test(args[2])) return null;
  let dir;
  try {
    dir = realpathSync(args[0]);
  } catch {
    return null;
  }
  if (path.dirname(dir) !== WORK_ROOT || !NAME.test(path.basename(dir))) return null;
  return { args: [dir, args[1], args[2]], cwd: dir };
}

function serveRenders() {
  mkdirSync(path.dirname(SOCKET), { recursive: true, mode: 0o700 });
  chownSync(path.dirname(SOCKET), SERVER_UID, 0);
  if (existsSync(SOCKET)) rmSync(SOCKET);
  // The server makes each slide's work folder in here (lib/screen/common.ts workDir); "slides" writes
  // only inside those, which the server opens to it.
  mkdirSync(WORK_ROOT, { recursive: true });
  chownSync(WORK_ROOT, SERVER_UID, 0);
  const server = createServer((socket) => {
    let buf = "";
    let started = false;
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (data) => {
      if (started) return;
      buf += data;
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        if (buf.length > 4096) socket.destroy();
        return;
      }
      started = true;
      let job = null;
      try {
        job = argsOf(JSON.parse(buf.slice(0, nl)));
      } catch {
        job = null;
      }
      if (!job) {
        socket.end(`${JSON.stringify({ code: 2, out: "refused: not a render job" })}\n`);
        return;
      }
      const env = { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" };
      const child = spawn("setpriv", ["--reuid", SLIDES_USER, "--regid", "nogroup", "--clear-groups", "--", PYTHON, RUNNER, ...job.args], { cwd: job.cwd, env });
      let out = "";
      const keep = (d) => {
        out += d;
        if (out.length > 200_000) out = out.slice(-100_000);
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      const timer = setTimeout(() => child.kill("SIGKILL"), RENDER_TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        socket.end(`${JSON.stringify({ code: 1, out: `could not start the renderer: ${error.message}` })}\n`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        socket.end(`${JSON.stringify({ code, out })}\n`);
      });
      socket.on("close", () => child.exitCode === null && child.kill("SIGKILL"));
    });
  });
  server.listen(SOCKET, () => {
    chownSync(SOCKET, SERVER_UID, 0);
    log(`ready at ${SOCKET}`);
  });
  server.on("error", (error) => log(`render socket failed: ${error.message}`));
}

// The server, as its own user, with the container's environment. Its exit is the container's exit.
const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: node broker.mjs <server command…>");
  process.exit(2);
}
if (process.getuid?.() === 0) {
  try {
    serveRenders();
  } catch (error) {
    // Slides then fail closed (lib/screen/slide.ts); the website itself still starts.
    log(`no slide renders: ${error instanceof Error ? error.message : error}`);
  }
}
const asServer = process.getuid?.() === 0 ? ["setpriv", "--reuid", SERVER_USER, "--regid", SERVER_GROUP, "--init-groups", "--", ...command] : command;
const app = spawn(asServer[0], asServer.slice(1), { stdio: "inherit", env: { ...process.env, SCREEN_RENDER_BROKER: SOCKET } });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => app.kill(signal));
app.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
