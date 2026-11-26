FROM grafana/grafana:13.3.2
COPY provisioning /etc/grafana/provisioning
# Fora de /var/lib/grafana: o volume grafana-data esconderia os dashboards da imagem.
COPY dashboards /etc/grafana/dashboards
