# Chat con tus PDFs (RAG) — SQL Server 2025 + IA local

App de chat con IA sobre documentos: subes PDFs, se dividen en fragmentos, se generan embeddings que se guardan en **SQL Server 2025 con el tipo `VECTOR` nativo**, y el usuario pregunta con respuestas en **streaming** usando el **Vercel AI SDK v7**, con citas a documento y página.

Los modelos corren **localmente** (LM Studio u Ollama): gratis y sin enviar los documentos a ningún servicio externo. También funciona con OpenAI u otra API compatible.

**Stack:** Next.js 16 (App Router) · TypeScript · AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) · SQL Server 2025 (`VECTOR(1024)` + `VECTOR_DISTANCE`) · `mssql` (SQL directo, sin ORM) · `unpdf` · Tailwind 4 · LM Studio / Ollama

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
db/
  schema.sql              Base RagChat, tablas Documents/Chunks
  create-login.sql        Login de la app
  migrate-ollama-1024.sql Migración desde una versión anterior con embeddings de 1536 dimensiones
docs/ejemplo/
  reglamento-interno-nimbus.pdf  Documento ficticio para probar
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
7. **Dashboard en Power BI** sobre preguntas, documentos consultados y fragmentos más usados.
