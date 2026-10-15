/*
  006_outputs.sql  –  CRO (TotalAgility x Circularo)
  Stores what Circularo produces when a request finishes: the signed PDF, the audit trail and the
  Certificate of Fulfillment. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 006_outputs.sql
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'006_outputs.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

IF OBJECT_ID(N'cro.output_file', N'U') IS NULL
CREATE TABLE cro.output_file (
    output_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_output_file PRIMARY KEY,
    request_id    BIGINT         NOT NULL CONSTRAINT fk_out_request REFERENCES cro.signing_request(request_id),
    kind          VARCHAR(20)    NOT NULL,              -- signed|audit|certificate
    file_name     NVARCHAR(260)  NOT NULL,
    content_type  VARCHAR(100)   NOT NULL CONSTRAINT df_out_ct DEFAULT ('application/pdf'),
    content       VARBINARY(MAX) NOT NULL,
    size_bytes    INT            NOT NULL,
    sha256        CHAR(64)       NOT NULL,
    source_hash   VARCHAR(128)   NULL,                  -- Circularo file hash, where there is one
    has_signature BIT            NULL,                  -- PDF contains a signature dictionary
    created_utc   DATETIME2(3)   NOT NULL CONSTRAINT df_out_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_out_kind CHECK (kind IN ('signed','audit','certificate'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_out_request_kind')
    CREATE UNIQUE INDEX ux_out_request_kind ON cro.output_file(request_id, kind);
GO

/* Replaces any earlier copy of the same kind for the request. */
CREATE OR ALTER PROCEDURE cro_api.output_save
    @RequestId    BIGINT,
    @Kind         VARCHAR(20),
    @FileName     NVARCHAR(260),
    @ContentType  VARCHAR(100),
    @Content      VARBINARY(MAX),
    @Sha256       CHAR(64),
    @SourceHash   VARCHAR(128) = NULL,
    @HasSignature BIT          = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @Kind NOT IN ('signed','audit','certificate') THROW 50050, N'Unknown output kind.', 1;
    IF NOT EXISTS (SELECT 1 FROM cro.signing_request WHERE request_id = @RequestId) THROW 50051, N'Request not found.', 1;
    BEGIN TRAN;
    DELETE cro.output_file WHERE request_id = @RequestId AND kind = @Kind;
    INSERT cro.output_file (request_id, kind, file_name, content_type, content, size_bytes, sha256, source_hash, has_signature)
    VALUES (@RequestId, @Kind, @FileName, @ContentType, @Content, DATALENGTH(@Content), LOWER(@Sha256), @SourceHash, @HasSignature);
    DECLARE @d NVARCHAR(4000) = @Kind + N' ' + CAST(DATALENGTH(@Content) AS NVARCHAR(20)) + N' bytes sha256 ' + LOWER(@Sha256);
    INSERT cro.audit_log (actor, action, outcome, request_id, detail) VALUES (N'system', 'output_saved', 'ok', @RequestId, @d);
    COMMIT;
    SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS output_id;
END
GO

CREATE OR ALTER PROCEDURE cro_api.output_list
    @RequestId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT output_id, kind, file_name, content_type, size_bytes, sha256, source_hash, has_signature, created_utc
    FROM cro.output_file WHERE request_id = @RequestId ORDER BY kind;
END
GO

CREATE OR ALTER PROCEDURE cro_api.output_get
    @RequestId BIGINT,
    @Kind      VARCHAR(20),
    @Actor     NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @d NVARCHAR(4000) = N'Downloaded ' + @Kind;
    IF EXISTS (SELECT 1 FROM cro.output_file WHERE request_id = @RequestId AND kind = @Kind)
        EXEC cro_api.audit_write @Actor, 'output_view', 'ok', @RequestId, NULL, @d;
    SELECT file_name, content_type, size_bytes, sha256, content
    FROM cro.output_file WHERE request_id = @RequestId AND kind = @Kind;
END
GO

DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
WHERE s.name = N'cro_api' AND p.name IN (N'output_save', N'output_list', N'output_get');
PRINT N'cro.output_file present: ' + CASE WHEN OBJECT_ID(N'cro.output_file', N'U') IS NULL THEN N'no' ELSE N'yes' END
    + N', output procedures: ' + CAST(@n AS NVARCHAR(10)) + N'/3';
GO
