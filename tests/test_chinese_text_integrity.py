from __future__ import annotations

from pathlib import Path

from app.templates.power_templates import get_power_templates


ROOT = Path(__file__).resolve().parents[1]
BAD_TOKENS = ["\u93c3", "\u93c8", "\u934c", "\u748b", "\u59ca", "\u9a9e", "\u9411", "\u6434", "????"]
SCAN_PATHS = [
    ROOT / "app" / "templates" / "power_templates.py",
    *sorted((ROOT / "app" / "explain").glob("*.py")),
    *sorted((ROOT / "app" / "api").glob("*.py")),
]


def test_display_sources_do_not_contain_mojibake_tokens() -> None:
    offenders: list[str] = []
    for path in SCAN_PATHS:
        text = path.read_text(encoding="utf-8")
        for token in BAD_TOKENS:
            if token in text:
                offenders.append(f"{path.relative_to(ROOT)}:{token.encode('unicode_escape').decode()}")
    assert not offenders


def test_power_templates_api_payload_does_not_contain_mojibake_tokens() -> None:
    text = str(get_power_templates())
    found = [token.encode("unicode_escape").decode() for token in BAD_TOKENS if token in text]
    assert not found
