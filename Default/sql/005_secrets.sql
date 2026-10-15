/*
  005_secrets.sql  –  CRO (TotalAgility x Circularo)
  Encrypted secret store. Values are encrypted on the TTA server with Windows DPAPI (machine scope
  plus a CRO-specific entropy) before they reach SQL, so the stored bytes are useless anywhere else.
  The plain value never enters SQL. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 005_secrets.sql
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'005_secrets.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

IF OBJECT_ID(N'cro.secret', N'U') IS NULL
CREATE TABLE cro.secret (
    name          VARCHAR(64)    NOT NULL CONSTRAINT pk_secret PRIMARY KEY,
    protected_b64 NVARCHAR(MAX)  NOT NULL,             -- DPAPI ciphertext, base64
    fingerprint   CHAR(16)       NOT NULL,             -- first 16 hex of SHA-256 of the plain value (to compare, not to recover)
    value_length  INT            NOT NULL,
    machine_name  NVARCHAR(128)  NOT NULL,             -- where it was protected (only that machine can decrypt)
    set_by        NVARCHAR(200)  NOT NULL,
    set_utc       DATETIME2(3)   NOT NULL CONSTRAINT df_secret_set DEFAULT (SYSUTCDATETIME())
);
GO

CREATE OR ALTER PROCEDURE cro_api.secret_set
    @Name         VARCHAR(64),
    @ProtectedB64 NVARCHAR(MAX),
    @Fingerprint  CHAR(16),
    @ValueLength  INT,
    @MachineName  NVARCHAR(128),
    @Actor        NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    IF @Name NOT IN ('circularo_api_key', 'webhook_hmac_secret')
    BEGIN
        EXEC cro_api.audit_write @Actor, 'secret_set', 'refused', NULL, NULL, N'Unknown secret name';
        THROW 50040, N'Unknown secret name.', 1;
    END
    MERGE cro.secret AS t
    USING (SELECT @Name AS name) AS s ON t.name = s.name
    WHEN MATCHED THEN UPDATE SET protected_b64 = @ProtectedB64, fingerprint = @Fingerprint, value_length = @ValueLength,
                                 machine_name = @MachineName, set_by = @Actor, set_utc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (name, protected_b64, fingerprint, value_length, machine_name, set_by)
                          VALUES (@Name, @ProtectedB64, @Fingerprint, @ValueLength, @MachineName, @Actor);
    DECLARE @d NVARCHAR(4000) = @Name + N' fingerprint ' + @Fingerprint + N' on ' + @MachineName;
    EXEC cro_api.audit_write @Actor, 'secret_set', 'ok', NULL, NULL, @d;
END
GO

CREATE OR ALTER PROCEDURE cro_api.secret_get
    @Name VARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT name, protected_b64, fingerprint, value_length, machine_name, set_by, set_utc
    FROM cro.secret WHERE name = @Name;
END
GO

/* Status without the ciphertext, for admin pages */
CREATE OR ALTER PROCEDURE cro_api.secret_status
AS
BEGIN
    SET NOCOUNT ON;
    SELECT name, fingerprint, value_length, machine_name, set_by, set_utc FROM cro.secret ORDER BY name;
END
GO

DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
WHERE s.name = N'cro_api' AND p.name IN (N'secret_set', N'secret_get', N'secret_status');
PRINT N'cro.secret present: ' + CASE WHEN OBJECT_ID(N'cro.secret', N'U') IS NULL THEN N'no' ELSE N'yes' END
    + N', secret procedures: ' + CAST(@n AS NVARCHAR(10)) + N'/3';
GO
