# Dono único das filas: cria fila principal e DLQ, como o Terraform/CloudFormation faria na AWS.
FROM amazon/aws-cli:2.42.4
COPY scripts/create-queues.sh /usr/local/bin/create-queues.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/create-queues.sh"]
