/*
  001_schemas.sql  –  CRO (TotalAgility x Circularo)
  Schemas and application role. Tables and procedures follow in later scripts
  once the design is settled. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 001_schemas.sql
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'001_schemas.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

IF SCHEMA_ID(N'cro') IS NULL      EXEC(N'CREATE SCHEMA [cro] AUTHORIZATION [dbo];');      -- tables
IF SCHEMA_ID(N'cro_api') IS NULL  EXEC(N'CREATE SCHEMA [cro_api] AUTHORIZATION [dbo];');  -- procedures
GO

IF DATABASE_PRINCIPAL_ID(N'cro_app') IS NULL
    CREATE ROLE [cro_app] AUTHORIZATION [dbo];
GO

-- The app role may only execute API procedures; no direct table access.
GRANT EXECUTE ON SCHEMA::[cro_api] TO [cro_app];
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[cro] TO [cro_app];
GO

DECLARE @s INT, @r INT;
SELECT @s = COUNT(*) FROM sys.schemas WHERE name COLLATE DATABASE_DEFAULT IN (N'cro', N'cro_api');
SELECT @r = COUNT(*) FROM sys.database_principals WHERE name COLLATE DATABASE_DEFAULT = N'cro_app' AND type = 'R';
PRINT N'Schemas present: ' + CAST(@s AS NVARCHAR(10)) + N'/2, role cro_app present: ' + CAST(@r AS NVARCHAR(10));
GO
