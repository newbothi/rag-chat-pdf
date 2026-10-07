-- Migración: de embeddings de OpenAI (1536 dimensiones) a bge-m3 de Ollama (1024 dimensiones).
-- Ejecútalo UNA vez en SSMS si ya habías creado la base con la versión anterior de schema.sql.
-- Borra los fragmentos y documentos existentes (hay que volver a subir los PDFs,
-- porque embeddings de modelos distintos no son comparables).

USE RagChat;
GO

DELETE FROM dbo.Documents;   -- los Chunks se borran en cascada
GO

DROP TABLE IF EXISTS dbo.Chunks;
GO

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

CREATE INDEX IX_Chunks_DocumentId ON dbo.Chunks (DocumentId);
GO

-- El usuario de la app conserva sus permisos (db_datareader / db_datawriter son a nivel de base).
