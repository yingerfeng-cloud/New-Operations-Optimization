"""Real occupied sockets with an intentionally empty lsof inventory."""
import importlib.util
from pathlib import Path
import socket

import pytest


def lifecycle():
    path = Path(__file__).resolve().parents[1] / 'scripts/stack_lifecycle.py'
    spec = importlib.util.spec_from_file_location('cloud_stack_lifecycle', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_occupied_port_is_rejected_without_process_inventory(tmp_path, monkeypatch):
    module = lifecycle()
    stub = tmp_path / 'lsof'
    stub.write_text('#!/bin/sh\nexit 0\n')
    stub.chmod(0o700)
    monkeypatch.setenv('PATH', str(tmp_path))
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', 0))
        occupied.listen()
        with pytest.raises(RuntimeError, match='未覆盖现有 PID'):
            module.assert_port_available(occupied.getsockname()[1])


def test_failed_start_probe_preserves_existing_identity_files(tmp_path, monkeypatch):
    import argparse
    module = lifecycle()
    monkeypatch.setattr(module, 'LOGS', tmp_path)
    monkeypatch.setattr(module, 'STATE', tmp_path / '.react-stack-state.json')
    module.STATE.write_text('original-state')
    pid_file = tmp_path / '.react-stack-api.pid'
    pid_file.write_text('original-pid')
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', 0))
        occupied.listen()
        with pytest.raises(RuntimeError):
            module.start(argparse.Namespace(api_port=occupied.getsockname()[1], frontend_port=5179, no_browser=True))
    assert module.STATE.read_text() == 'original-state'
    assert pid_file.read_text() == 'original-pid'
