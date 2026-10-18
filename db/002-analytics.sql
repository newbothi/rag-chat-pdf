-- Analítica: registro de cada consulta al chat, con las métricas de recuperación,
-- la respuesta y el feedback del usuario. La usa el servicio Python (analytics/)
-- para detectar temas sin cobertura y entrenar el modelo de confianza.
-- Ejecútalo en SSMS después de schema.sql y create-login.sql.

USE RagChat;
GO

IF OBJECT_ID('dbo.Queries') IS NULL
CREATE TABLE dbo.Queries (
    Id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Queries PRIMARY KEY,
    Question             NVARCHAR(2000)   NOT NULL,
    -- Pregunta usada para buscar (reescrita si era de seguimiento)
    SearchQuery          NVARCHAR(2000)   NOT NULL,
    -- Embedding de SearchQuery (mismo modelo que los fragmentos → VECTOR(1024))
    Embedding            VECTOR(1024)     NOT NULL,

    -- Features de recuperación (las mismas que recibe el modelo de confianza)
    TopSimilarity        FLOAT            NOT NULL,
    AvgSimilarity        FLOAT            NOT NULL,
    SimilaritySpread     FLOAT            NOT NULL,   -- top - última de las k recuperadas
    ChunksAboveThreshold INT              NOT NULL,   -- fragmentos con similitud >= umbral de relevancia
    DistinctPages        INT              NOT NULL,   -- páginas distintas entre los fragmentos relevantes
    QuestionWords        INT              NOT NULL,
    IsFollowUp           BIT              NOT NULL,
    HasDocumentFilter    BIT              NOT NULL,

    -- Resultado
    Confidence           FLOAT            NULL,       -- probabilidad predicha al momento de responder
    ConfidenceModel      VARCHAR(20)      NULL,       -- 'logistic' | 'heuristic'
    Answer               NVARCHAR(MAX)    NULL,
    LatencyMs            INT              NULL,
    Feedback             SMALLINT         NULL
                         CONSTRAINT CK_Queries_Feedback CHECK (Feedback IN (-1, 1)),
    FeedbackAt           DATETIME2(0)     NULL,

    IsSynthetic          BIT              NOT NULL CONSTRAINT DF_Queries_IsSynthetic DEFAULT 0,
    CreatedAt            DATETIME2(0)     NOT NULL CONSTRAINT DF_Queries_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Queries_CreatedAt')
    CREATE INDEX IX_Queries_CreatedAt ON dbo.Queries (CreatedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Queries_Feedback')
    CREATE INDEX IX_Queries_Feedback ON dbo.Queries (Feedback) WHERE Feedback IS NOT NULL;
GO

-- Para borrar solo los datos sintéticos generados por analytics/scripts/seed_synthetic.py:
--   DELETE FROM dbo.Queries WHERE IsSynthetic = 1;
