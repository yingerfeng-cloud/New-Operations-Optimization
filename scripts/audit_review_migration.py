"""Read-only I-06 inventory. No application startup and no credential decryption."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.migration_audit import audit_runtime_copy  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="An exported deployment copy, never the live file")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--secret-file", type=Path, help="Checks existence only; never reads secret contents")
    parser.add_argument("--synthetic", action="store_true", help="Explicitly label a synthetic fixture")
    args = parser.parse_args()
    source = args.input.resolve()
    if source == args.output.resolve():
        parser.error("output must differ from the input copy")
    raw = source.read_bytes()
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        parser.error("runtime JSON must be an object")
    report = audit_runtime_copy(payload, secret_file_present=(args.secret_file or source.parent / ".optiforge-config-secret").is_file(), environment_secret_present=bool(os.getenv("OPTIFORGE_CONFIG_SECRET")))
    report.update(source_sha256=hashlib.sha256(raw).hexdigest(), synthetic_fixture=args.synthetic, provenance="synthetic" if args.synthetic else "provided_copy_not_independently_verified")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), **report["summary"], "synthetic_fixture": args.synthetic}))


if __name__ == "__main__":
    main()
