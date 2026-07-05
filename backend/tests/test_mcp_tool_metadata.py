import anyio

from app.mcp.server import TOOL_SCOPES, WRITE_TOOL_NAMES, mcp


def test_list_tools_exposes_auth_metadata_per_tool() -> None:
    async def _assertions() -> None:
        listed_tools = await mcp.list_tools()
        tools_by_name = {tool.name: tool for tool in listed_tools}

        assert tools_by_name
        assert set(tools_by_name) == set(TOOL_SCOPES)

        for tool_name, scopes in TOOL_SCOPES.items():
            tool = tools_by_name[tool_name]
            assert isinstance(tool.meta, dict)
            assert tool.meta.get("securitySchemes") == [{"type": "oauth2", "scopes": scopes}]

            assert tool.annotations is not None
            # WP-0.2: readOnlyHint por NOMBRE de tool, no por sufijo de scope.
            assert tool.annotations.readOnlyHint is (tool_name not in WRITE_TOOL_NAMES)

        # Fijar explícitamente el fix (antes clasificados mal por el sufijo de scope):
        assert tools_by_name["ratify_proposal"].annotations.readOnlyHint is False
        assert tools_by_name["reject_proposal"].annotations.readOnlyHint is False
        assert tools_by_name["preview_write_impact"].annotations.readOnlyHint is True

    anyio.run(_assertions)
