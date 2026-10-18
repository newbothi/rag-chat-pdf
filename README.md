# Chat con tus PDFs (RAG) — SQL Server 2025 + IA local

App de chat con IA sobre documentos: subes PDFs, se dividen en fragmentos, se generan embeddings que se guardan en **SQL Server 2025 con el tipo `VECTOR` nativo**, y el usuario pregunta con respuestas en **streaming** usando el **Vercel AI SDK v7**, con citas a documento y página.

Los modelos corren **localmente** (LM Studio u Ollama): gratis y sin enviar los documentos a ningún servicio externo. También funciona con OpenAI u otra API compatible.

**Stack:** Next.js 16 (App Router) · TypeScript · Python (FastAPI, scikit-learn) · AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) · SQL Server 2025 (`VECTOR(1024)` + `VECTOR_DISTANCE`) · `mssql` (SQL directo, sin ORM) · `unpdf` · Tailwind 4 · LM Studio / Ollama

## Cómo funciona

```
INGESTA   PDF ──unpdf──▶ texto por página ──chunking──▶ fragmentos (~1000 chars, 150 de solape)
                                                   ──embedMany (bge-m3)──▶ vectores de 1024 dimensiones
          ──▶ lote JSON ──OPENJSON + CAST(... AS VECTOR(1024))──▶ dbo.Chunks

CONSULTA  pregunta ──(reescritura si es seguimiento)──▶ embed
          ──▶ SELECT TOP 6 ... ORDER BY VECTOR_DISTANCE('cosine', Embedding, @q)
          ──▶ prompt con contexto numerado [1..6] ──streamText──▶ respuesta en streaming con citas
          └─▶ fuentes (doc, página, % similitud) como metadata del mensaje → se muestran en la UI
```

## Requisitos

- **Node.js 20+**
- **SQL Server 2025**: el tipo `VECTOR` no existe en 2022 ni anteriores. Revisa con `SELECT @@VERSION;` (debe decir *SQL Server 2025 (17.x)*). Si tienes una versión anterior, usa el `docker-compose.yml` incluido.
- **LM Studio** (recomendado) u **Ollama**, con:
  - un modelo de **embeddings**: `bge-m3` (multilingüe, 1024 dimensiones)
  - un modelo de **chat**: por ejemplo `gemma-3-4b-it` o `llama-3.2-3b-instruct`

## Puesta en marcha

### 1. Base de datos (SSMS, como administrador)

1. Ejecuta `db/schema.sql`: crea la base `RagChat` y las tablas `Documents` y `Chunks`.
2. Ejecuta `db/create-login.sql`: crea el login `rag_app`. **Cambia la clave** en tu servidor y usa la misma en `.env.local`.
3. Habilita la **autenticación mixta**: clic derecho en el servidor → *Propiedades* → *Seguridad* → *Modo de autenticación de SQL Server y de Windows*.
4. Habilita **TCP/IP**: *SQL Server Configuration Manager* → *Protocolos de MSSQLSERVER* → *TCP/IP: Habilitado*.
5. Reinicia el servicio de SQL Server.

### 2. Modelos locales

**Opción A: LM Studio (recomendada)**

1. Descarga desde la búsqueda de modelos:
   - `gpustack/bge-m3-GGUF` (Q8_0) para los embeddings
   - `lmstudio-community/gemma-3-4b-it-GGUF` (Q4_K_M) para el chat
2. En la pestaña **Developer**, carga ambos modelos y activa el servidor (**Status: Running**, puerto 1234).
3. Revisa los ids exactos en <http://localhost:1234/v1/models>.

**Opción B: Ollama**

```bash
ollama pull bge-m3
ollama pull gemma3:4b
```

> En algunos equipos Windows, `bge-m3` falla en Ollama (`llama-server ... 0xc0000005`). En ese caso usa LM Studio para los embeddings: chat y embeddings pueden venir de servidores distintos.

### 3. App

```bash
npm install
copy .env.example .env.local     # en Linux/macOS: cp
# edita .env.local (clave de SQL y nombres de modelos)
npm run dev                      # http://localhost:3000
```

Sube `docs/ejemplo/reglamento-interno-nimbus.pdf` (documento ficticio incluido) y pregunta, por ejemplo, *"¿Cuántos días de vacaciones tengo al año?"*.

## Analítica con machine learning (Python)

Un servicio aparte en **Python (FastAPI + scikit-learn)** analiza cómo se usa el chat. Next.js registra cada consulta en `dbo.Queries` (pregunta, embedding, métricas de la búsqueda, respuesta y feedback 👍/👎) y consume el servicio por HTTP interno, autenticado con un secreto compartido.

```
Next.js (Node) ──HTTP + X-Analytics-Key──▶ FastAPI (Python)
      │  escribe dbo.Queries                    │  lee dbo.Queries
      └──────────────── SQL Server 2025 ────────┘
```

**1. Temas sin cobertura**: agrupa las preguntas por significado con **KMeans sobre sus embeddings** (normalizados, equivalente a similitud coseno; *k* elegido por coeficiente de silueta) y, por tema, mide la similitud del mejor fragmento y la tasa de 👎. Los temas frecuentes, mal cubiertos y mal evaluados aparecen primero: es la lista de documentos que falta escribir. Cada tema se etiqueta con su pregunta más representativa y palabras clave por c-TF-IDF, y se muestra un mapa 2D (PCA).

**2. Confianza de las respuestas**: una **regresión logística** predice, *antes de generar la respuesta*, la probabilidad de que sea útil a partir de cómo salió la búsqueda (similitud máxima y promedio, dispersión, fragmentos relevantes, páginas distintas, largo de la pregunta, si es de seguimiento, si hay filtro). Se evalúa con validación cruzada estratificada (AUC, exactitud, Brier, matriz de confusión) y se compara con un baseline que usa solo la similitud. Con menos de 20 respuestas evaluadas usa una heurística (arranque en frío). Se reentrena en segundo plano con cada 👍/👎.

**Contrato tipado**: los modelos Pydantic de FastAPI se exportan a OpenAPI y de ahí se generan los tipos de TypeScript (`lib/analytics-api.d.ts`). Si Python cambia una respuesta, `tsc` lo detecta.

**Tolerancia a fallos**: si el servicio Python está caído o tarda más de 1,5 s, el chat responde igual, sin el indicador de confianza.

### Puesta en marcha de la analítica

Requisitos: **Python 3.10+** y el driver **ODBC Driver 18 for SQL Server** (en PowerShell: `Get-OdbcDriver -Name "*SQL Server*"`; si no aparece, descárgalo de Microsoft).

```bash
# 1. Tabla de consultas (SSMS)
#    ejecuta db/002-analytics.sql

# 2. Entorno de Python (una sola vez)
cd analytics
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt      # Linux/macOS: .venv/bin/pip
cd ..

# 3. En .env.local agrega ANALYTICS_URL y un ANALYTICS_API_KEY propio (ver .env.example)

# 4. Levantar web + análisis juntos
npm run dev:all
```

Panel: <http://localhost:3000/analytics>.

| Comando | Qué hace |
|---|---|
| `npm run dev:all` | Next.js y FastAPI juntos |
| `npm run analytics` | Solo el servicio Python (puerto 8001, docs en `/docs`) |
| `npm run analytics:test` | Tests de Python (pytest) |
| `npm run analytics:seed` | Genera ~75 consultas sintéticas (`-- --reset` para regenerarlas) |
| `npm run gen:analytics-types` | Regenera los tipos de TypeScript desde el OpenAPI |

**Datos sintéticos**: `analytics:seed` usa preguntas inventadas, pero sus embeddings y similitudes son reales (se buscan en tus documentos con la misma consulta que la app). Solo el feedback es simulado, con una regla conocida que depende de la similitud. Así se comprueba que el modelo aprende ese patrón y que el clustering detecta los temas que el reglamento de ejemplo no cubre (licencias médicas, sueldos, instalaciones). Requiere haber subido el PDF de ejemplo. Se guardan con `IsSynthetic = 1` y el panel permite excluirlos.

## Calidad (QA y QC)

![CI](https://github.com/newbothi/rag-chat-pdf/actions/workflows/ci.yml/badge.svg)

Cada push y pull request ejecuta el pipeline de GitHub Actions (`.github/workflows/ci.yml`). Si un job falla, el PR queda en rojo.

| Job | Qué verifica |
|---|---|
| **Web** | Lint y formato (Biome), tipos (`tsc`), tests unitarios con cobertura mínima, `next build` |
| **Analytics** | Lint y formato (ruff, incluye reglas de seguridad), pytest con cobertura mínima del 85 % |
| **Contrato** | Que `analytics/openapi.json` coincida con FastAPI y que `lib/analytics-api.d.ts` coincida con ese OpenAPI |
| **Integración** | Levanta **SQL Server 2025 en Docker**, crea la base desde `db/*.sql` y prueba Node y Python contra la base real |
| **Seguridad** | gitleaks (claves subidas por error en todo el historial), `npm audit` y `pip-audit` |

Además, **Dependabot** propone actualizaciones de dependencias cada semana y un **hook de pre-commit** (husky + lint-staged) formatea y revisa los archivos modificados antes de cada commit.

### Qué cubren los tests

- **Unitarios de Node (Vitest)**:
  - Fragmentación de texto: tamaños, solapamiento, que no se pierda contenido, palabras cortadas con guion (incluidas tildes y ñ).
  - Métricas de recuperación y cliente del servicio Python, con su degradación si falla o la clave es inválida.
  - Rutas de la API con validaciones e intentos de inyección.
  - La ruta del chat completa con un LLM simulado (`MockLanguageModelV4`): fuentes, confianza, registro y que siga respondiendo si Python o el registro fallan.
  - Extracción del PDF de ejemplo real.
- **Unitarios de Python (pytest)**: el modelo de confianza recupera un patrón plantado (AUC > 0,8), el clustering detecta el tema sin cobertura, arranque en frío, persistencia, autenticación y validación de la API, y la cadena de conexión con caracteres especiales.
- **Integración (SQL Server 2025 real)**:
  - Ingesta del PDF con inserción en lotes en columnas `VECTOR(1024)`.
  - Rollback si fallan los embeddings.
  - Borrado en cascada.
  - Búsqueda con `VECTOR_DISTANCE`: orden, `k`, filtro por documento y documentos no listos.
  - Registro de consultas y feedback, incluida la restricción `CHECK`.
  - El repositorio de Python leyendo el tipo `VECTOR` con pyodbc.

### Correr los tests en local

```bash
npm test                 # unitarios de Node
npm run test:coverage    # … con cobertura
npm run analytics:test   # Python con cobertura
npm run check            # todo lo anterior + lint y tipos (lo mismo que el CI, sin integración)
```

**Integración** (usa una base aparte, `RagChat_Test`, que se borra y recrea en cada ejecución):

1. En SSMS, ejecuta `db/test-login.sql`. Crea el login `rag_test`, que puede crear bases pero no tocar `RagChat`.
2. Copia `.env.test.example` a `.env.test.local` y pon la clave.
3. Ejecuta:

```bash
npm run test:integration                              # Node
npm run db:test && npm run analytics:test:integration      # Python
```

## Configuración (`.env.local`)

| Variable             | Ejemplo                       | Descripción                                                    |
|----------------------|-------------------------------|----------------------------------------------------------------|
| `DB_SERVER`          | `localhost`                   | Servidor SQL Server                                            |
| `DB_INSTANCE`        | *(vacío)* o `SQLEXPRESS`      | Solo para instancias con nombre (requiere SQL Server Browser)  |
| `DB_PORT`            | `1433`                        | Puerto TCP (vacío si usas `DB_INSTANCE`)                       |
| `DB_NAME`            | `RagChat`                     | Base de datos                                                  |
| `DB_USER` / `DB_PASSWORD` | `rag_app` / ...          | Login creado con `create-login.sql`                            |
| `DB_TRUST_CERT`      | `true`                        | Acepta el certificado autofirmado local                        |
| `CHAT_BASE_URL`      | `http://localhost:1234/v1`    | LM Studio (`:1234`) u Ollama (`:11434`)                        |
| `CHAT_MODEL`         | `gemma-3-4b-it`               | Id del modelo de chat                                          |
| `EMBEDDING_BASE_URL` | `http://localhost:1234/v1`    | Servidor de embeddings                                         |
| `EMBEDDING_MODEL`    | `text-embedding-bge-m3`       | En Ollama: `bge-m3`                                            |
| `MAX_UPLOAD_MB`      | `20`                          | Tamaño máximo del PDF                                          |
| `ANALYTICS_URL`      | `http://localhost:8001`       | Servicio Python                                                |
| `ANALYTICS_API_KEY`  | *(secreto largo)*             | Lo comparten Next.js y Python                                  |
| `RELEVANCE_THRESHOLD`| `0.5`                         | Similitud mínima para que un fragmento cuente como relevante   |
| `GAP_THRESHOLD`      | `0.5`                         | Bajo esta similitud media, un tema queda "sin cobertura"       |

Los cambios en `.env.local` se leen al arrancar: reinicia `npm run dev` después de editarlo.

## Estructura

```
app/
  api/documents/route.ts        GET lista · POST sube PDF (extrae → fragmenta → embeddings → guarda)
  api/documents/[id]/route.ts   DELETE documento (los fragmentos se borran en cascada)
  api/chat/route.ts             Recuperación + streamText con fuentes en messageMetadata
  page.tsx                      Panel de documentos + chat
components/
  DocumentPanel.tsx             Drag & drop, lista, filtro por documento, borrar
  Chat.tsx                      useChat (AI SDK v7), streaming, botón detener, fuentes
lib/
  ai.ts          Proveedores (chat y embeddings por separado), reescritura de preguntas
  chunking.ts    División recursiva (párrafo → línea → oración → palabra) con solapamiento
  pdf.ts         Extracción de texto por página (unpdf)
  retrieval.ts   Búsqueda vectorial con VECTOR_DISTANCE (coseno)
  db.ts          Pool de conexión a SQL Server
  analytics.ts   Cliente del servicio Python, features de recuperación, registro de consultas
  analytics-api.d.ts  Tipos generados desde el OpenAPI de FastAPI
analytics/                      Servicio Python (FastAPI + scikit-learn)
  app/main.py        Endpoints y autenticación
  app/confidence.py  Regresión logística, validación cruzada, arranque en frío
  app/topics.py      Clustering de preguntas, c-TF-IDF, PCA, detección de huecos
  app/repository.py  SQL directo con pyodbc
  scripts/           Generador de datos sintéticos y exportador de OpenAPI
  tests/             pytest (modelos y API)
db/
  schema.sql              Base RagChat, tablas Documents/Chunks
  create-login.sql        Login de la app
  002-analytics.sql       Tabla Queries para la analítica
  test-login.sql          Login para los tests de integración
  migrate-ollama-1024.sql Migración desde una versión anterior con embeddings de 1536 dimensiones
docs/ejemplo/
  reglamento-interno-nimbus.pdf  Documento ficticio para probar
tests/
  unit/          Vitest: lógica, rutas de la API y chat con LLM simulado
  integration/   Vitest contra SQL Server 2025 real
scripts/
  test-db.mjs    Crea la base de pruebas desde db/*.sql
  py.mjs         Ejecuta el Python del entorno virtual (Windows/Linux)
.github/
  workflows/ci.yml   Pipeline de CI
  dependabot.yml     Actualizaciones de dependencias
```

## Cambiar de modelo o proveedor

- **Modelo de chat:** cambia `CHAT_MODEL`. No hay que volver a subir los PDFs.
- **Modelo de embeddings:** los vectores de modelos distintos no son comparables. Si cambias de modelo, ajusta `VECTOR(1024)` en la base y `EMBEDDING_DIMENSIONS` en `lib/db.ts` a la dimensión del nuevo modelo, y vuelve a subir los documentos.
- **OpenAI u otro proveedor en la nube:** cualquier API compatible con OpenAI funciona apuntando `CHAT_BASE_URL` y `EMBEDDING_BASE_URL` a ella (para claves de API, agrega `apiKey` al proveedor en `lib/ai.ts`).

## Sobre el rendimiento de la búsqueda

`VECTOR_DISTANCE` hace búsqueda **exacta**: compara la pregunta contra todos los fragmentos. Hasta decenas de miles de fragmentos responde rápido. Para volúmenes mayores, SQL Server 2025 ofrece índices vectoriales aproximados (`CREATE VECTOR INDEX` + `VECTOR_SEARCH`, DiskANN), que en 2025 todavía requieren habilitar *preview features*.

## Siguientes pasos

1. **OCR** para PDFs escaneados.
2. **Cola de procesamiento** para PDFs grandes (la UI consulta el `Status`).
3. **Búsqueda híbrida:** combinar `VECTOR_DISTANCE` con Full-Text Search de SQL Server (`CONTAINSTABLE`) para nombres propios, códigos y números.
4. **Re-ranking** de los fragmentos recuperados.
5. **Multiempresa:** autenticación + columna `TenantId` en `Documents`.
6. **Historial persistente** de conversaciones.
7. **Dashboard en Power BI** conectado directamente a `dbo.Queries`.
