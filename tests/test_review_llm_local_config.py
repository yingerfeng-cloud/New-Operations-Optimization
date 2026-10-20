"""Local credential entry, safe import, and portable encrypted persistence."""
import json
from pathlib import Path

from app.services.llm_service import LLMService, llm_service
from app.storage.memory_store import STORE, MemoryStore


def local_config(tmp_path, monkeypatch, **overrides):
    path = tmp_path / "llm.local.json"
    monkeypatch.setenv("OPTIFORGE_LLM_CONFIG_FILE", str(path))
    path.write_text(json.dumps({"provider": "volcengine_ark", "base_url": "https://ark.example/v3",
        "model": "synthetic-endpoint", "enabled": True, "api_key": "synthetic-private-key", **overrides}))
    path.chmod(0o600)
    return path


def test_local_file_import_encrypts_key_and_settings_remain_authoritative(client, tmp_path, monkeypatch):
    path = local_config(tmp_path, monkeypatch)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("ARK_API_KEY", raising=False)
    response = client.post("/api/llm/config/import-local")
    assert response.status_code == 200, response.text
    assert "synthetic-private-key" not in response.text
    assert response.json()["api_key_configured"]
    assert response.json()["last_imported_from"] == str(path)
    stored = json.loads(STORE.persistence_path.read_text())["llm_config"]
    assert stored["key_ciphertext"].startswith("fernet:v1:")
    assert "synthetic-private-key" not in json.dumps(stored)
    restored = MemoryStore()
    assert restored.llm_config["key_ciphertext"] == stored["key_ciphertext"]
    monkeypatch.setattr("app.services.llm_service.STORE", restored)
    assert LLMService()._api_key() == "synthetic-private-key"
    assert client.put("/api/llm/config", json={"model": "settings-edit"}).status_code == 200
    assert client.get("/api/llm/config").json()["model"] == "settings-edit"
    assert path.read_text().find("synthetic-endpoint") >= 0  # No implicit reimport.


def test_invalid_or_empty_file_never_destroys_the_previous_key(client, tmp_path, monkeypatch):
    path = local_config(tmp_path, monkeypatch)
    assert client.post("/api/llm/config/import-local").status_code == 200
    original = dict(STORE.llm_config)
    for value in ["{invalid:SYNTHETIC_SECRET}", "[]", json.dumps({"api_key": ""}),
                  json.dumps({"api_key": "SYNTHETIC_SECRET", "key_ciphertext": "do-not-trust"}),
                  json.dumps({"provider": "volcengine_ark", "base_url": "https://ark.example/v3", "model": "synthetic", "api_key": "SYNTHETIC_SECRET", "max_tokens": "SYNTHETIC_SECRET"})]:
        path.write_text(value)
        response = client.post("/api/llm/config/import-local")
        assert response.status_code == 422
        assert "SYNTHETIC_SECRET" not in response.text
        assert STORE.llm_config == original
    path.unlink()
    assert client.post("/api/llm/config/import-local").status_code == 404
    assert STORE.llm_config == original


def test_default_local_file_follows_the_actual_runtime_directory(monkeypatch):
    monkeypatch.delenv("OPTIFORGE_LLM_CONFIG_FILE", raising=False)
    assert llm_service.local_config_path() == STORE.persistence_path.parent / "llm.local.json"
    assert Path(llm_service.config()["local_config_file"]).parent == STORE.persistence_path.parent
