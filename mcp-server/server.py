"""Standalone MCP server for the Shared Dev Context Layer.

Provides a lightweight MCP server that can run independently of the full
backend, useful for development, testing, and quick integrations.

Run via STDIO (default):
    python server.py

Run via HTTP (streamable-http):
    python server.py --transport streamable-http --port 8003
"""
from __future__ import annotations

import datetime
import platform
import sys
from typing import Any

from mcp.server.fastmcp import FastMCP

__version__ = "0.1.0"

mcp = FastMCP(
    name="Shared Dev Context Layer MCP",
    instructions=(
        "Lightweight MCP server for the Shared Dev Context Layer. "
        "Provides utility tools for development context and diagnostics."
    ),
)


@mcp.tool(description="Check server liveness. Returns ok and a UTC timestamp.")
def ping() -> dict[str, Any]:
    return {
        "status": "ok",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@mcp.tool(description="Return basic server information and runtime metadata.")
def server_info() -> dict[str, Any]:
    return {
        "name": "Shared Dev Context Layer MCP",
        "version": __version__,
        "python": sys.version,
        "platform": platform.platform(),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@mcp.tool(description="Echo the provided message back to the caller.")
def echo(message: str) -> dict[str, Any]:
    return {
        "status": "ok",
        "echo": message,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Standalone MCP server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http"],
        default="stdio",
        help="Transport to use (default: stdio)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind when using streamable-http (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8003,
        help="Port to bind when using streamable-http (default: 8003)",
    )
    args = parser.parse_args()

    if args.transport == "streamable-http":
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        mcp.run(transport="streamable-http")
    else:
        mcp.run(transport="stdio")
