#!/bin/sh
# Idempotente: create-queue com os mesmos atributos devolve a fila existente.
set -eu

: "${SQS_ENDPOINT:?SQS_ENDPOINT is required}"
: "${SQS_WAGER_TRANSACTIONS_QUEUE:=wager-transactions.fifo}"
: "${SQS_WAGER_TRANSACTIONS_DLQ:=wager-transactions-dlq.fifo}"
: "${SQS_WALLET_EVENTS_QUEUE:=wallet-events.fifo}"
: "${SQS_VISIBILITY_TIMEOUT_SECONDS:=30}"
: "${SQS_REDRIVE_MAX_RECEIVE_COUNT:=10}"

sqs() {
  aws --endpoint-url "$SQS_ENDPOINT" sqs "$@"
}

attempt=0
until sqs list-queues >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "queue-init: SQS endpoint unreachable at $SQS_ENDPOINT" >&2
    exit 1
  fi
  sleep 1
done

# 14 dias na DLQ: tempo de sobra para investigar e reprocessar manualmente.
dlq_url=$(sqs create-queue \
  --queue-name "$SQS_WAGER_TRANSACTIONS_DLQ" \
  --attributes FifoQueue=true,ContentBasedDeduplication=false,MessageRetentionPeriod=1209600 \
  --query QueueUrl --output text)
dlq_arn=$(sqs get-queue-attributes --queue-url "$dlq_url" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

redrive="{\\\"deadLetterTargetArn\\\":\\\"$dlq_arn\\\",\\\"maxReceiveCount\\\":\\\"$SQS_REDRIVE_MAX_RECEIVE_COUNT\\\"}"
queue_url=$(sqs create-queue \
  --queue-name "$SQS_WAGER_TRANSACTIONS_QUEUE" \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"VisibilityTimeout\":\"$SQS_VISIBILITY_TIMEOUT_SECONDS\",\"RedrivePolicy\":\"$redrive\"}" \
  --query QueueUrl --output text)

# Eventos da outbox: sem redrive (quem consome é externo); 14 dias cobrem um consumidor fora do ar.
events_url=$(sqs create-queue \
  --queue-name "$SQS_WALLET_EVENTS_QUEUE" \
  --attributes FifoQueue=true,ContentBasedDeduplication=false,MessageRetentionPeriod=1209600 \
  --query QueueUrl --output text)

echo "queue-init: ready queue=$queue_url dlq=$dlq_url events=$events_url maxReceiveCount=$SQS_REDRIVE_MAX_RECEIVE_COUNT"
