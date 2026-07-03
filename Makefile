# Shared Dev Context Layer — atajos de operación
# Uso: make <target>

SHELL := /bin/bash
MCP_URL ?= http://localhost:8002/mcp
BACKEND_URL ?= http://localhost:8001

.PHONY: help up down logs ps health smoke native vsix test-ext

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

## --- Docker (camino principal) ---
up: ## Levanta postgres + migrate + backend + mcp (docker compose)
	docker compose up --build -d
	docker compose ps

down: ## Detiene y elimina los contenedores
	docker compose down

logs: ## Sigue los logs del servicio mcp
	docker compose logs -f mcp

ps: ## Estado de los contenedores
	docker compose ps

## --- Verificación ---
health: ## Chequea el backend REST
	@curl -fsS $(BACKEND_URL)/health && echo "" || echo "backend no responde"

smoke: ## Smoke test del MCP (read + dry_run write, no muta)
	@python scripts/smoke_mcp.py

## --- Sin docker (Postgres embebido) ---
native: ## Arranca todo el stack sin docker (pgserver). Ctrl-C para detener
	python scripts/dev_native.py

## --- Extensión VS Code ---
vsix: ## Compila la extensión
	cd vscode-extension && npm install && npm run compile

test-ext: ## Corre los tests de la extensión
	cd vscode-extension && npm test
