from __future__ import annotations

import base64
import json
import subprocess
import time
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT_DIR / "scripts" / "validate_oauth_token_claims.sh"


def _b64url(data: dict[str, object]) -> str:
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _fake_jwt(payload: dict[str, object]) -> str:
    header = {"alg": "none", "typ": "JWT"}
    return f"{_b64url(header)}.{_b64url(payload)}.signature"


def test_validate_oauth_token_claims_script_accepts_valid_payload() -> None:
    if not SCRIPT_PATH.exists():
        pytest.skip(f"Script no disponible en este entorno: {SCRIPT_PATH}")

    token = _fake_jwt(
        {
            "iss": "https://necktral.us.auth0.com/",
            "aud": "https://wis-context-sync-read-api",
            "exp": int(time.time()) + 3600,
            "scope": "wis.context.read wis.context.sync.read",
        }
    )

    result = subprocess.run(
        [
            "bash",
            str(SCRIPT_PATH),
            "--token",
            token,
            "--expected-iss",
            "https://necktral.us.auth0.com/",
            "--expected-aud",
            "https://wis-context-sync-read-api",
            "--require-scopes",
            "wis.context.read,wis.context.sync.read",
        ],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    assert "JWT claims validation PASSED" in result.stdout


def test_validate_oauth_token_claims_script_rejects_missing_scope_and_expired() -> None:
    if not SCRIPT_PATH.exists():
        pytest.skip(f"Script no disponible en este entorno: {SCRIPT_PATH}")

    missing_scope_token = _fake_jwt(
        {
            "iss": "https://necktral.us.auth0.com/",
            "aud": "https://wis-context-sync-read-api",
            "exp": int(time.time()) + 3600,
        }
    )
    expired_token = _fake_jwt(
        {
            "iss": "https://necktral.us.auth0.com/",
            "aud": "https://wis-context-sync-read-api",
            "exp": int(time.time()) - 10,
            "scope": "wis.context.read",
        }
    )

    for token, expected_error in (
        (missing_scope_token, "missing scope/scp claim"),
        (expired_token, "token expired"),
    ):
        result = subprocess.run(
            ["bash", str(SCRIPT_PATH), "--token", token],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        output = f"{result.stdout}\n{result.stderr}".lower()
        assert expected_error in output
