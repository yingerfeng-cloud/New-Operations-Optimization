"""macOS/Linux development stack ownership; no dependency on lsof visibility."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from uuid import uuid4
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
LOGS = Path(os.environ.get("OPTIFORGE_STACK_LOG_DIR", ROOT / "logs"))
STATE = LOGS / ".react-stack-state.json"


def process_identity(pid: int) -> str:
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=", "-o", "stat="], capture_output=True, text=True)
    value = result.stdout.strip()
    return value.rsplit(maxsplit=1)[0] if result.returncode == 0 and value and not value.split()[-1].startswith("Z") else ""


@contextmanager
def lifecycle_lock():
    LOGS.mkdir(parents=True, exist_ok=True)
    lock = LOGS / ".react-stack.lock"
    try:
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        try:
            owner = int(lock.read_text())
        except (ValueError, OSError):
            raise RuntimeError("服务启停锁缺少有效身份，请核查日志目录")
        if process_identity(owner):
            raise RuntimeError(f"已有服务启停操作正在运行（PID {owner}）")
        lock.unlink()
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(handle, "w") as stream:
        stream.write(str(os.getpid()))
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def assert_port_available(port: int):
    # A bind attempt observes the kernel's socket table even when another tool's
    # process or lsof inventory is hidden. Never truncate state before this check.
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as exc:
            raise RuntimeError(f"端口 {port} 已占用或不可绑定；未覆盖现有 PID/状态") from exc


def port_open(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def wait_ready(process, port: int, token: str, backend: bool):
    deadline = time.monotonic() + 40
    path = "/api/health" if backend else "/"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"服务 PID {process.pid} 在就绪前退出（{process.returncode}），请查看 stderr 日志")
        try:
            with urlopen(f"http://127.0.0.1:{port}{path}", timeout=1) as response:
                body = response.read()
                own = json.loads(body).get("instance_id") == token if backend else response.headers.get("X-OptiForge-Instance") == token
            if own and process.poll() is None:
                return
        except (OSError, ValueError):
            pass
        time.sleep(.2)
    raise RuntimeError(f"服务 PID {process.pid} 未在端口 {port} 返回本次启动身份")


def stop_owned(record: dict):
    pid = record["pid"]
    identity = process_identity(pid)
    expected = record["identity"]
    if len(expected.split()) > 5:
        expected = expected.rsplit(maxsplit=1)[0]
    if identity and identity != expected:
        raise RuntimeError(f"PID {pid} 已被其他进程复用，拒绝发送信号")
    if not identity:
        return
    if os.getpgid(pid) != pid:
        raise RuntimeError(f"PID {pid} 缺少本次启动的进程组身份")
    os.killpg(pid, signal.SIGTERM)
    deadline = time.monotonic() + 6
    while process_identity(pid) and time.monotonic() < deadline:
        time.sleep(.1)
    if process_identity(pid):
        os.killpg(pid, signal.SIGKILL)
        deadline = time.monotonic() + 3
        while process_identity(pid) and time.monotonic() < deadline:
            time.sleep(.1)
    if process_identity(pid):
        raise RuntimeError(f"服务 PID {pid} 仍未退出")


def start(args):
    for port in (args.api_port, args.frontend_port):
        assert_port_available(port)
    if STATE.exists():
        for record in json.loads(STATE.read_text())["processes"]:
            if process_identity(record["pid"]):
                raise RuntimeError("已有可管理服务仍在运行，请先执行 stop.sh")
    token = uuid4().hex
    env = {**os.environ, "OPTIFORGE_INSTANCE_ID": token, "SERVICE_MODE": "combined", "PORT": str(args.api_port),
           "VITE_API_BASE_URL": f"http://127.0.0.1:{args.api_port}"}
    node = __import__("shutil").which("node")
    if not node:
        raise RuntimeError("未找到 Node.js")
    processes = []
    try:
        for name, port, command, directory, backend in (
            ("api", args.api_port, [sys.executable, "-u", str(ROOT / "server.py")], ROOT, True),
            ("frontend", args.frontend_port, [node, str(ROOT / "frontend/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", str(args.frontend_port), "--strictPort"], ROOT / "frontend", False),
        ):
            with (LOGS / f"react-stack-{name}.stdout.log").open("w") as stdout, (LOGS / f"react-stack-{name}.stderr.log").open("w") as stderr:
                process = subprocess.Popen(command, cwd=directory, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            record = {"name": name, "pid": process.pid, "identity": process_identity(process.pid), "port": port}
            processes.append(record)
            wait_ready(process, port, token, backend)
        state = {"schema_version": 1, "instance_id": token, "processes": processes}
        temporary = STATE.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2))
        temporary.replace(STATE)
        for record in processes:
            (LOGS / f".react-stack-{record['name']}.pid").write_text(str(record["pid"]) + "\n")
    except Exception:
        for record in reversed(processes):
            stop_owned(record)
        raise
    print(f"服务已就绪：API http://127.0.0.1:{args.api_port}；前端 http://127.0.0.1:{args.frontend_port}")
    if not args.no_browser:
        webbrowser.open(f"http://127.0.0.1:{args.frontend_port}")


def stop():
    if not STATE.exists():
        old = [path for path in LOGS.glob(".*.pid") if path.name.startswith((".react-stack-", ".platform-"))]
        if any(process_identity(int(path.read_text(encoding="utf-8-sig").strip())) for path in old if path.read_text(encoding="utf-8-sig").strip().isdigit()):
            raise RuntimeError("旧 PID 文件缺少进程身份；未宣称停止，请核查原进程后清理旧状态")
        print("没有正在运行的受管服务")
        return
    state = json.loads(STATE.read_text())
    for record in reversed(state["processes"]):
        stop_owned(record)
    deadline = time.monotonic() + 3
    while any(port_open(row["port"]) for row in state["processes"]) and time.monotonic() < deadline:
        time.sleep(.1)
    occupied = [row["port"] for row in state["processes"] if port_open(row["port"])]
    if occupied:
        raise RuntimeError(f"目标端口仍被监听：{occupied}；未删除状态或宣称停止")
    for row in state["processes"]:
        (LOGS / f".react-stack-{row['name']}.pid").unlink(missing_ok=True)
    STATE.unlink()
    print("服务进程已退出，目标端口已关闭")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop"])
    parser.add_argument("--api-port", type=int, default=int(os.environ.get("API_PORT", 8000)))
    parser.add_argument("--frontend-port", type=int, default=int(os.environ.get("FRONTEND_PORT", 5173)))
    parser.add_argument("--no-browser", action="store_true", default=os.environ.get("NO_BROWSER") == "1")
    arguments = parser.parse_args()
    try:
        with lifecycle_lock():
            start(arguments) if arguments.action == "start" else stop()
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
