/*
  011_contacts_access.sql  –  CRO (TotalAgility x Circularo)
  1. Contacts: external signers a sender chose to keep (also created as Circularo contacts and shared with the sender).
  2. Access requests: TotalAgility users without a Circularo account asking an administrator for one.
  Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 011_contacts_access.sql
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'011_contacts_access.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

IF OBJECT_ID(N'cro.contact', N'U') IS NULL
CREATE TABLE cro.contact (
    contact_id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_contact PRIMARY KEY,
    owner_resource_id    CHAR(32)       NOT NULL,          -- TTA user who saved it
    owner_name           NVARCHAR(200)  NULL,
    email                NVARCHAR(254)  NOT NULL,
    full_name            NVARCHAR(200)  NULL,
    company              NVARCHAR(200)  NULL,
    phone                NVARCHAR(40)   NULL,
    language             VARCHAR(10)    NULL,
    shared               BIT            NOT NULL CONSTRAINT df_contact_shared DEFAULT (0),   -- visible to every CRO user
    circularo_contact_id NVARCHAR(128)  NULL,
    last_used_utc        DATETIME2(3)   NULL,
    created_utc          DATETIME2(3)   NOT NULL CONSTRAINT df_contact_created DEFAULT (SYSUTCDATETIME()),
    updated_utc          DATETIME2(3)   NOT NULL CONSTRAINT df_contact_updated DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_contact_owner_email')
    CREATE UNIQUE INDEX ux_contact_owner_email ON cro.contact(owner_resource_id, email);
GO

IF OBJECT_ID(N'cro.access_request', N'U') IS NULL
CREATE TABLE cro.access_request (
    access_request_id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_access_request PRIMARY KEY,
    resource_id       CHAR(32)       NOT NULL,
    full_name         NVARCHAR(200)  NULL,
    email             NVARCHAR(254)  NULL,
    note              NVARCHAR(1000) NULL,
    status            VARCHAR(10)    NOT NULL CONSTRAINT df_ar_status DEFAULT ('pending'),   -- pending|done|declined
    requested_utc     DATETIME2(3)   NOT NULL CONSTRAINT df_ar_requested DEFAULT (SYSUTCDATETIME()),
    handled_by        NVARCHAR(200)  NULL,
    handled_utc       DATETIME2(3)   NULL,
    CONSTRAINT ck_ar_status CHECK (status IN ('pending','done','declined'))
);
GO

/* ------------------------------------------------------------------ contacts */
CREATE OR ALTER PROCEDURE cro_api.contact_list
    @ResourceId CHAR(32),
    @Search     NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Search = NULLIF(LTRIM(RTRIM(@Search)), N'');
    SELECT TOP (500) contact_id, email, full_name, company, phone, language, shared, circularo_contact_id, last_used_utc,
           CASE WHEN owner_resource_id = @ResourceId THEN 1 ELSE 0 END AS is_mine, owner_name
    FROM cro.contact
    WHERE (owner_resource_id = @ResourceId OR shared = 1)
      AND (@Search IS NULL OR email LIKE N'%' + @Search + N'%' OR full_name LIKE N'%' + @Search + N'%' OR company LIKE N'%' + @Search + N'%')
    ORDER BY COALESCE(last_used_utc, created_utc) DESC;
END
GO

/* Upsert by (owner, email). Returns the row. */
CREATE OR ALTER PROCEDURE cro_api.contact_save
    @ResourceId CHAR(32),
    @OwnerName  NVARCHAR(200),
    @Email      NVARCHAR(254),
    @FullName   NVARCHAR(200) = NULL,
    @Company    NVARCHAR(200) = NULL,
    @Phone      NVARCHAR(40)  = NULL,
    @Language   VARCHAR(10)   = NULL,
    @Shared     BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET @Email = LOWER(LTRIM(RTRIM(@Email)));
    IF @Email IS NULL OR @Email NOT LIKE N'_%@_%._%' THROW 50050, N'A valid email address is required.', 1;
    DECLARE @id INT = (SELECT contact_id FROM cro.contact WHERE owner_resource_id = @ResourceId AND email = @Email);
    IF @id IS NULL
    BEGIN
        INSERT cro.contact (owner_resource_id, owner_name, email, full_name, company, phone, language, shared, last_used_utc)
        VALUES (@ResourceId, @OwnerName, @Email, @FullName, @Company, @Phone, @Language, ISNULL(@Shared, 0), SYSUTCDATETIME());
        SET @id = SCOPE_IDENTITY();
        INSERT cro.audit_log (actor, action, outcome, detail) VALUES (ISNULL(@OwnerName, N'') + N' (' + @ResourceId + N')', 'contact_create', 'ok', @Email);
    END
    ELSE
        UPDATE cro.contact SET full_name = COALESCE(@FullName, full_name), company = COALESCE(@Company, company), phone = COALESCE(@Phone, phone),
               language = COALESCE(@Language, language), shared = COALESCE(@Shared, shared), last_used_utc = SYSUTCDATETIME(), updated_utc = SYSUTCDATETIME()
        WHERE contact_id = @id;
    SELECT * FROM cro.contact WHERE contact_id = @id;
END
GO

CREATE OR ALTER PROCEDURE cro_api.contact_set_circularo
    @ContactId          INT,
    @CircularoContactId NVARCHAR(128)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE cro.contact SET circularo_contact_id = @CircularoContactId, updated_utc = SYSUTCDATETIME() WHERE contact_id = @ContactId;
END
GO

/* Mark contacts as used (recipients of a request just sent) */
CREATE OR ALTER PROCEDURE cro_api.contacts_touch
    @ResourceId CHAR(32),
    @Json       NVARCHAR(MAX)     -- ["a@x.com","b@y.com"]
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE c SET last_used_utc = SYSUTCDATETIME()
    FROM cro.contact c JOIN OPENJSON(@Json) j ON LOWER(j.value) = c.email
    WHERE c.owner_resource_id = @ResourceId OR c.shared = 1;
END
GO

/* Delete: the owner, or an admin (@Force = 1). Returns the Circularo id so CRO API can delete it there too. */
CREATE OR ALTER PROCEDURE cro_api.contact_delete
    @ContactId  INT,
    @ResourceId CHAR(32),
    @Force      BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cid NVARCHAR(128), @mail NVARCHAR(254);
    SELECT @cid = circularo_contact_id, @mail = email FROM cro.contact WHERE contact_id = @ContactId AND (owner_resource_id = @ResourceId OR @Force = 1);
    IF @mail IS NULL THROW 50051, N'Contact not found or not yours.', 1;
    DELETE FROM cro.contact WHERE contact_id = @ContactId;
    INSERT cro.audit_log (actor, action, outcome, detail) VALUES (@ResourceId, 'contact_delete', 'ok', @mail);
    SELECT @cid AS circularo_contact_id;
END
GO

/* ------------------------------------------------------------------ access requests */
CREATE OR ALTER PROCEDURE cro_api.access_request_add
    @ResourceId CHAR(32),
    @FullName   NVARCHAR(200) = NULL,
    @Email      NVARCHAR(254) = NULL,
    @Note       NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id INT = (SELECT TOP (1) access_request_id FROM cro.access_request WHERE resource_id = @ResourceId AND status = 'pending');
    IF @id IS NULL
    BEGIN
        INSERT cro.access_request (resource_id, full_name, email, note) VALUES (@ResourceId, @FullName, LOWER(@Email), @Note);
        SET @id = SCOPE_IDENTITY();
        INSERT cro.audit_log (actor, action, outcome, detail) VALUES (ISNULL(@FullName, N'') + N' (' + @ResourceId + N')', 'access_request', 'ok', ISNULL(@Email, N''));
    END
    SELECT *, CASE WHEN requested_utc > DATEADD(SECOND, -5, SYSUTCDATETIME()) THEN 1 ELSE 0 END AS is_new FROM cro.access_request WHERE access_request_id = @id;
END
GO

CREATE OR ALTER PROCEDURE cro_api.access_request_list
    @Status     VARCHAR(10) = NULL,
    @ResourceId CHAR(32)    = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (200) * FROM cro.access_request
    WHERE (@Status IS NULL OR status = @Status) AND (@ResourceId IS NULL OR resource_id = @ResourceId)
    ORDER BY requested_utc DESC;
END
GO

CREATE OR ALTER PROCEDURE cro_api.access_request_set
    @AccessRequestId INT,
    @Status          VARCHAR(10),
    @Actor           NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    IF @Status NOT IN ('done','declined') THROW 50052, N'Status must be done or declined.', 1;
    UPDATE cro.access_request SET status = @Status, handled_by = @Actor, handled_utc = SYSUTCDATETIME() WHERE access_request_id = @AccessRequestId;
    INSERT cro.audit_log (actor, action, outcome, detail) VALUES (@Actor, 'access_request_' + @Status, 'ok', CAST(@AccessRequestId AS NVARCHAR(20)));
END
GO

DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
WHERE s.name = N'cro_api' AND p.name IN (N'contact_list', N'contact_save', N'contact_set_circularo', N'contacts_touch', N'contact_delete',
                                          N'access_request_add', N'access_request_list', N'access_request_set');
PRINT N'Contact and access procedures present: ' + CAST(@n AS NVARCHAR(10)) + N'/8';
GO
