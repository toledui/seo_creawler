# MVP — Plataforma de Crawler SEO + Interlinking + Auditoría con IA

## 1. Objetivo

Construir un MVP de una plataforma web tipo **Screaming Frog / Sitebulb**, enfocada en:

- rastrear sitios web;
- inventariar URLs;
- analizar SEO técnico;
- analizar interlinking;
- visualizar la arquitectura interna como grafo;
- exportar resultados;
- generar una auditoría SEO/GEO asistida por IA;
- permitir consultas sobre los datos del crawl.

El MVP debe ser suficientemente sólido para auditar sitios pequeños y medianos, con una meta inicial de **10,000–50,000 URLs por proyecto**, dejando preparada la arquitectura para escalar posteriormente.

---

# 2. Stack tecnológico

## Aplicación web

- **Next.js**
- **TypeScript**
- App Router
- Server Actions / Route Handlers cuando aplique

## Backend

El backend puede vivir inicialmente dentro del mismo proyecto Next.js para simplificar el MVP.

Para crawling pesado se utilizarán procesos worker independientes en Node.js.

### Runtime

- **Node.js**
- TypeScript

## Base de datos

- **MySQL 8+**
- **Prisma ORM**

## Queue / Jobs

Recomendado:

- Redis
- BullMQ

BullMQ permitirá gestionar:

- crawls;
- reintentos;
- concurrencia;
- prioridades;
- estados;
- workers distribuidos en el futuro.

## Crawling

- `undici` o `fetch` nativo de Node.js
- `cheerio`
- `robots-parser`
- `fast-xml-parser`

Para JavaScript rendering, en una segunda etapa del MVP:

- Playwright

## Visualización del grafo

Recomendado:

- Sigma.js
- Graphology

Alternativas:

- Cytoscape.js
- React Flow para vistas pequeñas

Para grafos grandes se recomienda WebGL, por lo que **Sigma.js + Graphology** es una buena combinación.

## Exportaciones

- CSV
- JSON
- SVG
- PNG
- PDF

Librerías posibles:

- `csv-stringify`
- `sharp`
- `pdf-lib`
- renderizado SVG desde el frontend
- captura del canvas/grafo cuando aplique

## IA

Proveedor inicial:

- DeepSeek API

Modelo configurable desde variables de entorno.

La IA no analizará directamente todas las páginas HTML.

El sistema generará primero datos estructurados y estadísticas del crawl y posteriormente enviará resúmenes a la IA.

---

# 3. Arquitectura general

```text
                    ┌──────────────────────┐
                    │       Next.js        │
                    │  Frontend + API Web  │
                    └──────────┬───────────┘
                               │
                        Prisma / API
                               │
                    ┌──────────▼───────────┐
                    │        MySQL         │
                    └──────────┬───────────┘
                               │
                       Crawl Job Queue
                               │
                    ┌──────────▼───────────┐
                    │        Redis         │
                    │       BullMQ         │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Node.js Workers    │
                    │      Crawler         │
                    └───────┬─────┬───────┘
                            │     │
                       HTTP Crawl │
                                  │
                              Playwright
                            opcional / JS

                    ┌──────────────────────┐
                    │   Analysis Engine    │
                    │ SEO + Graph + GEO    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │      AI Analyst      │
                    │       DeepSeek       │
                    └──────────────────────┘
```

---

# 4. Principios de arquitectura

## 4.1 Separar crawling y aplicación web

El servidor Next.js no debe ejecutar crawls largos directamente.

Debe:

1. crear el proyecto;
2. crear el crawl;
3. insertar un job en Redis;
4. responder inmediatamente;
5. los workers ejecutan el rastreo;
6. la UI consulta el progreso.

---

## 4.2 El crawler debe ser determinístico

La extracción SEO no debe depender de IA.

El crawler debe obtener directamente:

- status HTTP;
- title;
- meta description;
- headings;
- canonical;
- robots;
- links;
- images;
- hreflang;
- structured data;
- word count;
- response time;
- etc.

---

## 4.3 La IA interpreta, no descubre datos básicos

Flujo recomendado:

```text
Crawler
   ↓
Datos SEO
   ↓
Reglas
   ↓
Issues
   ↓
Métricas
   ↓
Clusters
   ↓
Resumen estructurado
   ↓
LLM
   ↓
Informe
```

---

# 5. Alcance funcional del MVP

## 5.1 Autenticación

Inicialmente:

- registro;
- login;
- logout;
- recuperación de contraseña.

Opciones:

- Auth.js
- Clerk
- Supabase Auth

Para mantener control propio:

**Auth.js + Prisma**.

---

# 6. Proyectos

El usuario podrá crear proyectos.

Cada proyecto tendrá:

- nombre;
- dominio;
- configuración;
- crawls históricos.

Ejemplo:

```text
Proyecto: Tienda ACME
Dominio: https://acme.com
```

---

# 7. Configuración del crawler

Campos mínimos:

```text
Start URL
Max URLs
Max Depth
Concurrency
Delay
Follow Subdomains
Respect robots.txt
User Agent
Include patterns
Exclude patterns
Follow nofollow
```

Valores iniciales recomendados:

```text
maxUrls: 10,000
maxDepth: 10
concurrency: 10
delay: 100ms
followSubdomains: false
respectRobots: true
```

---

# 8. Estados de un crawl

```text
PENDING
QUEUED
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED
```

La UI mostrará:

```text
URLs encontradas
URLs procesadas
URLs pendientes
Errores
Velocidad URLs/min
Tiempo transcurrido
```

---

# 9. Estrategia del crawler

## Paso 1

Normalizar URL inicial.

Ejemplo:

```text
https://example.com
```

---

## Paso 2

Descargar `robots.txt`.

---

## Paso 3

Buscar sitemap.

Fuentes:

```text
robots.txt
/sitemap.xml
/sitemap_index.xml
```

---

## Paso 4

Agregar URL inicial a la cola.

---

## Paso 5

Procesar URL.

Por cada página:

1. hacer request;
2. registrar status;
3. registrar headers;
4. medir duración;
5. detectar content type;
6. si es HTML, parsear;
7. extraer metadatos;
8. extraer enlaces;
9. normalizar URLs;
10. guardar datos;
11. agregar URLs nuevas a la cola.

---

# 10. Normalización de URLs

Crear una función central:

```ts
normalizeUrl(url: string, baseUrl?: string): string
```

Debe manejar:

- URLs relativas;
- trailing slash;
- hash fragments;
- parámetros;
- encoding;
- protocolo;
- hostname;
- mayúsculas/minúsculas cuando corresponda.

Eliminar siempre:

```text
#section
```

Ejemplo:

```text
https://example.com/page#faq

↓

https://example.com/page
```

---

# 11. URL deduplication

Nunca usar solamente la URL textual.

Crear:

```text
normalizedUrl
urlHash
```

Por ejemplo:

```text
SHA256(normalizedUrl)
```

Índice único:

```text
crawlId + urlHash
```

Esto evita duplicados.

---

# 12. Datos a extraer por página

## HTTP

```text
url
finalUrl
statusCode
contentType
responseTime
contentLength
redirectUrl
```

## SEO básico

```text
title
titleLength

metaDescription
metaDescriptionLength

h1
h1Count

canonical
metaRobots

wordCount
language

indexable
```

## Crawl

```text
depth
discoveredFrom
discoveryType
```

## Links

```text
internal links
external links
nofollow links
```

## Images

```text
src
alt
width
height
```

---

# 13. Structured Data

Extraer inicialmente JSON-LD.

Guardar:

```text
schemaType
rawJSON
validJSON
```

Tipos importantes:

```text
Organization
LocalBusiness
Product
Article
BlogPosting
BreadcrumbList
WebSite
WebPage
FAQPage
Person
Review
VideoObject
```

---

# 14. Hreflang

Registrar:

```text
href
language
```

Detectar:

```text
hreflang inválido
self-reference ausente
target roto
```

Puede ser Fase 2 si el MVP inicial necesita reducir scope.

---

# 15. Modelo de datos Prisma

Propuesta inicial.

```prisma
model User {
  id        String    @id @default(cuid())
  email     String    @unique
  name      String?
  projects  Project[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model Project {
  id        String   @id @default(cuid())
  name      String
  domain    String
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  crawls    Crawl[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Crawl {
  id               String      @id @default(cuid())
  projectId        String
  project          Project     @relation(fields: [projectId], references: [id])
  status           CrawlStatus @default(PENDING)
  startUrl         String
  maxUrls          Int         @default(10000)
  maxDepth         Int         @default(10)
  concurrency      Int         @default(10)
  respectRobots    Boolean     @default(true)
  followSubdomains Boolean     @default(false)

  discoveredUrls   Int         @default(0)
  crawledUrls      Int         @default(0)
  failedUrls       Int         @default(0)

  startedAt        DateTime?
  completedAt      DateTime?

  pages            Page[]
  links            Link[]
  issues           Issue[]
  reports          AiReport[]

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

enum CrawlStatus {
  PENDING
  QUEUED
  RUNNING
  PAUSED
  COMPLETED
  FAILED
  CANCELLED
}

model Page {
  id                    BigInt   @id @default(autoincrement())
  crawlId               String
  crawl                 Crawl    @relation(fields: [crawlId], references: [id])

  url                    String   @db.Text
  normalizedUrl          String   @db.Text
  urlHash                String

  finalUrl               String?  @db.Text

  statusCode             Int?
  contentType            String?
  responseTime           Int?
  contentLength          Int?

  title                  String?  @db.Text
  titleLength            Int?

  metaDescription        String?  @db.Text
  metaDescriptionLength  Int?

  h1                     String?  @db.Text
  h1Count                Int      @default(0)

  canonical              String?  @db.Text
  metaRobots             String?  @db.Text

  wordCount              Int      @default(0)

  depth                  Int      @default(0)

  indexable              Boolean  @default(true)

  internalInlinks        Int      @default(0)
  internalOutlinks       Int      @default(0)
  externalOutlinks       Int      @default(0)

  internalPageRank       Float?

  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  sourceLinks            Link[]   @relation("SourcePage")
  targetLinks            Link[]   @relation("TargetPage")

  @@unique([crawlId, urlHash])
  @@index([crawlId])
  @@index([crawlId, statusCode])
  @@index([crawlId, indexable])
}

model Link {
  id           BigInt @id @default(autoincrement())

  crawlId      String
  crawl        Crawl  @relation(fields: [crawlId], references: [id])

  sourcePageId BigInt
  sourcePage   Page   @relation(
    "SourcePage",
    fields: [sourcePageId],
    references: [id]
  )

  targetPageId BigInt?
  targetPage   Page?  @relation(
    "TargetPage",
    fields: [targetPageId],
    references: [id]
  )

  targetUrl    String @db.Text
  targetHash   String

  anchorText   String? @db.Text
  rel          String?
  linkType     LinkType
  follow       Boolean @default(true)

  createdAt    DateTime @default(now())

  @@index([crawlId])
  @@index([sourcePageId])
  @@index([targetPageId])
  @@index([targetHash])
}

enum LinkType {
  INTERNAL
  EXTERNAL
}

model Issue {
  id        BigInt @id @default(autoincrement())

  crawlId   String
  crawl     Crawl @relation(fields: [crawlId], references: [id])

  pageId    BigInt?

  code      String
  severity  IssueSeverity

  title     String
  details   String? @db.Text

  createdAt DateTime @default(now())

  @@index([crawlId])
  @@index([crawlId, code])
  @@index([crawlId, severity])
}

enum IssueSeverity {
  INFO
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

model AiReport {
  id        String @id @default(cuid())

  crawlId   String
  crawl     Crawl @relation(fields: [crawlId], references: [id])

  model     String
  type      String

  input     Json?
  output    Json?

  createdAt DateTime @default(now())
}
```

---

# 16. Tablas adicionales futuras

No es necesario construirlas todas desde el día uno.

```text
Heading
Image
SchemaMarkup
Hreflang
Sitemap
PageSpeed
ContentHash
CrawlEvent
AiConversation
AiMessage
Export
```

---

# 17. Motor de reglas SEO

Crear un sistema desacoplado.

Estructura sugerida:

```text
src/
  seo/
    rules/
      missing-title.ts
      duplicate-title.ts
      missing-description.ts
      missing-h1.ts
      multiple-h1.ts
      broken-page.ts
      redirect.ts
      canonical-error.ts
      noindex.ts
      deep-page.ts
```

Interfaz:

```ts
interface SeoRule {
  code: string
  severity: IssueSeverity

  run(page: PageContext): SeoIssue[]
}
```

---

# 18. Reglas del MVP

## Critical / High

```text
4xx internal
5xx
canonical roto
redirect loops
noindex inesperado
```

## Medium

```text
missing title
duplicate title
missing description
duplicate description
missing H1
multiple H1
depth > 4
```

## Low

```text
title demasiado largo
description demasiado larga
thin content
images sin alt
```

---

# 19. Indexabilidad

Crear una función central:

```ts
evaluateIndexability(page)
```

Debe considerar:

```text
status code
meta robots
X-Robots-Tag
canonical
robots.txt
```

Resultado:

```ts
{
  indexable: false,
  reason: "NOINDEX"
}
```

Posibles razones:

```text
INDEXABLE
NOINDEX
BLOCKED_ROBOTS
REDIRECT
CLIENT_ERROR
SERVER_ERROR
CANONICALIZED
UNSUPPORTED_CONTENT
```

---

# 20. Análisis del grafo

El sitio debe representarse como:

```text
Page = Node
Link = Edge
```

---

# 21. Métricas de interlinking

Calcular:

```text
Inlinks
Outlinks
Unique Inlinks
Unique Outlinks
Depth
Internal PageRank
```

Posteriormente:

```text
Betweenness
Hub score
Authority score
Cluster
```

---

# 22. Internal PageRank

Implementar PageRank sobre links internos indexables.

Algoritmo inicial:

```text
PR(A) = (1-d)/N + d * Σ(PR(T)/C(T))
```

Con:

```text
d = 0.85
```

Iteraciones:

```text
20–50
```

Guardar resultado:

```text
Page.internalPageRank
```

---

# 23. Detección de páginas huérfanas

Dentro de un crawl puro, una verdadera orphan page no puede descubrirse si nadie la enlaza.

Para MVP:

comparar URLs encontradas vía:

```text
sitemap
crawl
```

Si aparece en sitemap pero no recibe ningún inlink interno:

```text
potentialOrphan = true
```

En futuras integraciones se puede comparar contra:

- Search Console;
- GA4;
- backlinks;
- URL imports.

---

# 24. Clustering

No es obligatorio para el primer release.

Primera implementación simple:

agrupar por directorio.

Ejemplo:

```text
/blog/*
/products/*
/services/*
```

Posteriormente:

- clustering semántico;
- embeddings;
- Louvain community detection.

---

# 25. Site Graph

Ruta:

```text
/projects/:projectId/crawls/:crawlId/graph
```

Debe mostrar nodos y enlaces.

---

# 26. Visual encoding

## Tamaño de nodo

```text
Internal PageRank
```

## Color

Selector:

```text
status code
depth
indexability
content type
directory
issue severity
```

## Tooltip

```text
URL
Status
Title
Depth
Inlinks
Outlinks
PageRank
Indexable
Issues
```

---

# 27. Filtros del grafo

```text
Status
Depth
Indexable
Directory
Minimum inlinks
Maximum inlinks
Issue
Search URL
```

Ejemplo:

```text
indexable = true
depth > 4
inlinks < 3
```

---

# 28. API del grafo

Endpoint:

```http
GET /api/crawls/:crawlId/graph
```

Respuesta:

```json
{
  "nodes": [
    {
      "id": "123",
      "url": "https://example.com/page",
      "depth": 2,
      "pagerank": 0.002,
      "status": 200
    }
  ],
  "edges": [
    {
      "source": "123",
      "target": "456",
      "anchor": "SEO guide"
    }
  ]
}
```

---

# 29. Dashboard del crawl

Ruta:

```text
/projects/:projectId/crawls/:crawlId
```

Bloques:

```text
Crawled URLs
Indexable URLs
Non-indexable URLs
Errors
Redirects
Average depth
Internal links
External links
```

---

# 30. Issues dashboard

Vista agrupada por problema.

Ejemplo:

```text
Missing Title          120
Duplicate Title         87
4xx Internal            21
Redirects              344
Missing H1              91
Depth > 4              273
```

Al seleccionar:

```text
Missing Title
```

Mostrar tabla de URLs.

---

# 31. Page Inspector

Ruta:

```text
/pages/:pageId
```

Mostrar:

```text
URL
HTTP
Metadata
Headings
Canonical
Robots
Indexability
Links
Images
Schema
Issues
```

Además:

```text
Incoming links
Outgoing links
```

---

# 32. Exportaciones CSV

Export mínimo:

```text
all-pages.csv
internal-links.csv
external-links.csv
issues.csv
```

---

# 33. Columnas del inventario

```text
URL
Status
Content Type
Title
Title Length
Meta Description
Meta Description Length
H1
H1 Count
Canonical
Robots
Indexable
Word Count
Depth
Inlinks
Outlinks
External Links
Internal PageRank
Response Time
```

---

# 34. Exportar el grafo

MVP:

```text
PNG
SVG
```

Segunda fase:

```text
PDF
```

Opciones:

```text
Current viewport
Full graph
Selected cluster
```

---

# 35. Auditoría GEO

En el MVP se recomienda trabajar con reglas simples y verificables.

Categorías:

```text
Entity clarity
Content structure
Machine readability
Structured data
Author transparency
Source transparency
Answerability
Internal semantic linking
```

---

# 36. GEO Signals

Ejemplos:

```text
Organization schema presente
Author identificado
Fecha de publicación
Fecha de modificación
About page
Contact page
Breadcrumbs
Structured data
Headings claros
Contenido indexable
Contenido server-rendered
Citations / external references
```

Generar score únicamente si cada componente es explicable.

---

# 37. IA — arquitectura

Servicio:

```text
src/
  ai/
    deepseek-client.ts
    prompts/
      executive-report.ts
      technical-report.ts
      seo-chat.ts
```

---

# 38. No enviar el crawl completo

Nunca hacer:

```text
30,000 HTML pages
↓
LLM
```

Crear primero una estructura agregada:

```json
{
  "crawl": {
    "urls": 12430,
    "indexable": 11201,
    "errors": 143
  },
  "issues": {},
  "architecture": {},
  "metadata": {},
  "pagerank": {},
  "geo": {}
}
```

---

# 39. AI Context Builder

Crear:

```ts
buildAuditContext(crawlId)
```

Debe producir información como:

```text
total URLs
indexable URLs
status distribution
top issues
depth distribution
top PageRank URLs
commercial pages with poor linking
duplicate metadata
canonical problems
orphan candidates
schema coverage
GEO signals
```

---

# 40. AI Report

Botón:

```text
Generate AI Audit
```

Salida esperada:

```text
Executive Summary

SEO Health

Critical Issues

High Priority Issues

Internal Linking Analysis

Technical SEO

Content Findings

GEO Readiness

Top 10 Recommended Actions

Expected Impact

Implementation Order
```

---

# 41. Respuesta estructurada de IA

Preferir JSON.

Ejemplo:

```json
{
  "summary": "...",
  "score": 78,
  "criticalIssues": [],
  "recommendations": [],
  "internalLinking": {},
  "geo": {}
}
```

Validar respuesta con:

- Zod

---

# 42. Chat con el crawl

No obligatorio para la primera versión pública, pero sí recomendable para MVP avanzado.

UI:

```text
Ask AI about this crawl
```

Ejemplos:

```text
¿Cuáles son mis páginas peor enlazadas?

¿Cuáles son los problemas SEO más críticos?

¿Dónde se está desperdiciando PageRank?

¿Qué páginas deberían recibir más enlaces?

¿Cuáles son mis clusters más aislados?
```

---

# 43. Tools internas para IA

La IA no debería tener acceso SQL libre.

Crear herramientas controladas:

```text
getCrawlSummary
getPagesByIssue
getTopPagesByPageRank
getLowInlinkPages
getDeepPages
getBrokenLinks
getRedirects
getPageDetails
getLinksToPage
getLinksFromPage
```

---

# 44. API Routes

Propuesta:

## Projects

```http
POST /api/projects
GET  /api/projects
GET  /api/projects/:id
PATCH /api/projects/:id
DELETE /api/projects/:id
```

## Crawls

```http
POST /api/projects/:projectId/crawls
GET  /api/crawls/:crawlId
POST /api/crawls/:crawlId/start
POST /api/crawls/:crawlId/cancel
```

## Pages

```http
GET /api/crawls/:crawlId/pages
GET /api/pages/:pageId
```

## Issues

```http
GET /api/crawls/:crawlId/issues
```

## Graph

```http
GET /api/crawls/:crawlId/graph
```

## Exports

```http
GET /api/crawls/:crawlId/export/pages.csv
GET /api/crawls/:crawlId/export/links.csv
GET /api/crawls/:crawlId/export/issues.csv
```

## AI

```http
POST /api/crawls/:crawlId/ai/report
POST /api/crawls/:crawlId/ai/chat
```

---

# 45. Estructura del repositorio

```text
/
├── app/
│   ├── dashboard/
│   ├── projects/
│   ├── api/
│   └── login/
│
├── components/
│   ├── crawl/
│   ├── graph/
│   ├── issues/
│   ├── tables/
│   └── ui/
│
├── lib/
│   ├── prisma.ts
│   ├── auth.ts
│   ├── redis.ts
│   └── queue.ts
│
├── src/
│   ├── crawler/
│   │   ├── crawler.ts
│   │   ├── fetch-page.ts
│   │   ├── parse-html.ts
│   │   ├── normalize-url.ts
│   │   ├── robots.ts
│   │   ├── sitemap.ts
│   │   └── types.ts
│   │
│   ├── workers/
│   │   └── crawl-worker.ts
│   │
│   ├── seo/
│   │   ├── indexability.ts
│   │   ├── analyze-page.ts
│   │   └── rules/
│   │
│   ├── graph/
│   │   ├── pagerank.ts
│   │   ├── stats.ts
│   │   └── graph-builder.ts
│   │
│   ├── ai/
│   │   ├── deepseek-client.ts
│   │   ├── context-builder.ts
│   │   └── prompts/
│   │
│   └── exports/
│       ├── pages-csv.ts
│       ├── links-csv.ts
│       └── issues-csv.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
└── package.json
```

---

# 46. Variables de entorno

```env
DATABASE_URL=

REDIS_URL=

NEXTAUTH_SECRET=
NEXTAUTH_URL=

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=

CRAWLER_USER_AGENT=
CRAWLER_MAX_CONCURRENCY=
```

---

# 47. Seguridad del crawler

Esto es crítico.

El crawler puede convertirse accidentalmente en una herramienta SSRF.

Bloquear requests hacia:

```text
localhost
127.0.0.1
0.0.0.0
::1

10.0.0.0/8
172.16.0.0/12
192.168.0.0/16

169.254.0.0/16
```

También bloquear:

```text
file://
ftp://
gopher://
data:
javascript:
```

Aceptar únicamente:

```text
http:
https:
```

---

# 48. Protección contra SSRF por DNS rebinding

Antes de hacer request:

1. resolver hostname;
2. revisar IP;
3. bloquear IP privada;
4. seguir redirects validando nuevamente cada hostname.

---

# 49. Límites

El MVP debe aplicar límites:

```text
max URLs
max response size
timeout HTTP
max redirects
max HTML size
crawl duration
concurrency
```

Ejemplo inicial:

```text
timeout: 15s
maxRedirects: 10
maxHTMLSize: 5 MB
```

---

# 50. Politeness

No saturar servidores externos.

Configurable:

```text
requests per second
concurrency
delay
```

Respetar:

```text
robots.txt
```

por defecto.

---

# 51. Manejo de errores

Registrar:

```text
DNS_ERROR
TIMEOUT
TLS_ERROR
CONNECTION_ERROR
INVALID_URL
BLOCKED_ROBOTS
TOO_LARGE
UNSUPPORTED_CONTENT
```

No detener el crawl completo por una URL fallida.

---

# 52. Logging

Usar:

- Pino

Campos:

```text
crawlId
pageId
url
event
duration
status
workerId
```

---

# 53. Observabilidad

MVP:

```text
logs estructurados
job status
crawl metrics
```

Posteriormente:

- Sentry;
- OpenTelemetry;
- Prometheus;
- Grafana.

---

# 54. UI principal

Sidebar:

```text
Dashboard

Projects
  Project
    Overview
    Crawls
    Pages
    Issues
    Site Graph
    AI Audit
    Exports

Settings
```

---

# 55. Pantalla Overview

Cards:

```text
URLs crawled
Indexable
Errors
Redirects
SEO Health
GEO Readiness
```

Charts:

```text
Status codes
Depth distribution
Indexability
Issue severity
```

---

# 56. Tabla Pages

Columnas configurables.

Debe soportar:

```text
pagination
sorting
filters
search
CSV export
```

No cargar 50,000 URLs en memoria en el navegador.

Usar paginación server-side.

---

# 57. Site Graph performance

No enviar siempre todos los datos.

Para sitios grandes:

```text
graph?limit=5000
```

Agregar filtros server-side.

Futuro:

```text
directory aggregation
cluster aggregation
progressive loading
```

---

# 58. Estrategia de desarrollo

## Fase 0 — Foundation

Objetivo:

tener infraestructura funcional.

Implementar:

- Next.js;
- TypeScript;
- MySQL;
- Prisma;
- Redis;
- BullMQ;
- autenticación;
- layout;
- proyectos.

---

# 59. Fase 1 — Crawler básico

Implementar:

- crear crawl;
- queue;
- worker;
- fetch HTTP;
- Cheerio;
- normalización;
- extracción de links;
- BFS;
- deduplicación;
- profundidad;
- status.

Resultado:

```text
URL
status
depth
links
```

---

# 60. Fase 2 — SEO extraction

Agregar:

```text
title
description
H1
canonical
robots
word count
content type
response time
```

---

# 61. Fase 3 — Inventory UI

Implementar:

```text
Pages table
Page inspector
Filters
Search
Pagination
```

---

# 62. Fase 4 — SEO Rules

Implementar:

```text
missing title
duplicate title
missing description
duplicate description
missing H1
multiple H1
4xx
5xx
redirect
noindex
deep pages
```

---

# 63. Fase 5 — Link graph

Crear:

```text
links table
inlinks
outlinks
PageRank
graph API
```

---

# 64. Fase 6 — Graph UI

Implementar Sigma.js.

Funciones:

```text
zoom
pan
select
search
filters
node details
```

---

# 65. Fase 7 — Exportaciones

Agregar:

```text
pages CSV
links CSV
issues CSV
graph SVG
graph PNG
```

---

# 66. Fase 8 — GEO

Agregar señales:

```text
schema
authors
dates
content structure
entity signals
machine readability
```

---

# 67. Fase 9 — IA

Integrar DeepSeek.

Implementar:

```text
context builder
AI audit
JSON structured response
report UI
```

---

# 68. Fase 10 — Chat

Agregar herramientas internas para consultar el crawl.

---

# 69. Milestones

## Milestone 1

Crawler funcional.

Criterio:

```text
Puede rastrear 1,000 URLs sin duplicados.
```

---

## Milestone 2

Inventario SEO.

Criterio:

```text
Puede mostrar y exportar metadata de las URLs.
```

---

## Milestone 3

Auditor SEO.

Criterio:

```text
Genera issues automáticamente.
```

---

## Milestone 4

Internal Linking Graph.

Criterio:

```text
Visualiza arquitectura e Internal PageRank.
```

---

## Milestone 5

AI Audit.

Criterio:

```text
Genera un reporte estructurado basado en datos reales del crawl.
```

---

# 70. Definition of Done del MVP

El MVP se considera terminado cuando un usuario puede:

1. registrarse;
2. crear un proyecto;
3. introducir un dominio;
4. iniciar un crawl;
5. ver progreso;
6. detener/cancelar el crawl;
7. ver inventario de URLs;
8. filtrar URLs;
9. revisar metadata SEO;
10. revisar errores;
11. ver enlaces internos;
12. ver inlinks/outlinks;
13. visualizar el sitio como grafo;
14. consultar Internal PageRank;
15. exportar URLs a CSV;
16. exportar enlaces a CSV;
17. exportar issues;
18. exportar el grafo;
19. consultar señales GEO;
20. generar una auditoría con IA.

---

# 71. Fuera de alcance inicial

Evitar incluir inicialmente:

```text
GA4
Search Console
Ahrefs
Semrush
full Lighthouse para todas las URLs
rank tracking
backlink crawler
keyword research
multi-region crawling
multi-user teams avanzados
white-label
scheduled crawls
JavaScript rendering para todas las páginas
```

Agregar después de validar el producto.

---

# 72. Roadmap posterior al MVP

## V1.1

```text
Playwright
JS-rendered websites
sitemap advanced analysis
hreflang
schema validation
duplicate content
near-duplicate detection
```

## V1.2

```text
PageSpeed Insights
Core Web Vitals
Chrome UX Report
```

## V1.3

```text
Search Console
GA4
orphan pages reales
traffic overlay
```

## V1.4

```text
crawl comparison
scheduled crawling
change detection
alerts
```

## V2

```text
Semantic clustering
AI internal linking suggestions
Anchor text suggestions
Content gap analysis
White-label reports
Teams
Agency mode
```

---

# 73. Prioridad técnica

El orden recomendado es:

```text
Crawler
↓
Data model
↓
Inventory
↓
SEO rules
↓
Link graph
↓
PageRank
↓
Graph UI
↓
Exports
↓
GEO
↓
AI
```

No construir la IA antes de que el dataset técnico sea confiable.

La calidad del reporte de IA dependerá directamente de la calidad de los datos generados por el crawler.

---

# 74. Primer sprint recomendado

Objetivo:

crear el primer crawl real.

## Backend

- Prisma schema;
- Project;
- Crawl;
- Page;
- Link;
- Redis;
- BullMQ;
- worker;
- URL normalization;
- fetcher;
- HTML parser.

## Frontend

- Login;
- Projects;
- Create project;
- New crawl;
- crawl progress;
- basic URL table.

## Resultado

Al terminar el sprint debemos poder hacer:

```text
https://example.com
      ↓
Start Crawl
      ↓
Queue
      ↓
Worker
      ↓
1,000 URLs
      ↓
MySQL
      ↓
tabla de resultados
```

---

# 75. Segundo sprint recomendado

Objetivo:

convertir el crawler en herramienta SEO.

Agregar:

```text
metadata
canonical
robots
indexability
H1
word count
issues
filters
CSV
```

---

# 76. Tercer sprint recomendado

Objetivo:

interlinking.

Agregar:

```text
incoming links
outgoing links
PageRank
graph data
Sigma.js
node inspector
```

---

# 77. Cuarto sprint recomendado

Objetivo:

diferenciación del producto.

Agregar:

```text
GEO signals
AI context builder
DeepSeek
AI audit
executive report
```

---

# 78. Riesgos principales

## Escala del crawler

Problema:

```text
demasiadas URLs
```

Solución:

```text
hard limits
queues
workers
batch inserts
indexes
```

---

## MySQL creciendo muy rápido

La tabla más grande será:

```text
Link
```

Un sitio de 50,000 páginas puede producir millones de enlaces.

Usar:

```text
BigInt
indexes
batch inserts
pagination
cleanup policies
```

---

## JS rendering

Playwright es caro.

No activarlo por defecto.

Crear:

```text
crawlMode:
HTTP
AUTO
JAVASCRIPT
```

En el MVP inicial:

```text
HTTP
```

---

## LLM costs

No enviar páginas completas.

Enviar:

```text
aggregations
statistics
samples
issue lists
```

---

## Seguridad

Resolver desde el inicio:

```text
SSRF
private IP blocking
redirect validation
rate limiting
crawl limits
```

---

# 79. Métricas del producto

Medir:

```text
crawl completion rate
average crawl speed
failed URLs
crawl duration
URLs per project
AI report generations
exports
graph usage
```

---

# 80. Métricas de performance objetivo

Primer objetivo razonable:

```text
10–30 URLs/sec
```

dependiendo del sitio y latencia.

Un sitio de 10,000 URLs debería ser totalmente manejable en un worker bien configurado.

La velocidad nunca debe priorizarse sobre la estabilidad del servidor rastreado.

---

# 81. Recomendación final

El núcleo del producto debe ser:

```text
                SITE CRAWLER
                     │
                     ▼
            TECHNICAL SEO DATA
                     │
              ┌──────┴──────┐
              │             │
              ▼             ▼
         SEO RULES      LINK GRAPH
                             │
                             ▼
                        PAGERANK
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
          SITE GRAPH                    GEO SIGNALS
              │                             │
              └──────────────┬──────────────┘
                             ▼
                        AI ANALYST
                             │
                             ▼
                        SEO REPORT
```

La ventaja competitiva del MVP no debe ser simplemente:

> "también rastreamos sitios".

Debe ser:

> "entendemos la arquitectura del sitio, detectamos dónde se pierde autoridad interna y convertimos los datos técnicos en recomendaciones accionables mediante IA."

---

# 82. Próximo paso técnico

Después de este documento, el siguiente artefacto recomendable es definir:

```text
1. schema.prisma definitivo
2. estructura del monorepo/proyecto
3. crawler state machine
4. algoritmo BFS
5. estrategia de concurrencia
6. endpoints
7. diseño de la primera pantalla
```

Después podemos implementar directamente el primer flujo end-to-end:

```text
Create Project
      ↓
Create Crawl
      ↓
BullMQ
      ↓
Crawler Worker
      ↓
MySQL / Prisma
      ↓
URL Inventory
```

Ese flujo debe ser la primera vertical funcional del producto.
