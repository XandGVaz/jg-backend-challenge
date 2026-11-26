# grafana — dashboards e exploração

Interface única para métricas ([Prometheus](prometheus.md)), logs ([Loki](loki.md)) e traces ([Jaeger](jaeger.md)). Datasources e dashboards são provisionados a partir do repositório. As seções 5 a 9 são a **referência do formato dos dashboards**.

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `observability/grafana/Dockerfile` (`FROM grafana/grafana:13.3.2`) |
| Porta no host | `${GRAFANA_PORT:-3000}` → `3000` |
| Arquivos copiados | `provisioning/` → `/etc/grafana/provisioning`, `dashboards/` → `/etc/grafana/dashboards` |
| Volume | `grafana-data` → `/var/lib/grafana` |
| Login | `${GRAFANA_ADMIN_USER:-admin}` / `${GRAFANA_ADMIN_PASSWORD:-admin}`; acesso anônimo como `Viewer` |
| Home | dashboard `wagering-api` |

## 2. Datasources (`provisioning/datasources/datasources.yaml`)

| Nome | uid | URL | Ligações |
| --- | --- | --- | --- |
| Prometheus | `prometheus` | `http://prometheus:9090` | padrão, `timeInterval: 10s` |
| Loki | `loki` | `http://loki:3100` | campo derivado `trace_id` → Jaeger |
| Jaeger | `jaeger` | `http://jaeger:16686` | `tracesToLogsV2` → Loki pelo `trace_id` |

## 3. Provisionamento de dashboards (`provisioning/dashboards/dashboards.yaml`)

Provider `wagering`, pasta **Wagering**, lê os JSON de `/etc/grafana/dashboards` (copiados de `observability/grafana/dashboards/`). O caminho fica fora de `/var/lib/grafana` de propósito: o volume `grafana-data` esconderia os dashboards da imagem. Com `allowUiUpdates: false` e `disableDeletion: true`, o arquivo no repositório é a fonte da verdade: mudança feita na UI não é salva.

## 4. Uso e operação

- <http://localhost:3000> → pasta Wagering.
- Explore → Loki: filtre pelo `correlationId` de uma resposta de erro e clique no `trace_id` para abrir o trace.
- Explore → Jaeger: abra um trace e use "Logs for this span".

```bash
docker compose up -d --build grafana   # dashboards e provisioning estão na imagem
docker compose logs grafana | grep -i provision
```

## 5. Arquivo

- Um JSON por dashboard em `observability/grafana/dashboards/<uid>.json`.
- Datasources **por uid fixo**: `{ "type": "prometheus", "uid": "prometheus" }`, `loki`, `jaeger`. Nunca por nome, `${DS_…}` ou `__inputs` de export.
- `uid` = nome do arquivo, kebab-case, prefixo `wagering-`. `title` em português com prefixo `Wagering — `.
- `id` dos painéis único e sequencial no arquivo. Todo painel tem `description`.

## 6. Esqueleto

```json
{
  "uid": "wagering-processing",
  "title": "Wagering — Processamento",
  "tags": ["wagering"],
  "timezone": "browser",
  "schemaVersion": 41,
  "version": 1,
  "refresh": "10s",
  "time": { "from": "now-30m", "to": "now" },
  "templating": { "list": [ { "name": "service", "type": "query", "datasource": { "type": "prometheus", "uid": "prometheus" }, "query": { "query": "label_values(http_server_request_duration_seconds_count, job)", "refId": "service" }, "refresh": 2 } ] },
  "panels": []
}
```

Toda consulta filtra `job="$service"`. Variável `instance` opcional (`label_values(..., instance)`, multi, include all) quando o dashboard compara réplicas.

## 7. Layout

Grade de 24 colunas, de cima para baixo:

| Faixa | Painéis | `gridPos` |
| --- | --- | --- |
| Indicadores | 4 `stat` | `w: 6, h: 4` |
| Seções | painel `row` por assunto | `w: 24, h: 1` |
| Séries | `timeseries` em pares | `w: 12, h: 8` |
| Logs | 1 `logs` (Loki) no fim | `w: 24, h: 10` |

## 8. Consultas e unidades

| Caso | Padrão |
| --- | --- |
| Contador | `sum by (...) (rate(x_total{job="$service"}[$__rate_interval]))`, nunca o `_total` cru |
| Quantil | `histogram_quantile(q, sum by (le, <dim>) (rate(x_bucket[$__rate_interval])))`, com p50, p95 e p99 |
| Razão | numerador `... or vector(0)`, denominador `clamp_min(..., 1e-9)` |
| Gauge compartilhado entre réplicas (outbox, filas) | `max(...)`, nunca `sum(...)` ([prometheus.md](prometheus.md), seção 7) |
| Legenda | `legendFormat` com as dimensões do `by` (`{{wagering_transaction_status}}`) |

Unidades: `s` (latência), `reqps` ou `ops` (taxas), `percentunit` (razões 0–1), `short` (contagens). Limiares só onde há alvo (taxa de erro, outbox lag, DLQ). DLQ > 0 é vermelho.

## 9. Dashboards

| Arquivo / uid | Estado | Conteúdo |
| --- | --- | --- |
| `wagering-api` | existe | req/s, taxa 5xx, latência p99, instâncias ativas; req/s por rota e status, latência p50/p95/p99 por rota, req/s por instância, 4xx/5xx; logs warn/error |
| `wagering-processing` | planejado | stats: transações/s, % rejeitadas, p99 de processamento, conflitos de lock/s. Séries: transações por `status` e por `kind`, rejeições por `failure_code`, duplicatas por `outcome`, conflitos de lock por `use_case`, retries por `operation`, latência p50/p95/p99 por `kind`, pending reference por `outcome`, reconciliações inconsistentes |
| `wagering-messaging` | planejado | stats: profundidade da fila, profundidade da DLQ, outbox pendente, outbox lag. Séries: mensagens SQS por `outcome`/`reason`, inbox duplicadas, profundidade por fila, outbox lag e pendentes, publicações por `event_type`/`outcome`, atraso commit → publish p95 |

Um dashboard planejado só é criado junto com as métricas que ele consulta ([prometheus.md](prometheus.md), seção 6).
