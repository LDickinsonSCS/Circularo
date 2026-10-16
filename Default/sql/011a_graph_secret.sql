/*
  011a_graph_secret.sql  –  CRO (TotalAgility x Circularo)
  Allows the Microsoft Graph client secret (graph_client_secret) in the encrypted secret store. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 011a_graph_secret.sql
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'011a_graph_secret.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
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
    IF @Name NOT IN ('circularo_api_key', 'webhook_hmac_secret', 'graph_client_secret')
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
PRINT N'secret_set accepts graph_client_secret: ' + CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'cro_api.secret_set')) LIKE N'%graph_client_secret%' THEN N'yes' ELSE N'no' END;
GO
