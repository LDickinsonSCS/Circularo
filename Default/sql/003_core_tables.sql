/*
  003_core_tables.sql  –  CRO (TotalAgility x Circularo)
  Core tables: signing requests, recipients, webhook inbox, Circularo users,
  append-only audit log. Idempotent (creates only what is missing).
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 003_core_tables.sql
  All times are UTC.
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'003_core_tables.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

/* Internal signers: Circularo accounts managed from TTA */
IF OBJECT_ID(N'cro.circularo_user', N'U') IS NULL
CREATE TABLE cro.circularo_user (
    user_id               INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_circularo_user PRIMARY KEY,
    tta_resource_id       CHAR(32)       NULL,                -- TTA resource it belongs to
    email                 NVARCHAR(254)  NOT NULL,
    full_name             NVARCHAR(200)  NOT NULL,
    circularo_user_id     NVARCHAR(128)  NULL,
    circularo_username    NVARCHAR(254)  NULL,
    circularo_role        VARCHAR(20)    NOT NULL CONSTRAINT df_cu_role DEFAULT ('user'),     -- admin|user|prepare|read|sign
    status                VARCHAR(20)    NOT NULL CONSTRAINT df_cu_status DEFAULT ('pending'), -- pending|invited|active|suspended|deleted|error
    last_error            NVARCHAR(2000) NULL,
    created_utc           DATETIME2(3)   NOT NULL CONSTRAINT df_cu_created DEFAULT (SYSUTCDATETIME()),
    updated_utc           DATETIME2(3)   NOT NULL CONSTRAINT df_cu_updated DEFAULT (SYSUTCDATETIME()),
    row_ver               ROWVERSION,
    CONSTRAINT ck_cu_role   CHECK (circularo_role IN ('admin','user','prepare','read','sign')),
    CONSTRAINT ck_cu_status CHECK (status IN ('pending','invited','active','suspended','deleted','error'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_cu_email')
    CREATE UNIQUE INDEX ux_cu_email ON cro.circularo_user(email);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_cu_tta_resource')
    CREATE UNIQUE INDEX ux_cu_tta_resource ON cro.circularo_user(tta_resource_id) WHERE tta_resource_id IS NOT NULL;
GO

/* One row per document sent for signature */
IF OBJECT_ID(N'cro.signing_request', N'U') IS NULL
CREATE TABLE cro.signing_request (
    request_id             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_signing_request PRIMARY KEY,
    request_ref            UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_sr_ref DEFAULT (NEWID()),   -- safe id for the UI
    tta_job_id             CHAR(32)       NULL,
    business_ref           NVARCHAR(100)  NULL,               -- caller's case / reference number
    title                  NVARCHAR(255)  NOT NULL,
    document_type          VARCHAR(64)    NOT NULL CONSTRAINT df_sr_doctype DEFAULT ('d_default'),
    layout_key             VARCHAR(64)    NULL,               -- anchor layout in CRO_CONFIG
    placement              VARCHAR(20)    NOT NULL CONSTRAINT df_sr_placement DEFAULT ('anchors'),
    adhoc_option           VARCHAR(20)    NULL,               -- fallback when anchors find nothing
    placement_used         VARCHAR(20)    NULL,               -- what actually happened
    circularo_document_id  VARCHAR(64)    NULL,
    original_file_hash     VARCHAR(128)   NULL,
    signed_file_hash       VARCHAR(128)   NULL,
    sequential             BIT            NOT NULL CONSTRAINT df_sr_seq DEFAULT (1),
    valid_until_utc        DATETIME2(3)   NULL,
    state                  VARCHAR(20)    NOT NULL CONSTRAINT df_sr_state DEFAULT ('draft'),
    state_reason           NVARCHAR(2000) NULL,
    created_by_resource_id CHAR(32)       NULL,
    created_by_name        NVARCHAR(200)  NULL,
    created_utc            DATETIME2(3)   NOT NULL CONSTRAINT df_sr_created DEFAULT (SYSUTCDATETIME()),
    sent_utc               DATETIME2(3)   NULL,
    completed_utc          DATETIME2(3)   NULL,
    last_event_utc         DATETIME2(3)   NULL,               -- last webhook seen
    last_checked_utc       DATETIME2(3)   NULL,               -- last status poll
    outputs_retrieved_utc  DATETIME2(3)   NULL,               -- signed PDF + audit fetched
    row_ver                ROWVERSION,
    CONSTRAINT ck_sr_state CHECK (state IN ('draft','sending','inprogress','completed','rejected','expired','cancelled','failed')),
    CONSTRAINT ck_sr_placement CHECK (placement IN ('anchors','coordinates','template','word_template','detect','adhoc')),
    CONSTRAINT ck_sr_adhoc CHECK (adhoc_option IS NULL OR adhoc_option IN ('default_position','circularo_editor','tta_placer','detect','tokens'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_sr_ref')
    CREATE UNIQUE INDEX ux_sr_ref ON cro.signing_request(request_ref);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_sr_document')
    CREATE UNIQUE INDEX ux_sr_document ON cro.signing_request(circularo_document_id) WHERE circularo_document_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_sr_open')
    CREATE INDEX ix_sr_open ON cro.signing_request(state, last_checked_utc) INCLUDE (circularo_document_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_sr_job')
    CREATE INDEX ix_sr_job ON cro.signing_request(tta_job_id);
GO

/* Recipients of a request (one Circularo share each) */
IF OBJECT_ID(N'cro.recipient', N'U') IS NULL
CREATE TABLE cro.recipient (
    recipient_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_recipient PRIMARY KEY,
    request_id       BIGINT         NOT NULL CONSTRAINT fk_rcp_request REFERENCES cro.signing_request(request_id),
    sign_order       INT            NOT NULL CONSTRAINT df_rcp_order DEFAULT (1),
    kind             VARCHAR(10)    NOT NULL,                 -- internal|external
    user_id          INT            NULL CONSTRAINT fk_rcp_user REFERENCES cro.circularo_user(user_id),
    email            NVARCHAR(254)  NOT NULL,
    full_name        NVARCHAR(200)  NULL,
    share_to         NVARCHAR(254)  NULL,                     -- what was sent to Circularo (username or email)
    internal_mode    VARCHAR(20)    NULL,                     -- circularo_login|as_external|saml (internal only)
    share_purpose    VARCHAR(10)    NOT NULL CONSTRAINT df_rcp_purpose DEFAULT ('sign'),
    protection       VARCHAR(10)    NOT NULL CONSTRAINT df_rcp_prot DEFAULT ('email_otp'),  -- none|email_otp|sms_otp|password|oauth
    anchor_id        VARCHAR(64)    NULL,
    share_id         VARCHAR(128)   NULL,
    status           VARCHAR(12)    NOT NULL CONSTRAINT df_rcp_status DEFAULT ('pending'),
    acted_utc        DATETIME2(3)   NULL,
    created_utc      DATETIME2(3)   NOT NULL CONSTRAINT df_rcp_created DEFAULT (SYSUTCDATETIME()),
    row_ver          ROWVERSION,
    CONSTRAINT ck_rcp_kind    CHECK (kind IN ('internal','external')),
    CONSTRAINT ck_rcp_purpose CHECK (share_purpose IN ('sign','approve','accept','review','view')),
    CONSTRAINT ck_rcp_prot    CHECK (protection IN ('none','email_otp','sms_otp','password','oauth')),
    CONSTRAINT ck_rcp_mode    CHECK (internal_mode IS NULL OR internal_mode IN ('circularo_login','as_external','saml')),
    CONSTRAINT ck_rcp_status  CHECK (status IN ('pending','waiting','signed','rejected','delegated','expired','cancelled'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_rcp_request')
    CREATE INDEX ix_rcp_request ON cro.recipient(request_id, sign_order);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_rcp_share')
    CREATE INDEX ix_rcp_share ON cro.recipient(share_id) WHERE share_id IS NOT NULL;
GO

/* Webhook inbox: every callback from Circularo, stored before processing */
IF OBJECT_ID(N'cro.webhook_event', N'U') IS NULL
CREATE TABLE cro.webhook_event (
    event_id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_webhook_event PRIMARY KEY,
    received_utc      DATETIME2(3)   NOT NULL CONSTRAINT df_we_received DEFAULT (SYSUTCDATETIME()),
    signature_valid   BIT            NOT NULL,
    document_id       VARCHAR(64)    NULL,
    event_name        VARCHAR(64)    NULL,
    actor             NVARCHAR(254)  NULL,
    event_utc         DATETIME2(3)   NULL,
    raw_body          NVARCHAR(MAX)  NOT NULL,
    request_id        BIGINT         NULL,                     -- matched request, if ours
    processed_utc     DATETIME2(3)   NULL,
    process_result    NVARCHAR(2000) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_we_unprocessed')
    CREATE INDEX ix_we_unprocessed ON cro.webhook_event(processed_utc, event_id);
GO

/* Append-only audit log */
IF OBJECT_ID(N'cro.audit_log', N'U') IS NULL
CREATE TABLE cro.audit_log (
    audit_id      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_audit_log PRIMARY KEY,
    at_utc        DATETIME2(3)   NOT NULL CONSTRAINT df_al_at DEFAULT (SYSUTCDATETIME()),
    actor         NVARCHAR(200)  NOT NULL,                     -- TTA user, 'system', 'circularo:<actor>'
    action        VARCHAR(64)    NOT NULL,
    outcome       VARCHAR(10)    NOT NULL CONSTRAINT df_al_outcome DEFAULT ('ok'),  -- ok|refused|error
    request_id    BIGINT         NULL,
    user_id       INT            NULL,
    detail        NVARCHAR(4000) NULL,
    CONSTRAINT ck_al_outcome CHECK (outcome IN ('ok','refused','error'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_al_request')
    CREATE INDEX ix_al_request ON cro.audit_log(request_id, at_utc);
GO

IF OBJECT_ID(N'cro.tr_audit_log_append_only', N'TR') IS NULL
EXEC (N'
CREATE TRIGGER cro.tr_audit_log_append_only ON cro.audit_log
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    RAISERROR(N''cro.audit_log is append-only.'', 16, 1);
    ROLLBACK TRANSACTION;
END');
GO

/* Check */
DECLARE @t INT, @tr INT;
SELECT @t = COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = N'cro' AND t.name COLLATE DATABASE_DEFAULT IN (N'circularo_user', N'signing_request', N'recipient', N'webhook_event', N'audit_log');
SELECT @tr = COUNT(*) FROM sys.triggers WHERE name = N'tr_audit_log_append_only';
PRINT N'cro tables present: ' + CAST(@t AS NVARCHAR(10)) + N'/5, audit trigger present: ' + CAST(@tr AS NVARCHAR(10)) + N'/1';
GO
