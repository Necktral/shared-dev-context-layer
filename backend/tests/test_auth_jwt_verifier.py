import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from app.auth.jwt_verifier import (
    Auth0JWTTokenVerifier,
    decode_unverified_claims,
    extract_scopes_from_claims,
    normalize_scopes,
)


def test_normalize_scopes_and_extractors() -> None:
    assert normalize_scopes("a b,a") == ["a", "b"]
    assert normalize_scopes(["b", "a", "a"]) == ["a", "b"]
    assert extract_scopes_from_claims({"scope": "x y"}) == ["x", "y"]
    assert extract_scopes_from_claims({"scp": ["w", "r"]}) == ["r", "w"]
    assert extract_scopes_from_claims({"permissions": ["p2", "p1"]}) == ["p1", "p2"]


def test_decode_unverified_claims_handles_bad_tokens() -> None:
    assert decode_unverified_claims("not-a-jwt") == {}


def test_auth0_verifier_maps_claims_to_access_token() -> None:
    verifier = Auth0JWTTokenVerifier(
        issuer="https://tenant.auth0.com/",
        audience="https://wis-context-sync-api",
        jwks_url="https://tenant.auth0.com/.well-known/jwks.json",
        resource_id="https://mcp.resource.id",
    )

    claims = {
        "iss": "https://tenant.auth0.com/",
        "aud": "https://wis-context-sync-api",
        "exp": 4102444800,
        "scope": "wis.context.read wis.context.write",
        "sub": "auth0|user-123",
    }

    with patch.object(verifier.jwks_client, "get_signing_key_from_jwt", return_value=SimpleNamespace(key="fake")):
        with patch("app.auth.jwt_verifier.jwt.decode", return_value=claims):
            token = asyncio.run(verifier.verify_token("header.payload.signature"))

    assert token is not None
    assert token.client_id == "auth0|user-123"
    assert token.resource == "https://mcp.resource.id"
    assert sorted(token.scopes) == ["wis.context.read", "wis.context.write"]
    assert token.expires_at == 4102444800
