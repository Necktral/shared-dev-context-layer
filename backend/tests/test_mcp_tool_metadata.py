import anyio

from app.mcp.server import TOOL_SCOPES, mcp


def _is_write_tool(scopes: list[str]) -> bool:
    return any(scope.endswith(".write") for scope in scopes)


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
            assert tool.annotations.readOnlyHint is (not _is_write_tool(scopes))

    anyio.run(_assertions)
