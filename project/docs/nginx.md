# nginx — proxy e balanceador

Único ponto de entrada HTTP. Balanceia entre as réplicas da [api](api.md) e garante um `X-Request-Id` em toda requisição.

| Item | Valor |
| --- | --- |
| Dockerfile | `nginx/Dockerfile` (`FROM nginx:1.31-alpine`) |
| Porta no host | `${HTTP_PORT:-8080}` → `80` |
| Config | `nginx/nginx.conf`, copiado para `/etc/nginx/nginx.conf` |
| Depende de | `api` saudável |

## Comportamento

- **Descoberta de réplicas:** `resolver 127.0.0.11 valid=10s` com `server api:3000 resolve` numa `zone` compartilhada. O nginx reavalia o DNS do Docker e passa a enxergar réplicas novas depois de um `--scale`, sem restart.
- **Correlation id:** preserva o `X-Request-Id` do cliente. Se ele não vier, gera um (`$request_id`). O valor segue para a api, aparece no `correlationId` das respostas de erro e no baggage OTel.
- **Retry entre réplicas:** `proxy_next_upstream error timeout`. Só falha de conexão ou timeout troca de réplica. Um `503` da api é resposta de negócio (falha transitória) e volta para o cliente: repetir em outra réplica poderia mascarar o problema.
- **Keepalive** de 32 conexões para o upstream (`proxy_http_version 1.1`, `Connection ""`).
- Limites: `client_max_body_size 1m`, `proxy_connect_timeout 2s`, `proxy_read_timeout 30s`.

## Logs

Access log em JSON no stdout:

```json
{"time":"…","requestId":"…","method":"POST","uri":"/wagering/transactions","status":201,"upstream":"172.18.0.7:3000","durationMs":0.012}
```

`upstream` mostra qual réplica atendeu, útil para confirmar o balanceamento. Esses logs vão só para o Docker (`docker compose logs nginx`), não para o Loki.

## Operação

```bash
curl -i http://localhost:8080/health/ready
curl -s -H 'X-Request-Id: teste-123' http://localhost:8080/rota-inexistente   # correlationId no erro
docker compose up -d --build nginx   # a config está na imagem: mudou o nginx.conf, refaça o build
docker compose exec nginx nginx -t
```
