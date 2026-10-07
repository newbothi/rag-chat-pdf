-- Esquema de la app RAG para SQL Server 2025 (tipo VECTOR nativo)
-- Ejecútalo en SSMS o con:  sqlcmd -S localhost -U sa -P <clave> -C -i db\schema.sql
-- Requiere SQL Server 2025 (17.x), Azure SQL Database o Azure SQL Managed Instance.

IF DB_ID('RagChat') IS NULL
    CREATE DATABASE RagChat;
GO

USE RagChat;
GO

IF OBJECT_ID('dbo.Documents') IS NULL
CREATE TABLE dbo.Documents (
    Id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Documents PRIMARY KEY DEFAULT NEWID(),
    Name       NVARCHAR(400)    NOT NULL,
    Pages      INT              NOT NULL,
    SizeBytes  INT              NOT NULL,
    Status     VARCHAR(20)      NOT NULL CONSTRAINT DF_Documents_Status DEFAULT 'processing'
               CONSTRAINT CK_Documents_Status CHECK (Status IN ('processing', 'ready', 'error')),
    Error      NVARCHAR(MAX)    NULL,
    CreatedAt  DATETIME2(0)     NOT NULL CONSTRAINT DF_Documents_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO

-- 1024 dimensiones = bge-m3 (Ollama).
-- Si cambias de modelo de embeddings, cambia la dimensión aquí y en lib/db.ts (EMBEDDING_DIMENSIONS).
IF OBJECT_ID('dbo.Chunks') IS NULL
CREATE TABLE dbo.Chunks (
    Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chunks PRIMARY KEY,
    DocumentId  UNIQUEIDENTIFIER NOT NULL
                CONSTRAINT FK_Chunks_Documents REFERENCES dbo.Documents(Id) ON DELETE CASCADE,
    ChunkIndex  INT           NOT NULL,
    Page        INT           NOT NULL,
    Content     NVARCHAR(MAX) NOT NULL,
    Embedding   VECTOR(1024)  NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Chunks_DocumentId')
    CREATE INDEX IX_Chunks_DocumentId ON dbo.Chunks (DocumentId);
GO
