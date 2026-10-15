/*
  002_service_login.sql  –  CRO (TotalAgility x Circularo)
  Gives the TotalAgility service account (scs-admin) access to the Circularo
  database through role cro_app (EXECUTE on cro_api only). Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 002_service_login.sql

  The Windows login is looked up as <domain>\scs-admin, then <machine>\scs-admin.
  If neither exists, set @override below to the exact account name and re-run.
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'002_service_login.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

DECLARE @override SYSNAME = N'';   -- e.g. N'SUDOCODE\scs-admin'
DECLARE @login SYSNAME = NULL, @candidate SYSNAME, @sql NVARCHAR(400);

DECLARE @candidates TABLE (n INT, name SYSNAME);
IF @override <> N'' INSERT @candidates VALUES (0, @override);
INSERT @candidates VALUES (1, DEFAULT_DOMAIN() + N'\scs-admin');
INSERT @candidates VALUES (2, CAST(SERVERPROPERTY('MachineName') AS SYSNAME) + N'\scs-admin');

-- 1. An existing login wins.
SELECT TOP 1 @login = sp.name
FROM sys.server_principals sp
JOIN @candidates c ON sp.name COLLATE DATABASE_DEFAULT = c.name COLLATE DATABASE_DEFAULT
WHERE sp.type IN ('U')
ORDER BY c.n;

-- 2. Otherwise create it from Windows, trying each candidate in turn.
IF @login IS NULL
BEGIN
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @candidates ORDER BY n;
    OPEN cur; FETCH NEXT FROM cur INTO @candidate;
    WHILE @@FETCH_STATUS = 0 AND @login IS NULL
    BEGIN
        BEGIN TRY
            SET @sql = N'CREATE LOGIN ' + QUOTENAME(@candidate) + N' FROM WINDOWS;';
            EXEC (@sql);
            SET @login = @candidate;
            PRINT N'Created login ' + @candidate;
        END TRY
        BEGIN CATCH
            PRINT N'Not found: ' + @candidate + N' (' + ERROR_MESSAGE() + N')';
        END CATCH
        FETCH NEXT FROM cur INTO @candidate;
    END
    CLOSE cur; DEALLOCATE cur;
END

IF @login IS NULL
BEGIN
    RAISERROR(N'No scs-admin Windows account found. Set @override to the exact account and re-run.', 16, 1);
    RETURN;
END

-- 3. Database user and role membership.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name COLLATE DATABASE_DEFAULT = @login COLLATE DATABASE_DEFAULT)
BEGIN
    SET @sql = N'CREATE USER ' + QUOTENAME(@login) + N' FOR LOGIN ' + QUOTENAME(@login) + N' WITH DEFAULT_SCHEMA = [cro_api];';
    EXEC (@sql);
    PRINT N'Created database user ' + @login;
END

IF NOT EXISTS (
    SELECT 1 FROM sys.database_role_members rm
    JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id AND r.name = N'cro_app'
    JOIN sys.database_principals u ON u.principal_id = rm.member_principal_id
    WHERE u.name COLLATE DATABASE_DEFAULT = @login COLLATE DATABASE_DEFAULT)
BEGIN
    SET @sql = N'ALTER ROLE [cro_app] ADD MEMBER ' + QUOTENAME(@login) + N';';
    EXEC (@sql);
END

DECLARE @sysadmin INT = IS_SRVROLEMEMBER(N'sysadmin', @login);
PRINT N'Login ' + @login + N' is a member of cro_app.';
IF @sysadmin = 1
    PRINT N'WARNING: ' + @login + N' is sysadmin, so the cro_app restrictions do not apply to it. Use a low-privilege account in production.';
GO
