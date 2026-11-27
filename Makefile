# Distributed Wagering Processor: atalhos para subir, testar e operar o projeto.
# Rode `make` (ou `make help`) para ver os comandos. Só exige Docker; o Bun local é opcional.

SHELL := /bin/sh
.DEFAULT_GOAL := help

PROJECT_DIR := $(CURDIR)/project
API_DIR     := $(PROJECT_DIR)/api
COMPOSE     := docker compose --project-directory $(PROJECT_DIR) -f $(PROJECT_DIR)/docker-compose.yml

API_REPLICAS    ?= 3
WORKER_REPLICAS ?= 2
SERVICE         ?=
SQS_PORT        ?= 4566
NETWORK         ?= wagering_default
BUN_IMAGE       ?= oven/bun:1-alpine

# Bun local quando instalado; senão, um container com project/api montado.
ifneq ($(shell command -v bun 2>/dev/null),)
  BUN         := cd $(API_DIR) && bun
  BUN_E2E     := cd $(API_DIR) && SQS_ENDPOINT=http://localhost:$(SQS_PORT) bun
else
  BUN_DOCKER  := docker run --rm -t -u $(shell id -u):$(shell id -g) -e HOME=/tmp -v $(API_DIR):/app -w /app
  BUN         := $(BUN_DOCKER) $(BUN_IMAGE) bun
  BUN_E2E     := $(BUN_DOCKER) --network $(NETWORK) -e SQS_ENDPOINT=http://queue:4566 $(BUN_IMAGE) bun
endif

##@ Ajuda

.PHONY: help
help: ## Mostra esta lista de comandos
	@awk 'BEGIN { FS = ":.*##"; printf "\nUso: make \033[36m<comando>\033[0m [VARIÁVEL=valor]\n" } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } \
		/^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf "\nVariáveis: API_REPLICAS=$(API_REPLICAS) WORKER_REPLICAS=$(WORKER_REPLICAS) SERVICE=<serviço do Compose>\n"
	@printf "Exemplos:  make up API_REPLICAS=5   make logs SERVICE=worker   make rebuild SERVICE=nginx\n\n"

##@ Ambiente (Docker Compose)

.PHONY: env up down restart clean ps logs rebuild urls
env: ## Cria project/.env a partir do .env.example (opcional: os defaults já funcionam)
	@test -f $(PROJECT_DIR)/.env && echo "project/.env já existe; nada a fazer" || cp $(PROJECT_DIR)/.env.example $(PROJECT_DIR)/.env

up: ## Constrói e sobe a stack completa e espera ficar saudável
	$(COMPOSE) up -d --build --scale api=$(API_REPLICAS) --scale worker=$(WORKER_REPLICAS) --wait
	@$(MAKE) --no-print-directory urls

down: ## Para e remove os containers (mantém os volumes)
	$(COMPOSE) down

restart: down up ## Recria a stack do zero (sem apagar dados)

clean: ## Para tudo e apaga os volumes (banco, métricas, logs e dashboards)
	$(COMPOSE) down -v --remove-orphans

ps: ## Lista os containers e o estado de saúde de cada um
	$(COMPOSE) ps

logs: ## Acompanha os logs (todos, ou só SERVICE=<serviço>)
	$(COMPOSE) logs -f --tail=100 $(SERVICE)

rebuild: ## Reconstrói e reinicia um serviço: make rebuild SERVICE=<serviço>
	@test -n "$(SERVICE)" || { echo "informe o serviço: make rebuild SERVICE=api"; exit 1; }
	$(COMPOSE) up -d --build --no-deps $(SERVICE)

urls: ## Mostra os endereços da API e da observabilidade
	@printf "\n  API         http://localhost:8080\n  Swagger     http://localhost:8080/docs\n  Grafana     http://localhost:3000 (admin/admin)\n  Jaeger      http://localhost:16686\n  Prometheus  http://localhost:9090\n\n"

##@ Testes e qualidade

.PHONY: install test test-unit test-e2e test-load typecheck lint check
install: ## Instala as dependências da API (project/api/node_modules)
	$(BUN) install --frozen-lockfile

test: install ## Roda todos os testes; os e2e de SQS só rodam com a stack de pé
	@if docker network inspect $(NETWORK) >/dev/null 2>&1; then \
		echo "stack de pé: rodando unitários e e2e"; $(BUN_E2E) test; \
	else \
		echo "stack fora do ar: os e2e de SQS serão pulados (suba com make up)"; $(BUN) test; \
	fi

test-unit: install ## Roda só os testes unitários (não precisa da stack)
	$(BUN) test src

test-e2e: install ## Roda os testes e2e contra o SQS do emulador (exige `make up`)
	$(BUN_E2E) test test

test-load: ## Teste de carga com k6 em container (exige `make up`; RATE, DURATION, SCENARIOS)
	sh $(PROJECT_DIR)/load-test/run.sh

typecheck: install ## Checa os tipos do TypeScript
	$(BUN) run typecheck

lint: install ## Roda o linter (oxlint)
	$(BUN) run lint

check: typecheck lint test-unit ## Typecheck, lint e testes unitários (o que rodar antes de um commit)

##@ Banco de dados (Flyway)

.PHONY: db-info db-migrate db-undo
db-info: ## Lista as migrations aplicadas e as pendentes
	$(COMPOSE) run --rm database-init info

db-migrate: ## Aplica as migrations pendentes
	$(COMPOSE) run --rm database-init migrate

db-undo: ## Reverte a última migration versionada
	$(COMPOSE) run --rm database-undo
