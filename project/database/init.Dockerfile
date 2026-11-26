# Dono único do schema: aplica as migrations SQL uma vez, antes das réplicas da api.
FROM flyway/flyway:13.13.0
COPY migrations /flyway/migrations
CMD ["migrate"]
