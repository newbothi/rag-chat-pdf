# Chat con tus PDFs (RAG) — SQL Server 2025 + Ollama

App de chat con IA sobre documentos: subes PDFs, se dividen en fragmentos, se generan embeddings que se guardan en **SQL Server 2025 con el tipo `VECTOR` nativo**, y el usuario pregunta con respuestas en **streaming** usando el **Vercel AI SDK v7**, con citas a documento y página. Los modelos de IA corren **localmente con Ollama**: gratis y sin enviar los documentos a ningún servicio externo.

**Stack:** Next.js 16 (App Router) · TypeScript · AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) · Ollama (`gemma3:4b` + `bge-m3`) · SQL Server 2025 (`VECTOR(1024)` + `VECTOR_DISTANCE`) · `mssql` (SQL directo, sin ORM) · `unpdf` · Tailwind 4

## Cómo funciona

```
INGESTA   PDF ──unpdf──▶ texto por página ──chunking──▶ fragmentos (~1000 chars, 150 de solape)
                                                   ──embedMany──▶ vectores 1024d (bge-m3)
          ──▶ lote JSON ──OPENJSON + CAST(... AS VECTOR(1024))──▶ dbo.Chunks

CONSULTA  pregunta ──(reescritura si es seguimiento)──▶ embed
          ──▶ SELECT TOP 6 ... ORDER BY VECTOR_DISTANCE('cosine', Embedding, @q)
          ──▶ prompt con contexto numerado [1..6] ──streamText──▶ respuesta en streaming con citas
          └─▶ fuentes (doc, página, % similitud) como metadata del mensaje → se muestran en la UI
```

## Requisitos

- Node.js 20+
- **SQL Server 2025** (el tipo `VECTOR` no existe en 2022 ni anteriores). Revisa tu versión en SSMS:
  `SELECT @@VERSION;` → debe decir *Microsoft SQL Server 2025 (17.x)*.
  Si tienes una versión anterior, usa el `docker-compose.yml` incluido (SQL Server 2025 Developer en Docker).
- **Ollama** (https://ollama.com/download) con los modelos descargados:
  ```powershell
  ollama pull gemma3:4b
  ollama pull bge-m3
  ```
  Ollama queda corriendo en segundo plano en `http://localhost:11434`. Necesitas ~4 GB de RAM libres para `gemma3:4b`.

## Puesta en marcha

### 1. Base de datos

En **SSMS**, conectado como administrador:

1. Abre y ejecuta `db/schema.sql` (crea la base `RagChat` y las tablas).
   - Si ya habías creado la base con la versión de OpenAI (`VECTOR(1536)`), ejecuta en su lugar `db/migrate-ollama-1024.sql`.
2. Abre y ejecuta `db/create-login.sql` (crea el login `rag_app`). Cambia la clave si quieres.

Node usa **autenticación SQL** (usuario y clave), no la de Windows, así que el servidor debe tener habilitado el modo mixto:
SSMS → clic derecho en el servidor → *Properties* → *Security* → **SQL Server and Windows Authentication mode** → reiniciar el servicio.

Además, TCP/IP debe estar habilitado: *SQL Server Configuration Manager* → *SQL Server Network Configuration* → *Protocols for MSSQLSERVER* → **TCP/IP: Enabled** → reiniciar el servicio.

### 2. App

```powershell
npm install
copy .env.example .env.local     # revisa DB_PASSWORD
npm run dev                      # http://localhost:3000
```

### Alternativa: SQL Server 2025 en Docker

```powershell
docker compose up -d
docker exec -i ragchat-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "RagChat_Dev_2026!" -C -i /dev/stdin < db\schema.sql
docker exec -i ragchat-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "RagChat_Dev_2026!" -C -i /dev/stdin < db\create-login.sql
```

(También puedes conectarte con SSMS a `localhost,1433` con `sa` y ejecutar los scripts ahí.)

## Configuración (`.env.local`)

| Variable          | Ejemplo                  | Descripción                                                    |
|-------------------|--------------------------|----------------------------------------------------------------|
| `DB_SERVER`       | `localhost`              | Servidor (también sirve el nombre del equipo)                  |
| `DB_INSTANCE`     | *(vacío)* o `SQLEXPRESS` | Solo para instancias con nombre (requiere SQL Server Browser)  |
| `DB_PORT`         | `1433`                   | Puerto TCP (vacío si usas `DB_INSTANCE`)                       |
| `DB_NAME`         | `RagChat`                | Base de datos                                                  |
| `DB_USER` / `DB_PASSWORD` | `rag_app` / ...  | Login creado con `create-login.sql`                            |
| `DB_TRUST_CERT`   | `true`                   | Acepta el certificado autofirmado local                        |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | API compatible con OpenAI de Ollama                         |
| `CHAT_MODEL`      | `gemma3:4b`              | Modelo para responder (prueba `qwen2.5:7b` si tienes RAM)      |
| `EMBEDDING_MODEL` | `bge-m3`                 | Si lo cambias, ajusta `VECTOR(1024)` en el SQL y `lib/db.ts`   |
| `MAX_UPLOAD_MB`   | `20`                     | Tamaño máximo del PDF                                          |

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
  pdf.ts         Extracción de texto por página (unpdf)
  chunking.ts    División recursiva (párrafo → línea → oración → palabra) con solapamiento
  ai.ts          Modelos, embeddings y reescritura de preguntas de seguimiento
  retrieval.ts   Búsqueda vectorial con VECTOR_DISTANCE (coseno)
  db.ts          Pool de conexión a SQL Server
db/
  schema.sql              Base RagChat, tablas Documents/Chunks
  migrate-ollama-1024.sql Migración desde la versión con OpenAI (1536 → 1024)
  create-login.sql        Login de la app
```

## Cambiar de proveedor de IA

Todo el acceso a modelos está en `lib/ai.ts`. Para volver a OpenAI (u otro proveedor), reemplaza el proveedor ahí y ajusta la dimensión del `VECTOR` según el modelo de embeddings (ej. `text-embedding-3-small` = 1536). Embeddings de modelos distintos no son comparables: al cambiar de modelo hay que volver a subir los documentos.

## Sobre el rendimiento de la búsqueda

`VECTOR_DISTANCE` hace búsqueda **exacta**: compara la pregunta contra todos los fragmentos. Hasta decenas de miles de fragmentos responde rápido. Para volúmenes mayores, SQL Server 2025 ofrece índices vectoriales aproximados (`CREATE VECTOR INDEX` + `VECTOR_SEARCH`, DiskANN), que en 2025 todavía requieren habilitar *preview features*.

## Siguientes pasos (para hacerlo "vendible")

1. **OCR** para PDFs escaneados.
2. **Cola de procesamiento** para PDFs grandes (la UI consulta el `Status`).
3. **Búsqueda híbrida:** combinar `VECTOR_DISTANCE` con Full-Text Search de SQL Server (`CONTAINSTABLE`) para nombres propios, códigos y números.
4. **Re-ranking** de los fragmentos recuperados.
5. **Multiempresa:** autenticación + columna `TenantId` en `Documents`.
6. **Historial persistente** de conversaciones (callback `onFinish`).
7. **Dashboard en Power BI** sobre las preguntas, documentos consultados y fragmentos más usados.
