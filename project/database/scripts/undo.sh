#!/bin/sh
# Desfaz a última migration versionada aplicada: roda undo/U<versão>__*.sql e remove a linha do histórico.
# Flyway Community não tem `undo`; este script cumpre o "reversível" do REQUISITOS §4.
set -eu

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
UNDO_DIR="${UNDO_DIR:-/database/undo}"

current=$(psql -v ON_ERROR_STOP=1 -tA -c "
    SELECT version FROM flyway_schema_history
    WHERE success AND type = 'SQL' AND version IS NOT NULL
    ORDER BY installed_rank DESC LIMIT 1")

if [ -z "$current" ]; then
    echo "undo: nenhuma migration versionada aplicada, nada a desfazer"
    exit 0
fi

file=$(find "$UNDO_DIR" -maxdepth 1 -name "U${current}__*.sql" | head -n 1)

if [ -z "$file" ]; then
    echo "undo: arquivo U${current}__*.sql não encontrado em $UNDO_DIR" >&2
    exit 1
fi

echo "undo: revertendo versão $current com $(basename "$file")"

# Remover as linhas dos R__ força o Flyway a reaplicá-los no próximo migrate (são idempotentes).
psql -v ON_ERROR_STOP=1 --single-transaction -q \
    -f "$file" \
    -c "DELETE FROM flyway_schema_history WHERE version = '$current'" \
    -c "DELETE FROM flyway_schema_history WHERE version IS NULL"

echo "undo: versão $current revertida"
