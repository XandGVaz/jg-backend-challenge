# Desfaz a última migration versionada com undo/U<n>__*.sql (Flyway Community não tem undo).
FROM postgres:18-alpine
COPY scripts/undo.sh /database/scripts/undo.sh
COPY undo /database/undo
ENTRYPOINT ["sh", "/database/scripts/undo.sh"]
