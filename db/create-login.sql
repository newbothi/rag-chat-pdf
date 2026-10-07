-- Crea un login SQL para la app (Node no usa la autenticación de Windows por defecto).
-- Ejecútalo en SSMS conectado como administrador, DESPUÉS de schema.sql.
-- Cambia la clave y usa la misma en DB_PASSWORD de .env.local.

USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'rag_app')
    CREATE LOGIN rag_app WITH PASSWORD = 'CambiaEstaClave_123', CHECK_POLICY = OFF;
GO

USE RagChat;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rag_app')
    CREATE USER rag_app FOR LOGIN rag_app;
GO
ALTER ROLE db_datareader ADD MEMBER rag_app;
ALTER ROLE db_datawriter ADD MEMBER rag_app;
GO
