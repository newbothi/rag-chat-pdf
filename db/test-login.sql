-- Login para los tests de integración (solo en tu máquina de desarrollo).
-- Puede CREAR bases de datos (rol dbcreator) y es dueño de las que crea,
-- pero no puede leer ni modificar tu base RagChat.
-- Ejecútalo en SSMS como administrador y usa la misma clave en .env.test.local.
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'rag_test')
    CREATE LOGIN rag_test WITH PASSWORD = 'CambiaEstaClave_Test_123', CHECK_POLICY = OFF;
GO
ALTER SERVER ROLE dbcreator ADD MEMBER rag_test;
GO
