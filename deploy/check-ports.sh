#!/usr/bin/env bash
#
# Qué hay ocupado en este VPS y qué puerto libre puede usar SEO Crawler.
#
# Sólo lee: no cambia nada. Pensado para ejecutarlo ANTES de desplegar en un
# servidor donde ya viven otros proyectos.
#
#   bash deploy/check-ports.sh
#
# Sin sudo funciona, pero no verá de qué proceso es cada puerto: los nombres
# de procesos ajenos sólo los muestra root.

set -uo pipefail

RANGE_START=${RANGE_START:-3200}
RANGE_END=${RANGE_END:-3299}

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  printf '\033[33mAviso:\033[0m sin sudo no se ven los procesos dueños de cada puerto.\n'
  printf 'Para el detalle completo:  sudo bash %s\n' "$0"
fi

bold '1. Puertos TCP a la escucha'
if command -v ss >/dev/null 2>&1; then
  ss -tulpn 2>/dev/null | grep -E 'LISTEN|UNCONN' || echo '  (nada)'
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulpn 2>/dev/null | grep LISTEN || echo '  (nada)'
else
  echo '  Instala iproute2 (ss) o net-tools (netstat).'
fi

bold '2. Sólo los puertos locales ocupados, ordenados'
# El quinto campo de `ss` es la dirección local. Quedarse con lo que hay tras
# el último ':' cubre todas sus formas: 0.0.0.0:80, [::]:80, *:68 y hasta
# 127.0.0.53%lo:53.
if command -v ss >/dev/null 2>&1; then
  LISTENING=$(ss -tulnH 2>/dev/null | awk '{print $5}' | sed 's/.*://' |
    grep -E '^[0-9]+$' | sort -n -u)
  PORTS_READ=1
elif command -v netstat >/dev/null 2>&1; then
  LISTENING=$(netstat -tuln 2>/dev/null | awk '{print $4}' | sed 's/.*://' |
    grep -E '^[0-9]+$' | sort -n -u)
  PORTS_READ=1
else
  LISTENING=''
  PORTS_READ=0
fi

if [ "$PORTS_READ" -eq 1 ] && [ -n "$LISTENING" ]; then
  echo "$LISTENING" | tr '\n' ' '
  echo
else
  printf '  \033[31mNo se pudo leer la lista de puertos.\033[0m\n'
  printf '  Instala iproute2 (paquete `iproute2`) y vuelve a ejecutarlo: sin\n'
  printf '  esto, el puerto que proponga el paso 6 NO es fiable.\n'
  PORTS_READ=0
fi

bold '3. Dominios que nginx ya sirve'
if command -v nginx >/dev/null 2>&1; then
  nginx -T 2>/dev/null | grep -E '^\s*(server_name|listen|proxy_pass)' |
    sed 's/^\s*/  /' | sort -u || echo '  (no se pudo leer; prueba con sudo)'
  echo
  echo '  Sitios habilitados:'
  ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/    /' || echo '    (sin sites-enabled)'
else
  echo '  nginx no está instalado.'
fi

bold '4. Contenedores Docker publicando puertos'
if command -v docker >/dev/null 2>&1; then
  docker ps --format '  {{.Names}}\t{{.Ports}}' 2>/dev/null || echo '  (sin permiso para consultar Docker)'
else
  echo '  Docker no está instalado.'
fi

bold '5. Servicios de aplicación ya activos'
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null |
  grep -Ei 'node|pm2|next|gunicorn|uwsgi|php-fpm|java|puma|passenger' |
  sed 's/^/  /' || echo '  (ninguno reconocible)'

bold "6. Primer puerto libre entre $RANGE_START y $RANGE_END"
if [ "$PORTS_READ" -eq 0 ]; then
  printf '  [31mOmitido:[0m sin poder listar los puertos, cualquier
'
  printf '  sugerencia sería una adivinanza y podrías pisar otro proyecto.
'
  exit 1
fi

FREE=''
for port in $(seq "$RANGE_START" "$RANGE_END"); do
  if ! echo "$LISTENING" | grep -qx "$port"; then
    # Doble comprobación: intentar abrirlo de verdad descarta puertos que
    # están reservados aunque ahora mismo no aparezcan escuchando.
    if command -v nc >/dev/null 2>&1; then
      nc -z 127.0.0.1 "$port" 2>/dev/null && continue
    fi
    FREE=$port
    break
  fi
done

if [ -n "$FREE" ]; then
  printf '  \033[32m%s\033[0m está libre.\n\n' "$FREE"
  echo '  Para usarlo:'
  echo "    sed -e 's/__DOMAIN__/seo.tudominio.com/g' -e 's/__PORT__/$FREE/g' \\"
  echo "        deploy/nginx/seocrawler.conf | sudo tee /etc/nginx/sites-available/seocrawler"
  echo "    sudo sed -i 's/__PORT__/$FREE/' /etc/systemd/system/seocrawler-web.service"
else
  echo "  No hay ninguno libre en el rango. Prueba con:"
  echo "    RANGE_START=3300 RANGE_END=3399 bash $0"
fi

bold '7. Comprobaciones que conviene hacer a mano'
cat <<'NOTES'
  Nombres que podrían chocar con otro proyecto del servidor:

    ls /etc/nginx/sites-available/ | grep -i seo      # ¿ya hay un "seocrawler"?
    systemctl list-unit-files | grep -i seocrawler    # ¿servicios con ese nombre?
    id seocrawler                                     # ¿existe ya el usuario?
    sudo mysql -e "SHOW DATABASES" | grep -i seo      # ¿ya hay una base "seocrawler"?

  Si alguno existe, cambia el nombre en todos los sitios antes de continuar.
NOTES

echo
