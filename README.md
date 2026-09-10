# SEO Crawler

Plataforma tipo Screaming Frog / Sitebulb: rastrea un sitio, inventaría sus URLs,
analiza SEO técnico e interlinking, visualiza la arquitectura como grafo, exporta
los resultados y genera una auditoría SEO/GEO asistida por IA.

Implementación del MVP descrito en [`mvp-crawler-seo-plan.md`](./mvp-crawler-seo-plan.md).

---

## Requisitos

- Node.js 20+ (probado con 24)
- MySQL 8+ o MariaDB 10.6+ escuchando en `127.0.0.1:3306`

No hace falta Docker ni Redis.

## Puesta en marcha

```bash
npm install
```

Crea la base de datos (usuario `root` sin contraseña, tal y como viene en `.env`):

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS seocrawler CHARACTER SET utf8mb4"
```

Genera el esquema:

```bash
npm run db:push
```

Arranca **dos procesos**: la web y el worker (rastreo + tracking de keywords).

```bash
npm run dev
```

```bash
npm run worker
```

Abre <http://localhost:3000>. La primera vez, `/register` te deja crear la
cuenta de **administrador**; a partir de ahí el registro público queda cerrado y
las altas se hacen desde el panel de administración.

> Sin el worker en marcha los crawls se quedan en estado `QUEUED`: la aplicación
> web sólo encola, nunca rastrea dentro del request. El mismo worker ejecuta el
> tracking diario de keywords cuando no hay crawls pendientes.

## Despliegue en un VPS

Plantillas en `deploy/`. Están pensadas para un servidor que **ya aloja otros
proyectos**: nada de lo que sigue toca la configuración global de nginx, ni el
puerto 3000, ni el usuario root de MySQL.

```
deploy/
├── check-ports.sh                 # qué está ocupado y qué puerto libre usar
├── .env.production.example        # plantilla de .env para producción
├── nginx/seocrawler.conf          # server block, con __DOMAIN__ y __PORT__
└── systemd/
    ├── seocrawler-web.service     # servidor Next
    └── seocrawler-worker.service  # rastreos y tracking
```

### 0. Antes de nada: ver qué hay ocupado

```bash
sudo bash deploy/check-ports.sh
```

Lista los puertos a la escucha con su proceso, los dominios que nginx ya
sirve, los contenedores Docker con puertos publicados, los servicios de
aplicación activos, y propone el primer puerto libre del rango 3200-3299.

Si no puede leer la lista de puertos, **se niega a proponer uno** y sale con
error en lugar de adivinar. Instala `iproute2` y repite.

Los comandos que ejecuta, por si los quieres sueltos:

| Para ver | Comando |
| --- | --- |
| Puertos a la escucha y su proceso | `sudo ss -tulpn` |
| Sólo los números de puerto ocupados | `sudo ss -tulnH \| awk '{print $5}' \| sed 's/.*://' \| sort -nu` |
| Si un puerto concreto está libre | `sudo ss -tulpn \| grep :3210` |
| Qué proceso tiene un puerto | `sudo lsof -i :3210 -P -n` |
| Dominios y proxys que nginx ya sirve | `sudo nginx -T \| grep -E 'server_name\|proxy_pass'` |
| Sitios de nginx habilitados | `ls -l /etc/nginx/sites-enabled/` |
| Contenedores con puertos publicados | `docker ps` |
| Servicios activos | `systemctl list-units --type=service --state=running` |

Y las colisiones de **nombre**, que son las que de verdad rompen otro
proyecto:

```bash
ls /etc/nginx/sites-available/ | grep -i seo
systemctl list-unit-files | grep -i seocrawler
id seocrawler
sudo mysql -e "SHOW DATABASES" | grep -i seo
```

Si alguno existe, renómbralo en todos los ficheros antes de seguir.

### 1. Dependencias del sistema

Node 20 o superior y MariaDB 10.6+ (o MySQL 8). Si el VPS ya tiene una versión
de Node antigua para otro proyecto, **no la sustituyas**: instala la nueva con
`nvm` bajo el usuario `seocrawler` y apunta los `ExecStart` de systemd a esa
ruta en lugar de a `/usr/bin/npm`.

```bash
sudo apt update && sudo apt install -y nginx mariadb-server git curl iproute2
```

### 2. Base de datos propia

Usuario y base dedicados. Nunca root, y nunca reutilizando una base existente.

```bash
sudo mysql -e "CREATE DATABASE seocrawler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'seocrawler'@'127.0.0.1' IDENTIFIED BY 'PON_AQUI_UNA_CLAVE_LARGA'; GRANT ALL PRIVILEGES ON seocrawler.* TO 'seocrawler'@'127.0.0.1'; FLUSH PRIVILEGES;"
```

El `GRANT` es sólo sobre `seocrawler.*`: aunque se filtrara la contraseña, no
alcanzaría a las bases de los otros proyectos.

### 3. Usuario del sistema y código

```bash
sudo useradd --system --create-home --home-dir /var/www/seocrawler --shell /bin/bash seocrawler
sudo -u seocrawler git clone <tu-repo> /var/www/seocrawler
```

```bash
cd /var/www/seocrawler && sudo -u seocrawler cp deploy/.env.production.example .env
```

Rellena `DATABASE_URL`, `AUTH_SECRET` y `NEXTAUTH_URL`, y protege el fichero:

```bash
sudo chmod 600 /var/www/seocrawler/.env
```

```bash
cd /var/www/seocrawler && sudo -u seocrawler npm ci && sudo -u seocrawler npx prisma db push && sudo -u seocrawler npm run build
```

`AUTH_SECRET` se genera con `openssl rand -base64 48`. **Guárdalo aparte**:
además de firmar la sesión, cifra las claves de Serplify, DeepSeek, Google y
SMTP guardadas en la base. Si se pierde, hay que reintroducirlas todas.

### 4. Servicios

```bash
sudo cp deploy/systemd/seocrawler-*.service /etc/systemd/system/
```

```bash
sudo sed -i 's/__PORT__/3210/' /etc/systemd/system/seocrawler-web.service
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now seocrawler-web seocrawler-worker
```

Son dos procesos a propósito: un crawl consume CPU y red durante minutos y, en
el mismo proceso que el servidor, dejaría la interfaz colgada.

El web escucha en `127.0.0.1` porque la unit pasa `-H 127.0.0.1` como
argumento. Tiene que ir así: `next start` lee el puerto de la variable `PORT`
pero **el host no**, y sin el flag escucharía en `0.0.0.0`, quedando accesible
por `IP:puerto` sin pasar por nginx ni por el TLS.

El worker lleva `CPUWeight=50` y `MemoryMax=1G` para que un rastreo grande no
ahogue a los demás proyectos del VPS. Ajústalo a tu máquina.

### 5. nginx

```bash
sed -e 's/__DOMAIN__/seo.tudominio.com/g' -e 's/__PORT__/3210/g' deploy/nginx/seocrawler.conf | sudo tee /etc/nginx/sites-available/seocrawler
```

```bash
sudo ln -s /etc/nginx/sites-available/seocrawler /etc/nginx/sites-enabled/
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` antes de recargar: si el fichero tiene un error, recargar sin
comprobar tumba **todos** los sitios del servidor, no sólo este.

Dos ajustes de la plantilla que no son opcionales para esta app:

- `proxy_read_timeout 310s` — los informes de IA y las mediciones de
  posiciones pueden tardar hasta 300 s. Con los 60 s por defecto de nginx la
  petición se corta a media generación y el usuario ve un 504.
- `client_max_body_size 32m` — el límite por defecto de 1 MB no traga un
  export de keywords grande de Search Console o Semrush.

La plantilla declara un `map` llamado `$connection_upgrade_seocrawler`. El
sufijo evita chocar con el `$connection_upgrade` que probablemente ya tenga
otro proyecto: dos `map` con el mismo nombre impiden arrancar nginx.

### 6. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d seo.tudominio.com
```

Certbot edita **sólo** el server block cuyo `server_name` coincide, añade el
bloque 443 y la redirección, y deja intactos los demás sitios. Por eso la
plantilla trae únicamente el bloque 80: escribir el de 443 a mano antes de
tener certificado impide que nginx arranque.

### 7. Comprobar

```bash
curl -I https://seo.tudominio.com/login
```

```bash
journalctl -u seocrawler-web -n 50 --no-pager
```

```bash
journalctl -u seocrawler-worker -f
```

Crea el primer administrador:

```bash
cd /var/www/seocrawler && sudo -u seocrawler npm run admin
```

Y en **Administración → Google**, añade como URI de redirección autorizada
`https://seo.tudominio.com/api/auth/google/callback`.

### Actualizar

```bash
cd /var/www/seocrawler && sudo -u seocrawler git pull && sudo -u seocrawler npm ci && sudo -u seocrawler npx prisma db push && sudo -u seocrawler npm run build && sudo systemctl restart seocrawler-web seocrawler-worker
```

Reinicia el worker **después** del build: si se queda con el código viejo
mientras la base ya tiene el esquema nuevo, los rastreos fallan.

No lances `npm run build` con el servidor de desarrollo levantado: ambos
escriben en `.next` y se pisan.

### Copia de seguridad

```bash
mysqldump -u seocrawler -p seocrawler | gzip > seocrawler-$(date +%F).sql.gz
```

```bash
cp /var/www/seocrawler/.env ~/seocrawler-env-$(date +%F).bak
```

El `.env` importa tanto como el volcado: sin su `AUTH_SECRET` los secretos
cifrados de la base no se pueden recuperar.

---

## Variables de entorno

Todas viven en `.env` (hay una plantilla en `.env.example`).

Casi todo lo configurable vive ahora en la base de datos y se edita desde la
interfaz. El `.env` sólo hace falta para arrancar y actúa como valor por defecto.

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión MySQL/MariaDB |
| `AUTH_SECRET` | Firma la cookie de sesión **y cifra los secretos guardados**. Si cambia, hay que volver a introducir claves y credenciales |
| `CRAWLER_USER_AGENT` | User agent por defecto del crawler |
| `CRAWLER_MAX_CONCURRENCY` | Tope duro de concurrencia por crawl |
| `CRAWLER_TIMEOUT_MS` | Timeout HTTP (15 s por defecto) |
| `CRAWLER_MAX_REDIRECTS` | Máximo de saltos en una cadena de redirects |
| `CRAWLER_MAX_HTML_BYTES` | Tamaño máximo de respuesta que se descarga |
| `CRAWLER_ALLOW_PRIVATE_HOSTS` | `true` sólo para rastrear `localhost` en pruebas |
| `WORKER_POLL_MS` / `WORKER_ID` | Frecuencia de sondeo e identidad del worker |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Envío de correo (recuperación de contraseña) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth de Google para Search Console |
| `TRACKING_HOUR` | Hora UTC desde la que se lanza el tracking diario |
| `TRACKING_BATCH_SIZE` / `TRACKING_BATCH_DELAY_MS` | Carga del tracking sobre la base |
| `GSC_LAG_DAYS` | Retraso de los datos definitivos de Search Console |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` | Configuración de la IA |

Todo lo externo es opcional y degrada con aviso, nunca rompe:

- sin clave de IA en la cuenta, la app funciona y sólo se deshabilitan la
  auditoría IA y el chat;
- sin SMTP, los enlaces de invitación y recuperación se muestran en pantalla en
  lugar de enviarse;
- sin credenciales de Google, puedes importar keywords por CSV y a mano, pero no
  hay medición diaria de posiciones.

---

## Cuentas, roles y administración

**El registro público está cerrado.** Sólo hay una excepción: mientras no exista
ninguna cuenta, `/register` crea el administrador inicial. Después, las altas se
hacen desde **Administración** (visible en el menú para los roles `ADMIN`).

### Equipo de cada cuenta

Además de las cuentas que crea el administrador, **cada cuenta puede invitar a
más personas a su propio espacio de trabajo** desde Ajustes → Equipo, con dos
permisos:

| Permiso | Puede |
| --- | --- |
| **Editor** | Ver todo, crear proyectos, lanzar y cancelar crawls, importar keywords, generar informes de IA |
| **Sólo lectura** | Ver proyectos, crawls, informes y exportaciones. Nada más |

El propietario conserva un tercer nivel implícito (`OWNER`): sólo él gestiona su
equipo. Los proyectos compartidos aparecen en la barra lateral del invitado
junto a los suyos.

No hay una tabla `Account` aparte: el espacio de trabajo **es** el usuario dueño
de los proyectos, y `AccountMember` dice quién más entra y con qué rol. Así los
proyectos siguen colgando de `Project.userId` y no hubo que rehacer el modelo.

`lib/access.ts` centraliza la decisión: `requireProjectAccess` y
`requireCrawlAccess` reciben el permiso necesario (`read`, `write` o `manage`) y
lanzan `NotFoundAccessError` si la persona no tiene ningún acceso — no se
distingue de "no existe", para no filtrar qué proyectos hay en la instancia — o
`ForbiddenAccessError` si tiene acceso pero le falta permiso.

Invitar a alguien que **ya tiene cuenta** sólo le da acceso: entra con su
contraseña de siempre. Si el email es nuevo, se crea la cuenta sin contraseña y
se le manda el enlace de un solo uso, igual que en las altas del admin. Quitar a
alguien del equipo le retira el acceso pero **no borra su cuenta**.

### Qué se configura dónde

| Ámbito | Dónde | Qué |
| --- | --- | --- |
| Instancia | Panel de admin | Cuentas, SMTP, credenciales OAuth de Google, **clave de Serplify**, interruptor global de informes por correo, URL pública |
| Cuenta (tenant) | Ajustes | Su **propia clave de DeepSeek**, su conexión con Search Console, sus avisos por correo, **su equipo** |

La clave de **Serplify** sí es global: su saldo es prepago y compartido, así que
una clave por cuenta sólo repartiría el mismo monedero. El interruptor
`serplifyEnabled` corta el gasto de toda la instancia sin borrar la clave.

La clave de IA es deliberadamente **de cada cuenta**: el consumo se factura a
quien lo genera y no hay una clave compartida. Las credenciales OAuth de Google
sí son globales porque identifican a la aplicación, no al usuario; cada cuenta
autoriza su propio Google con un botón y luego elige qué propiedad mide cada
proyecto.

### Alta de una cuenta

El admin introduce email, nombre y rol. La cuenta **nace sin contraseña** y se
envía un enlace de un solo uso (72 h) para que la persona elija la suya: nunca
se manda una contraseña en claro por correo. Si no hay SMTP, el enlace se
muestra en pantalla para pasarlo a mano. Desde la tabla se puede reenviar la
invitación, mandar un enlace de recuperación, cambiar el rol, desactivar o
borrar la cuenta.

Desactivar corta el acceso de inmediato: aunque la cookie de sesión siga viva,
cada petición revalida el estado y el rol contra la base de datos.

Hay guardarraíles para no dejar la instancia inutilizable: nadie puede borrarse
ni desactivarse a sí mismo, ni quitar el rol al último administrador activo.

### Secretos

Las claves de API, la contraseña SMTP, el client secret de Google y los refresh
tokens se guardan **cifrados con AES-256-GCM** (clave derivada de
`AUTH_SECRET`). Las APIs nunca devuelven un secreto en claro: sólo indican si
está puesto y muestran sus últimos cuatro caracteres.

### Recuperación por línea de comandos

Si te quedas fuera (sin SMTP, sin admin activo), hay una vía de rescate:

```bash
npm run admin -- list
```

También acepta `promote <email>`, `create <email> [nombre]`, `reset <email>` y
`password <email> <contraseña>`.

---

## Informes por correo

Con SMTP configurado y el interruptor global activo, cada cuenta puede pedir en
sus ajustes:

- **Resumen al terminar un crawl** — lo envía el worker al completar el análisis,
  con URLs, indexables, errores, SEO Health y los issues principales.
- **Auditoría de IA al generarse** — score, resumen y acciones recomendadas.

Los envíos nunca bloquean el trabajo: si el correo falla, se registra en el log y
el crawl sigue marcado como completado. La dirección de destino es la de la
cuenta salvo que se indique otra.

---

## Arquitectura

```
Next.js (UI + API)  ──encola──>  tabla Crawl (estado QUEUED)
                                        │
                                        │  polling
                                        ▼
                          Worker Node.js (proceso aparte)
                                        │
                   robots.txt → sitemaps → BFS de enlaces
                                        │
                                        ▼
                                     MySQL
                                        │
              métricas de enlace → PageRank → reglas SEO → GEO
                                        │
                                        ▼
                              Contexto agregado → DeepSeek
```

### Escrituras sobre la fila del crawl

MariaDB devuelve el error **1020** (`Record has changed since last read`)
cuando dos conexiones actualizan la misma fila a la vez. Pasaba durante los
rastreos: el progreso se guardaba una vez por página y, en paralelo, un latido
cada 10 s marcaba la misma fila para mantener viva la reserva del worker.

Se resuelve en tres capas:

1. **Un solo escritor.** El latido ahora se salta la escritura si la fila se
   tocó hace menos de 10 s. Como el progreso ya refresca `heartbeatAt`, el
   latido sólo actúa en los tramos sin avance (análisis, esperas largas), que
   es justo para lo que existe.
2. **Menos escrituras.** El progreso se persiste como mucho una vez por
   segundo (`CRAWL_PROGRESS_WRITE_MS`) en lugar de una vez por página. Al
   terminar se escriben las cifras exactas, por si el recorte se saltó la
   última.
3. **Reintento.** `retryOnConflict()` reintenta con espera creciente los
   errores 1020, 1213 (interbloqueo) y 1205 (espera de bloqueo agotada).
   Envuelve las escrituras que aún pueden coincidir: señales de pausa o
   cancelación desde la interfaz, el guardado de estadísticas del análisis y
   los cambios de estado finales. Sólo se aplica a operaciones idempotentes;
   nunca a un incremento relativo, que al repetirse contaría de más.

### Sobre la cola

El plan propone Redis + BullMQ. Como el entorno objetivo corre sin Docker y sin
Redis, la cola está respaldada por MySQL (`src/queue/crawl-queue.ts`): el estado
`QUEUED` es el job pendiente y `workerId` + `heartbeatAt` hacen de lock, con
recuperación automática de crawls cuyo worker murió a medias. La interfaz
(`enqueueCrawl` / `claimNextCrawl` / `signalCrawl`) es la misma que expondría
BullMQ, así que migrar es un cambio localizado en ese archivo.

Puedes arrancar varios workers a la vez (con `WORKER_ID` distinto) y se
repartirán los crawls encolados.

### Estructura

```
app/                      Next.js App Router (UI + route handlers)
components/               UI: shell, tablas, grafo, crawl, IA
lib/                      prisma, auth, env, formato, helpers de API
src/crawler/              normalize-url, ssrf, fetch-page, parse-html,
                          robots, sitemap, crawler (BFS)
src/seo/                  indexabilidad, reglas, validación de schema y hreflang
src/analysis/             pipeline post-crawl, simhash, validadores, comparación
src/graph/                PageRank, betweenness/HITS/Louvain, grafo y árbol
src/geo/                  señales y score GEO
src/keywords/             normalización, import CSV, cliente GSC, tracking
src/ai/                   cliente DeepSeek, context builder, prompts, tools
src/exports/              CSV en streaming
src/queue/                cola de crawls sobre MySQL
src/workers/              proceso worker (crawling + tracking)
prisma/schema.prisma      modelo de datos
```

---

## Qué hace el crawler

1. Normaliza la URL inicial y descarga `robots.txt`.
2. Descubre URLs por sitemap (`robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`,
   incluidos los índices anidados).
3. Recorre el sitio en BFS respetando profundidad, límites, patrones
   include/exclude, `nofollow` y el `crawl-delay` de robots.
4. Deduplica por `SHA-256(normalizedUrl)` con índice único `(crawlId, urlHash)`.
5. Extrae de forma determinística: status, headers, tiempos, title, description,
   headings, canonical, robots, hreflang, JSON-LD, imágenes, word count, idioma,
   enlaces internos y externos con su anchor text.
6. Al terminar calcula inlinks/outlinks, PageRank interno, betweenness,
   hub/authority (HITS), comunidades (Louvain), huérfanas potenciales,
   duplicados exactos y casi duplicados, issues y el score SEO/GEO.

### Pausar, reanudar y re-rastrear

La frontera BFS se persiste en la tabla `FrontierUrl`, así que **pausar y
reanudar continúa donde iba** en lugar de empezar de cero. Cada página se guarda
de forma idempotente (se borran sus filas hijas antes de reinsertarlas), de modo
que reprocesar una URL nunca duplica enlaces ni infla los inlinks.

- **Reanudar** (crawl pausado) conserva la frontera y sigue.
- **Re-rastrear** (crawl terminado) borra los datos anteriores y empieza limpio.

### Seguridad

`src/crawler/ssrf.ts` bloquea `localhost`, loopback, rangos privados, CGNAT,
link-local (incluido `169.254.169.254`) y cualquier protocolo que no sea
http(s). La validación resuelve DNS y **se repite en cada salto de redirect**,
lo que mitiga el DNS rebinding. Además hay límites de tamaño de respuesta,
timeout, número de redirects, URLs y concurrencia.

Para rastrear un sitio local en pruebas, arranca el worker con
`CRAWLER_ALLOW_PRIVATE_HOSTS=true`.

---

## Reglas SEO implementadas

| Severidad | Reglas |
| --- | --- |
| CRITICAL | `HTTP_5XX`, `REDIRECT_LOOP` |
| HIGH | `HTTP_4XX`, `FETCH_ERROR`, `NOINDEX`, `BLOCKED_ROBOTS`, `POTENTIAL_ORPHAN`, `BROKEN_INTERNAL_LINK` |
| MEDIUM | `MISSING_TITLE`, `DUPLICATE_TITLE`, `MISSING_DESCRIPTION`, `DUPLICATE_DESCRIPTION`, `DUPLICATE_CONTENT`, `MISSING_H1`, `MULTIPLE_H1`, `DEEP_PAGE`, `REDIRECT`, `CANONICALIZED`, `LOW_INLINKS` |
| LOW | `TITLE_TOO_LONG`, `TITLE_TOO_SHORT`, `DESCRIPTION_TOO_LONG`, `DESCRIPTION_TOO_SHORT`, `THIN_CONTENT`, `IMAGES_MISSING_ALT`, `MISSING_CANONICAL`, `SCHEMA_MISSING_RECOMMENDED` |

Además de las reglas por página:

| Regla | Qué detecta |
| --- | --- |
| `NEAR_DUPLICATE_CONTENT` | Contenido casi idéntico vía SimHash (fichas clonadas, plantillas) |
| `SCHEMA_INVALID_JSON` | Bloques `application/ld+json` que no parsean |
| `SCHEMA_MISSING_REQUIRED` | JSON-LD sin las propiedades que Google exige por tipo |
| `HREFLANG_INVALID_CODE` | Códigos mal formados (`es_ES` en vez de `es-ES`) |
| `HREFLANG_MISSING_SELF` | Conjunto hreflang sin auto-referencia |
| `HREFLANG_BROKEN_TARGET` | Alternativa que no responde 200 |
| `HREFLANG_NOT_RECIPROCAL` | La URL destino no devuelve la referencia |

Cada regla vive en `src/seo/rules/` y se registra en `src/seo/rules/index.ts`;
añadir una nueva es crear el objeto `SeoRule` y meterlo en el array.

---

## Arquitectura del sitio: árbol y grafo

El grafo de fuerzas mostraba todo conectado con todo, porque el menú y el footer
generan enlaces desde cualquier página. Por eso la vista por defecto es un
**árbol**, donde cada URL cuelga de un único padre. Hay cuatro jerarquías, y
cada una responde a una pregunta distinta:

| Jerarquía | Responde a |
| --- | --- |
| **Estructura de URL** | ¿Cómo está organizado el sitio por carpetas? |
| **Camino de rastreo** | ¿Cómo llega Google a cada URL, en cuántos clics? |
| **Quién enlaza aquí (inverso)** | ¿Qué páginas alimentan a esta URL concreta? |
| **Clusters de enlazado** | ¿Cuántos clusters hay, de qué tamaño y cómo de aislados? |

**Camino de rastreo** hace un BFS por los enlaces internos desde la home; el
padre de cada URL es la página desde la que se llega antes. Las que no tienen
ruta desde la home se agrupan aparte, que es justo donde aparecen las huérfanas.

**Quién enlaza aquí** es el reflejo del anterior: se elige una página foco (o se
toma la de mayor PageRank) y el árbol crece hacia atrás por los enlaces
entrantes, hasta 4 saltos. Cada nodo muestra el anchor text con el que enlaza y
cuántos saltos lo separan del foco. Es la vista para decidir dónde meter enlaces
internos hacia una página de dinero.

**Clusters de enlazado** agrupa por comunidad de Louvain, no por carpeta: cada
cluster indica cuántas URLs tiene, su profundidad media, su página principal y
cuántos enlaces recibe desde otros clusters. Un cluster grande con pocos enlaces
entrantes es un silo aislado.

> Ojo con la lectura de clusters: si el sitio tiene un menú o un footer que
> enlaza todo con todo, Louvain encuentra poca estructura y la modularidad sale
> baja (la verás en el Overview). Eso no es un fallo de la herramienta, es el
> diagnóstico: el enlazado no está diferenciando temáticas.

Sobre el árbol: plegado y desplegado por rama, niveles rápidos (1/2/3), zoom y
paneo, coloreado por status, profundidad, indexabilidad, issues o cluster,
tamaño de nodo por PageRank, y exportación a SVG, PNG y PDF. El grafo de fuerzas
sigue disponible en la otra pestaña para medir densidad.

---

## Keywords y tracking de posiciones

Ruta: `/projects/:projectId/keywords`.

**De dónde salen los datos.** Hay dos fuentes, y miden cosas distintas:

- **Search Console** (gratis) — qué consultas *ya* traen impresiones y clics, y
  la posición **media** del periodo. Sólo ve keywords donde el sitio aparece.
- **Serplify** (de pago, opcional) — el SERP de hoy: puesto **exacto**, quién
  está por encima y qué bloques ocupan la página. Ve también las keywords donde
  el sitio todavía no aparece. Ver *[Posiciones reales con Serplify](#posiciones-reales-con-serplify)*.

No se scrapea Google directamente en ningún caso: está prohibido por sus
términos y se bloquea. Serplify es un proveedor de SERP API.

Para dar de alta keywords hay tres entradas:

- **Descubrir** — trae de Search Console las consultas reales de los últimos N
  días y da de alta las que superen un mínimo de impresiones.
- **Importar CSV** — detecta las columnas por nombre, así que sirve un export
  directo de Search Console, de Ahrefs o de Semrush, o una lista pelada de
  keywords. Reconoce posición, clics, impresiones, CTR, URL, país, dispositivo
  y fecha, en inglés y en español.
- **A mano** — pegando una lista.

**Cómo se mide sin saturar el servidor:**

1. **Un job por proyecto y día**, no uno por keyword: Search Console devuelve
   hasta 25.000 filas por llamada, así que un proyecto entero se resuelve
   normalmente con una petición.
2. **Escalonado por proyecto**: la hora sale del hash del `projectId`, repartida
   en una ventana de 4 horas desde `TRACKING_HOUR`, para que muchos proyectos no
   se disparen a la vez.
3. **Escrituras por lotes** (`TRACKING_BATCH_SIZE`) con pausa entre lotes
   (`TRACKING_BATCH_DELAY_MS`).
4. **Prioridad al crawling**: el tracking sólo entra cuando el worker no tiene
   crawls pendientes.
5. **Reanudable e idempotente**: `upsert` por (keyword, día) y recuperación de
   jobs cuyo worker murió; el índice único (proyecto, día) impide repetir un día.

Se guarda una fila por keyword y día, incluidos los días sin datos (que no es lo
mismo que posición 0), y de ahí salen el histórico, la evolución y el reparto
por tramos de posición.

### Posiciones reales con Serplify

Complemento opcional de Search Console. El administrador pega una vez la clave
en **Administración → Serplify** y todas las cuentas la usan.

**Qué se usa y qué no.** Sólo la **SERP API**. La *Traffic API* de Serplify
(visitas y clics sintéticos hacia tu resultado) queda deliberadamente fuera:
es tráfico artificial para mover señales de CTR, es decir, manipulación de
resultados de búsqueda. Está excluida en el propio cliente, no sólo en la
interfaz.

**Qué devuelve cada medición** (`$0,005` por keyword):

- Tu puesto exacto de hoy (`rank_group` orgánico y `rank_absolute` contando
  anuncios y bloques).
- Los 10 primeros resultados con dominio, título y URL: quién te adelanta.
- Los bloques presentes en la página — *featured snippet*, *People Also Ask*,
  *local pack*, *AI overview*, anuncios — que es lo que determina cuánto
  espacio real le queda al orgánico y alimenta el análisis GEO.
- Total de resultados, dispositivo, mercado e idioma de la consulta.

**Ajustes por proyecto** (en la pestaña Keywords):

| Ajuste | Para qué |
| --- | --- |
| País | Elige el listado de ubicaciones; Serplify las sirve por país |
| Mercado | La ubicación concreta. La primera opción es el país entero, que es lo normal salvo negocio local |
| Idioma | Idioma de la interfaz de Google en la consulta |
| Dispositivo | Escritorio o móvil: los SERP difieren |
| Dominio a seguir | Por defecto el del proyecto; se puede afinar a un subdominio |
| Medición diaria | Si se apaga, sólo se mide con **Medir ahora** |

**Control del gasto.** El panel muestra siempre el coste de una pasada
completa, la proyección mensual y lo gastado de verdad en los últimos 30 días.
Medir 100 keywords a diario son unos **$15/mes**; 500 keywords, unos **$75/mes**.
Otras salvaguardas:

- **Medir ahora** pide confirmación mostrando el coste antes de gastar.
- Las mediciones son **idempotentes por keyword y día**: repetir no duplica
  filas ni vuelve a cobrar el mismo día.
- Si el saldo se agota, la pasada **se detiene en la primera keyword** en lugar
  de reintentar 500 veces, y la interfaz lo dice.
- Las consultas van **de una en una** con pausa (`SERP_DELAY_MS`), y toda
  llamada tiene *timeout* (`SERPLIFY_SEARCH_TIMEOUT_MS`) para que el tracking
  nocturno no se quede colgado.
- Probar la conexión usa `/v1/languages`, que es **gratis**.
- Consultar el histórico ya guardado no cuesta nada.

### Conectar Search Console

1. En Google Cloud, crea un proyecto y habilita la **Search Console API**.
2. Crea credenciales OAuth de tipo *Aplicación web*.
3. Añade como URI de redirección autorizada:
   `http://localhost:3000/api/auth/google/callback`
4. El administrador pega Client ID y secret en **Administración → Google**.
5. Cada cuenta pulsa **Conectar con Google** en sus Ajustes y elige qué
   propiedad mide cada proyecto.

---

## Silos: ¿el enlazado respeta la arquitectura?

Ruta: `/projects/:projectId/crawls/:crawlId/silos`.

**Silo no es lo mismo que cluster.** Los clusters de la vista de grafo son
comunidades que Louvain *descubre* a partir del enlazado real; pueden salir
mezclados y con nombres que no significan nada para quien diseñó el sitio. Un
silo es la sección que *tú decidiste* que existiera. Aquí no se descubre nada:
se comprueba si el enlazado interno sostiene esa arquitectura o la deshace.

**Dos formas de agrupar:**

| Criterio | Cuándo usarlo |
| --- | --- |
| Carpeta de la URL | El sitio tiene jerarquía real (`/servicios/seo/`). Se puede mirar a uno o dos niveles |
| Tema del slug | El sitio es plano y todo cuelga de la raíz (`/diseno-de-paginas-web/`). Agrupa por la primera palabra con contenido del slug |

Si por carpeta más del 70 % de las URLs cae en la raíz, el informe lo avisa y
ofrece cambiar a slug con un clic: por carpeta no habría nada que separar.

**Qué se mide en cada sección:**

- **Cabecera** — si existe la portada de la sección (`/servicios/`) y cuántos
  enlaces recibe. En un silo debería ser la más enlazada de su grupo.
- **Se queda dentro** (cohesión) — qué parte del enlazado que sale de la
  sección va a otra página de la misma sección. Es la medida de si el silo se
  sostiene o reparte fuerza a todo el sitio.
- **Entran / salen** — enlaces desde y hacia otras secciones.
- **Huérfanas** — páginas sin un solo enlace interno entrante.
- **Fuerza** — qué parte del PageRank interno acumula la sección.

**El mapa** es una matriz sección × sección: fila de origen, columna de
destino. La diagonal azul es el enlazado que se queda en casa. Si sólo se ve la
diagonal, el sitio está bien silado; si la cuadrícula está llena de naranja,
todo enlaza con todo y ninguna sección acumula autoridad temática.

Pulsando una sección se abre su lista de páginas ordenada por enlaces
entrantes, que es la forma rápida de responder a "¿cuántos enlaces internos
recibe esta página de servicios?".

**El diagnóstico** traduce lo anterior a hallazgos concretos: secciones sin
cabecera, cabeceras que reciben menos enlaces que sus propias hijas, silos que
pierden más de la mitad del enlazado, secciones a las que nadie enlaza, fugas
desproporcionadas entre dos secciones y páginas huérfanas. Ninguna regla se
dispara por debajo de un mínimo de páginas: en secciones de una o dos URLs los
porcentajes no significan nada.

Sólo se analizan documentos HTML. Las imágenes de `/wp-content/uploads/` y las
rutas de infraestructura (`/cdn-cgi`, `/wp-json`, `/feed`) se descartan: si no,
una carpeta de fotos aparece como la sección más grande del sitio.

La misma agrupación está disponible como **modo de árbol** en Site Graph
(*Jerarquía → Silos*), donde cada rama es una sección con su color y su
porcentaje de enlazado interno.

---

## Comparar crawls

Ruta: `/projects/:projectId/compare`. Enfrenta dos crawls del mismo proyecto y
muestra la evolución de cada métrica, las URLs nuevas y desaparecidas, los
cambios de status y de indexabilidad, y el delta de cada tipo de issue.

---

## API

```http
GET    /api/auth/register                           (¿sigue abierto el alta inicial?)
POST   /api/auth/register | login | logout | forgot-password
GET    /api/auth/reset-password                     ?token  (invitación o reset)
POST   /api/auth/reset-password

GET    /api/admin/users
POST   /api/admin/users                             { email, name, role }
PATCH  /api/admin/users/:userId                     { role | isActive | action }
DELETE /api/admin/users/:userId
GET    /api/admin/settings
PATCH  /api/admin/settings
POST   /api/admin/settings                          { action: test-smtp|send-test-email }

GET    /api/account/settings
PATCH  /api/account/settings
POST   /api/account/settings                        { action: test-ai|disconnect-gsc }
GET    /api/account/team
POST   /api/account/team                            { email, name, role: EDITOR|VIEWER }
PATCH  /api/account/team/:memberId                  { role } | { action: resend-invite }
DELETE /api/account/team/:memberId

GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id

GET    /api/projects/:projectId/crawls
POST   /api/projects/:projectId/crawls

GET    /api/crawls/:crawlId
DELETE /api/crawls/:crawlId
POST   /api/crawls/:crawlId/control     { action: start|pause|resume|cancel }
POST   /api/crawls/:crawlId/start
POST   /api/crawls/:crawlId/cancel

GET    /api/crawls/:crawlId/pages       ?page&perPage&sort&dir&status&indexable&search&…
GET    /api/crawls/:crawlId/issues      ?code
GET    /api/crawls/:crawlId/graph       ?limit&status&indexable&maxDepth&minInlinks&…
GET    /api/crawls/:crawlId/tree        ?mode=path|link|inlinks|cluster&focus&limit&status&indexable&search
GET    /api/pages/:pageId

GET    /api/crawls/:crawlId/export/pages.csv
GET    /api/crawls/:crawlId/export/internal-links.csv
GET    /api/crawls/:crawlId/export/external-links.csv
GET    /api/crawls/:crawlId/export/issues.csv
POST   /api/crawls/:crawlId/export/graph.pdf

GET    /api/projects/:projectId/keywords            ?search&bucket&tracked&source&sort
POST   /api/projects/:projectId/keywords
GET    /api/projects/:projectId/keywords/import
POST   /api/projects/:projectId/keywords/import     (multipart o texto plano)
GET    /api/projects/:projectId/keywords/:keywordId ?days
PATCH  /api/projects/:projectId/keywords/:keywordId
DELETE /api/projects/:projectId/keywords/:keywordId

GET    /api/projects/:projectId/tracking
POST   /api/projects/:projectId/tracking            { action: run-now|discover }

GET    /api/projects/:projectId/gsc
PATCH  /api/projects/:projectId/gsc                 { siteUrl }
DELETE /api/projects/:projectId/gsc
GET    /api/auth/google/callback

GET    /api/crawls/:crawlId/ai/report
POST   /api/crawls/:crawlId/ai/report
GET    /api/crawls/:crawlId/ai/chat                 ?conversationId
POST   /api/crawls/:crawlId/ai/chat

GET    /api/projects/:projectId/ai/reports          ?type=audit
GET    /api/projects/:projectId/ai/reports/:reportId
DELETE /api/projects/:projectId/ai/reports/:reportId
GET    /api/projects/:projectId/ai/compare
POST   /api/projects/:projectId/ai/compare          { baseReportId, targetReportId }
POST   /api/projects/:projectId/ai/reports/:reportId/email
GET    /api/projects/:projectId/ai/reports/:reportId/download  ?format=pdf|docx|md
```

---

## IA

### Informes guardados y comparación

Cada auditoría se guarda entera en `AiReport` (contexto de entrada, salida
validada y modelo usado), así que el histórico se puede abrir cuando se quiera
desde el selector de la pestaña AI Audit. Los intentos fallidos también quedan
registrados, con su error, pero no aparecen como informes abribles.

Desde ahí se pueden **comparar dos auditorías con el mismo modelo**. A la IA no
se le manda el crawl entero: recibe los dos informes ya estructurados **más el
diff determinístico de los dos rastreos**, y devuelve qué se resolvió, qué sigue
igual, qué empeoró y en qué estado quedó cada recomendación anterior
(`APLICADA` / `PARCIAL` / `PENDIENTE` / `INDETERMINADA`).

Ese diff es el guardarraíl importante: si un informe dice que un problema se
arregló pero los datos de rastreo no lo confirman, la comparación lo señala en
lugar de dar por buena la mejora. Comparar dos informes del mismo crawl también
funciona, pero avisa de que los datos técnicos son idénticos y de que sólo se
está contrastando el criterio de cada informe.

### Descargar los informes

Cualquier informe guardado (auditoría o comparativa) se descarga en tres
formatos desde el propio informe:

| Formato | Para qué |
| --- | --- |
| **PDF** | Enviar a cliente o archivar. A4, con tablas y numeración de página. |
| **Word** (.docx) | Editarlo antes de entregarlo. |
| **Markdown** (.md) | Pegarlo en Notion, Docs, un issue o el control de versiones. |

Los tres salen del mismo modelo de documento
(`src/exports/report-document.ts`), así que el contenido es idéntico y sólo
cambia la maquetación: añadir un formato nuevo es escribir un renderizador más.

El PDF usa fuentes estándar, que codifican en WinAnsi: el texto se sanea antes
de dibujarlo (flechas, viñetas y comillas tipográficas se sustituyen) para que
un carácter fuera de rango no rompa la generación a mitad del informe.

Si la respuesta del modelo se corta por longitud, el informe **no se pierde**:
el JSON truncado se repara cortando por el último elemento completo, los
elementos a medias se descartan en la validación y, si aun así falla, se
reintenta una vez pidiendo una respuesta más compacta.

La IA nunca recibe HTML. `src/ai/context-builder.ts` genera un resumen
estructurado (totales, distribuciones, top issues con muestras de URLs, top
PageRank, páginas mal enlazadas, duplicados, huérfanas, cobertura de schema y
señales GEO) y sólo eso se envía a DeepSeek. La respuesta se valida con Zod
antes de guardarse.

El chat usa *tool calling* con herramientas acotadas al crawl
(`getCrawlSummary`, `getPagesByIssue`, `getTopPagesByPageRank`,
`getLowInlinkPages`, `getDeepPages`, `getBrokenLinks`, `getRedirects`,
`getPageDetails`, `getLinksToPage`, `getLinksFromPage`,
`getDirectoryBreakdown`). No hay acceso SQL libre.

---

## Fuera de alcance por ahora

Renderizado JavaScript con Playwright, PageSpeed / Core Web Vitals, integración
con GA4, clustering semántico por embeddings, crawls programados y equipos
multiusuario. La arquitectura deja sitio para todo ello.
