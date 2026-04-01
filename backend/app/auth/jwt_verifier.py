from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError
from mcp.server.auth.provider import AccessToken, TokenVerifier


def normalize_scopes(raw_scope: str | list[str] | None) -> list[str]:
    if raw_scope is None:
        return []
    if isinstance(raw_scope, str):
        tokens = [scope.strip() for scope in raw_scope.replace(",", " ").split() if scope.strip()]
    else:
        tokens = [str(scope).strip() for scope in raw_scope if str(scope).strip()]
    # stable ordering to avoid churn in responses/logs/tests
    return sorted(set(tokens))


def decode_unverified_claims(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(token, options={"verify_signature": False, "verify_aud": False})
        if isinstance(claims, dict):
            return claims
    except Exception:  # noqa: BLE001
        pass
    return {}


def extract_scopes_from_claims(claims: dict[str, Any]) -> list[str]:
    if not isinstance(claims, dict):
        return []
    scope = claims.get("scope")
    if isinstance(scope, str):
        return normalize_scopes(scope)
    scp = claims.get("scp")
    if isinstance(scp, str):
        return normalize_scopes(scp)
    if isinstance(scp, list):
        return normalize_scopes([str(item) for item in scp])
    permissions = claims.get("permissions")
    if isinstance(permissions, list):
        return normalize_scopes([str(item) for item in permissions])
    return []


class Auth0JWTTokenVerifier(TokenVerifier):
    """Validates Auth0 JWT access tokens and maps them to MCP AccessToken."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        jwks_url: str,
        clock_skew_seconds: int = 60,
        algorithms: Iterable[str] = ("RS256",),
    ) -> None:
        self.issuer = issuer.rstrip("/") + "/"
        self.audience = audience
        self.jwks_client = PyJWKClient(jwks_url)
        self.clock_skew_seconds = clock_skew_seconds
        self.algorithms = list(algorithms)

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            signing_key = self.jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=self.algorithms,
                audience=self.audience,
                issuer=self.issuer,
                leeway=self.clock_skew_seconds,
                options={"require": ["iss", "aud", "exp"]},
            )
        except InvalidTokenError:
            return None
        except Exception:
            return None

        scopes = extract_scopes_from_claims(claims)
        expires_at = claims.get("exp")
        expires_at_value = int(expires_at) if isinstance(expires_at, (int, float)) else None
        client_id = str(
            claims.get("azp")
            or claims.get("client_id")
            or claims.get("sub")
            or "unknown",
        )
        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=scopes,
            expires_at=expires_at_value,
            resource=self.audience,
        )

