import anyio

from app.mcp import server as mcp_server
from app.mcp.server import TOOL_SCOPES, WRITE_TOOL_NAMES, mcp


def test_list_tools_exposes_runtime_auth_metadata_per_tool() -> None:
    async def _assertions() -> None:
        listed_tools = await mcp.list_tools()
        tools_by_name = {tool.name: tool for tool in listed_tools}

        assert tools_by_name
        assert set(tools_by_name) == set(TOOL_SCOPES)

        for tool_name, scopes in TOOL_SCOPES.items():
            tool = tools_by_name[tool_name]
            assert isinstance(tool.meta, dict)
            if mcp_server._auth_runtime_enabled():
                assert tool.meta.get("securitySchemes") == [{"type": "oauth2", "scopes": scopes}]
            else:
                assert tool.meta.get("securitySchemes") == [{"type": "noauth"}]

            assert tool.annotations is not None
            # WP-0.2: readOnlyHint por NOMBRE de tool, no por sufijo de scope.
            assert tool.annotations.readOnlyHint is (tool_name not in WRITE_TOOL_NAMES)

        # Fijar explícitamente el fix (antes clasificados mal por el sufijo de scope):
        assert tools_by_name["ratify_proposal"].annotations.readOnlyHint is False
        assert tools_by_name["reject_proposal"].annotations.readOnlyHint is False
        assert tools_by_name["preview_write_impact"].annotations.readOnlyHint is True

    anyio.run(_assertions)


def test_tool_security_schemes_follow_auth_runtime(monkeypatch) -> None:
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", True)

    assert mcp_server._tool_security_schemes(["wis.context.read"]) == [{"type": "noauth"}]

    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)

    assert mcp_server._tool_security_schemes(["wis.context.read"]) == [
        {"type": "oauth2", "scopes": ["wis.context.read"]},
    ]
