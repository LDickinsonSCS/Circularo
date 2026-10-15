/*
  000_create_database.sql  –  CRO (TotalAgility x Circularo)
  Creates the Circularo database. Idempotent.
  Run against master:
    sqlcmd -S .\SQLEXPRESS -E -d master -b -I -i 000_create_database.sql
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'master'
BEGIN
    RAISERROR(N'000_create_database.sql must be run in master (use -d master).', 16, 1);
    RETURN;
END

IF DB_ID(N'Circularo') IS NULL
BEGIN
    CREATE DATABASE [Circularo];
    PRINT N'Database Circularo created.';
END
ELSE
    PRINT N'Database Circularo already exists - nothing to do.';
GO

IF DB_ID(N'Circularo') IS NOT NULL
BEGIN
    ALTER DATABASE [Circularo] SET RECOVERY SIMPLE;          -- demo server; use FULL in production
    ALTER DATABASE [Circularo] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
    PRINT N'Database options set.';
END
GO
