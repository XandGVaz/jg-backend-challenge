#!/bin/sh
# Teste de carga com k6 em container, isolado da api. Chamado por `bun run test:load` (project/api).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
project=$(cd "$here/.." && pwd)

K6_IMAGE="grafana/k6:1.0.0"
NETWORK="${LOAD_TEST_NETWORK:-wagering_default}"
HOST_URL="http://localhost:${HTTP_PORT:-8080}"
PROM_URL="http://localhost:${PROMETHEUS_PORT:-9090}"
: "${RATE:=50}"
: "${DURATION:=60s}"
: "${VUS:=50}"
: "${WALLETS:=20}"

if ! curl -fsS "$HOST_URL/health/ready" >/dev/null 2>&1; then
  echo "load-test: a stack não está pronta em $HOST_URL; suba com:" >&2
  echo "  cd $project && docker compose up -d --build --scale api=3 --scale worker=2 --wait" >&2
  exit 1
fi

# Sem SCENARIOS explícito, roda só o que a API já expõe (os cenários de aposta exigem /wallets e /wagering/transactions).
route_exists() {
  # Corpo vazio: 400 se a rota existe (nada é gravado), 404 se não existe.
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$HOST_URL$1")
  [ "$code" != "404" ]
}

if [ -z "${SCENARIOS:-}" ]; then
  if route_exists /wallets && route_exists /wagering/transactions; then
    SCENARIOS="health,distinct,hot,duplicate"
  else
    SCENARIOS="health"
    echo "load-test: /wagering/transactions ainda não existe; rodando só o cenário health" >&2
  fi
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$here/k6-results/$stamp"
mkdir -p "$out"

prom() {
  curl -fsS --get "$PROM_URL/api/v1/query" --data-urlencode "query=$1" 2>/dev/null \
    | sed -n 's/.*"value":\[[^,]*,"\([^"]*\)"\].*/\1/p'
}

conflicts_before=$(prom 'sum(wagering_lock_conflicts_total)')
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
start_epoch=$(date +%s)

set +e
docker run --rm --network "$NETWORK" -u "$(id -u):$(id -g)" \
  -v "$here/k6:/scripts:ro" -v "$out:/results" \
  -e BASE_URL=http://nginx -e OUT_DIR=/results \
  -e SCENARIOS="$SCENARIOS" -e RATE="$RATE" -e DURATION="$DURATION" -e VUS="$VUS" -e WALLETS="$WALLETS" \
  "$K6_IMAGE" run --quiet /scripts/load.js
k6_status=$?
set -e

elapsed=$(( $(date +%s) - start_epoch ))
conflicts_after=$(prom 'sum(wagering_lock_conflicts_total)')
lag_max=$(prom "max(max_over_time(wagering_outbox_lag_seconds[${elapsed}s]))")
pending_max=$(prom "max(max_over_time(wagering_outbox_pending[${elapsed}s]))")
api_replicas=$(cd "$project" && docker compose ps --status running --format '{{.Service}}' 2>/dev/null | grep -cx api || true)
worker_replicas=$(cd "$project" && docker compose ps --status running --format '{{.Service}}' 2>/dev/null | grep -cx worker || true)
mem_total=$(awk '/MemTotal/ {printf "%.1f GiB", $2/1048576}' /proc/meminfo 2>/dev/null || echo '?')
cpu_model=$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || echo '?')

delta() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo 'sem dados'; else awk -v a="$1" -v b="$2" 'BEGIN {print b - a}'; fi
}

{
  echo "# Teste de carga — $started"
  echo
  echo "## Ambiente"
  echo
  echo "| Item | Valor |"
  echo "| --- | --- |"
  echo "| Máquina | $cpu_model, $(nproc) CPUs, $mem_total |"
  echo "| Docker | $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') |"
  echo "| Réplicas | api=$api_replicas, worker=$worker_replicas (atrás do nginx) |"
  echo "| Gerador | $K6_IMAGE em container próprio, na rede \`$NETWORK\` |"
  echo
  echo "## Metodologia"
  echo
  echo "- Cenários: \`$SCENARIOS\`; taxa constante de $RATE iterações/s por cenário durante $DURATION, até $VUS VUs."
  echo "- \`distinct\`: apostas de 1,00 em $WALLETS wallets diferentes; \`hot\`: todas na mesma wallet; \`duplicate\`: a mesma aposta enviada por $VUS VUs ao mesmo tempo."
  echo "- Latência medida no cliente, passando pelo nginx. Conflitos de lock e atraso da outbox vêm do Prometheus, no intervalo do teste (${elapsed}s)."
  echo
  echo "## Resultados (cliente, k6)"
  echo
  cat "$out/k6.md" 2>/dev/null || echo "k6 não gerou o resumo (saída $k6_status)."
  echo
  echo "## Resultados (servidor, Prometheus)"
  echo
  echo "| Métrica | Valor |"
  echo "| --- | --- |"
  echo "| Conflitos de lock (\`wagering_lock_conflicts_total\`, variação) | $(delta "$conflicts_before" "$conflicts_after") |"
  echo "| Outbox lag máximo (\`wagering_outbox_lag_seconds\`) | ${lag_max:-sem dados} |"
  echo "| Pendentes na outbox, máximo (\`wagering_outbox_pending\`) | ${pending_max:-sem dados} |"
  echo
  echo "## Análise"
  echo
  echo "_Preencher: o que limitou o throughput, como os conflitos cresceram no cenário hot, e o que os números não mostram._"
} > "$out/report.md"

echo "load-test: relatório em $out/report.md (k6 saiu com $k6_status)"
exit "$k6_status"
