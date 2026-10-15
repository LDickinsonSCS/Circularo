/*
  004_procedures.sql  –  CRO (TotalAgility x Circularo)
  API procedures in schema cro_api (the only thing role cro_app may execute).
  Idempotent: every procedure is CREATE OR ALTER (SQL Server 2016 SP1+).
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 004_procedures.sql

  Conventions
  - All times UTC. Actor = TTA resource id (32 hex) + display name, decided by the caller's
    server-side session check, never by the browser.
  - Every change, and every refusal, writes to cro.audit_log.
  - JSON in, rows out. Needs database compatibility level >= 130 for OPENJSON.
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'004_procedures.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

DECLARE @lvl INT = (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME());
IF @lvl < 130
BEGIN
    PRINT N'Raising compatibility level to 130 for OPENJSON (was ' + CAST(@lvl AS NVARCHAR(10)) + N').';
    ALTER DATABASE CURRENT SET COMPATIBILITY_LEVEL = 130;
END
GO

/* ------------------------------------------------------------------ audit */
CREATE OR ALTER PROCEDURE cro_api.audit_write
    @Actor     NVARCHAR(200),
    @Action    VARCHAR(64),
    @Outcome   VARCHAR(10)    = 'ok',
    @RequestId BIGINT         = NULL,
    @UserId    INT            = NULL,
    @Detail    NVARCHAR(4000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT cro.audit_log (actor, action, outcome, request_id, user_id, detail)
    VALUES (ISNULL(NULLIF(@Actor, N''), N'system'), @Action,
            CASE WHEN @Outcome IN ('ok','refused','error') THEN @Outcome ELSE 'error' END,
            @RequestId, @UserId, @Detail);
END
GO

/* ------------------------------------------------------------------ health */
CREATE OR ALTER PROCEDURE cro_api.health
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @tables INT, @procs INT;
    SELECT @tables = COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = N'cro';
    SELECT @procs  = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id WHERE s.name = N'cro_api';
    SELECT  DB_NAME()                                             AS [database],
            SUSER_SNAME()                                         AS login_name,
            USER_NAME()                                           AS db_user,
            IS_ROLEMEMBER(N'cro_app')                             AS in_cro_app,
            IS_SRVROLEMEMBER(N'sysadmin')                         AS is_sysadmin,
            CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(40)) AS sql_version,
            CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100))      AS sql_edition,
            (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat_level,
            @tables                                               AS cro_tables,
            @procs                                                AS cro_api_procs,
            (SELECT COUNT(*) FROM cro.signing_request)            AS requests,
            (SELECT COUNT(*) FROM cro.webhook_event WHERE processed_utc IS NULL) AS webhooks_pending,
            SYSUTCDATETIME()                                      AS utc_now;
END
GO

/* ------------------------------------------------------------------ requests */
/*
  @Json:
  { "title":"…", "businessRef":"…", "ttaJobId":"…", "documentType":"d_default", "layoutKey":"01_mutual_nda",
    "placement":"anchors", "adhocOption":"default_position", "sequential":true, "validUntilUtc":"2026-11-15T00:00:00",
    "recipients":[ { "order":1, "kind":"external", "email":"…", "fullName":"…", "purpose":"sign",
                     "protection":"email_otp", "internalMode":null, "anchorId":"…", "userId":null } ] }
*/
CREATE OR ALTER PROCEDURE cro_api.request_create
    @ActorId   CHAR(32),
    @ActorName NVARCHAR(200),
    @Json      NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @actor NVARCHAR(200) = ISNULL(@ActorName, N'') + N' (' + ISNULL(@ActorId, N'?') + N')';

    IF ISJSON(@Json) <> 1
    BEGIN
        EXEC cro_api.audit_write @actor, 'request_create', 'refused', NULL, NULL, N'Invalid JSON';
        THROW 50001, N'Request details are not valid JSON.', 1;
    END

    DECLARE @title NVARCHAR(255) = LTRIM(RTRIM(JSON_VALUE(@Json, '$.title')));
    IF @title IS NULL OR @title = N''
    BEGIN
        EXEC cro_api.audit_write @actor, 'request_create', 'refused', NULL, NULL, N'Missing title';
        THROW 50002, N'A title is required.', 1;
    END
    IF @title LIKE N'%[/?<>\:*|"]%'
    BEGIN
        EXEC cro_api.audit_write @actor, 'request_create', 'refused', NULL, NULL, N'Title has characters Circularo does not allow';
        THROW 50003, N'The title cannot contain / ? < > \ : * | or ".', 1;
    END

    DECLARE @r TABLE (sign_order INT, kind VARCHAR(10), email NVARCHAR(254), full_name NVARCHAR(200), share_purpose VARCHAR(10),
                      protection VARCHAR(10), internal_mode VARCHAR(20), anchor_id VARCHAR(64), user_id INT);
    INSERT @r
    SELECT ISNULL(TRY_CAST(JSON_VALUE(v.value, '$.order') AS INT), 1),
           LOWER(ISNULL(JSON_VALUE(v.value, '$.kind'), 'external')),
           LOWER(LTRIM(RTRIM(JSON_VALUE(v.value, '$.email')))),
           JSON_VALUE(v.value, '$.fullName'),
           LOWER(ISNULL(JSON_VALUE(v.value, '$.purpose'), 'sign')),
           LOWER(ISNULL(JSON_VALUE(v.value, '$.protection'), 'email_otp')),
           LOWER(JSON_VALUE(v.value, '$.internalMode')),
           JSON_VALUE(v.value, '$.anchorId'),
           TRY_CAST(JSON_VALUE(v.value, '$.userId') AS INT)
    FROM OPENJSON(@Json, '$.recipients') v;

    IF NOT EXISTS (SELECT 1 FROM @r)
    BEGIN
        EXEC cro_api.audit_write @actor, 'request_create', 'refused', NULL, NULL, N'No recipients';
        THROW 50004, N'At least one recipient is required.', 1;
    END
    IF EXISTS (SELECT 1 FROM @r WHERE email IS NULL OR email NOT LIKE N'_%@_%._%')
    BEGIN
        EXEC cro_api.audit_write @actor, 'request_create', 'refused', NULL, NULL, N'Recipient email missing or invalid';
        THROW 50005, N'Every recipient needs a valid email address.', 1;
    END
    IF (SELECT COUNT(*) FROM @r) > 100
    BEGIN
        EXEC cro_api.audit_write @actor, 'request_create', 'refused', NULL, NULL, N'More than 100 recipients';
        THROW 50006, N'Circularo allows at most 100 participants per request.', 1;
    END

    DECLARE @id BIGINT, @ref UNIQUEIDENTIFIER;
    BEGIN TRY
        BEGIN TRAN;
        INSERT cro.signing_request (tta_job_id, business_ref, title, document_type, layout_key, placement, adhoc_option,
                                    sequential, valid_until_utc, created_by_resource_id, created_by_name)
        VALUES (NULLIF(JSON_VALUE(@Json, '$.ttaJobId'), N''),
                JSON_VALUE(@Json, '$.businessRef'),
                @title,
                ISNULL(NULLIF(JSON_VALUE(@Json, '$.documentType'), N''), 'd_default'),
                NULLIF(JSON_VALUE(@Json, '$.layoutKey'), N''),
                ISNULL(NULLIF(LOWER(JSON_VALUE(@Json, '$.placement')), N''), 'anchors'),
                NULLIF(LOWER(JSON_VALUE(@Json, '$.adhocOption')), N''),
                CASE WHEN JSON_VALUE(@Json, '$.sequential') = 'false' THEN 0 ELSE 1 END,
                TRY_CAST(JSON_VALUE(@Json, '$.validUntilUtc') AS DATETIME2(3)),
                @ActorId, @ActorName);
        SET @id = SCOPE_IDENTITY();
        SELECT @ref = request_ref FROM cro.signing_request WHERE request_id = @id;

        INSERT cro.recipient (request_id, sign_order, kind, user_id, email, full_name, share_purpose, protection, internal_mode, anchor_id)
        SELECT @id, sign_order, kind, user_id, email, full_name, share_purpose, protection,
               CASE WHEN kind = 'internal' THEN ISNULL(internal_mode, 'circularo_login') END, anchor_id
        FROM @r;

        INSERT cro.audit_log (actor, action, outcome, request_id, detail)
        VALUES (@actor, 'request_create', 'ok', @id, N'Recipients: ' + CAST((SELECT COUNT(*) FROM @r) AS NVARCHAR(10)));
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @msg NVARCHAR(2000) = ERROR_MESSAGE();
        EXEC cro_api.audit_write @actor, 'request_create', 'error', NULL, NULL, @msg;
        THROW;
    END CATCH

    SELECT @id AS request_id, @ref AS request_ref;
END
GO

CREATE OR ALTER PROCEDURE cro_api.request_get
    @RequestId  BIGINT           = NULL,
    @RequestRef UNIQUEIDENTIFIER = NULL,
    @DocumentId VARCHAR(64)      = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id BIGINT = @RequestId;
    IF @id IS NULL AND @RequestRef IS NOT NULL SELECT @id = request_id FROM cro.signing_request WHERE request_ref = @RequestRef;
    IF @id IS NULL AND @DocumentId IS NOT NULL SELECT @id = request_id FROM cro.signing_request WHERE circularo_document_id = @DocumentId;

    SELECT request_id, request_ref, tta_job_id, business_ref, title, document_type, layout_key, placement, adhoc_option,
           placement_used, circularo_document_id, original_file_hash, signed_file_hash, sequential, valid_until_utc,
           state, state_reason, created_by_resource_id, created_by_name, created_utc, sent_utc, completed_utc,
           last_event_utc, last_checked_utc, outputs_retrieved_utc
    FROM cro.signing_request WHERE request_id = @id;

    SELECT recipient_id, sign_order, kind, user_id, email, full_name, share_to, internal_mode, share_purpose,
           protection, anchor_id, share_id, status, acted_utc
    FROM cro.recipient WHERE request_id = @id ORDER BY sign_order, recipient_id;
END
GO

CREATE OR ALTER PROCEDURE cro_api.request_list
    @State    VARCHAR(20)   = NULL,     -- NULL = all, 'open' = draft/sending/inprogress
    @Search   NVARCHAR(100) = NULL,
    @Page     INT           = 1,
    @PageSize INT           = 50
AS
BEGIN
    SET NOCOUNT ON;
    IF @Page < 1 SET @Page = 1;
    IF @PageSize NOT BETWEEN 1 AND 200 SET @PageSize = 50;
    SELECT request_id, request_ref, title, business_ref, state, placement, placement_used, created_by_name,
           created_utc, sent_utc, completed_utc, valid_until_utc,
           (SELECT COUNT(*) FROM cro.recipient r WHERE r.request_id = s.request_id) AS recipients,
           (SELECT COUNT(*) FROM cro.recipient r WHERE r.request_id = s.request_id AND r.status = 'signed') AS signed,
           COUNT(*) OVER () AS total
    FROM cro.signing_request s
    WHERE (@State IS NULL OR (@State = 'open' AND state IN ('draft','sending','inprogress')) OR state = @State)
      AND (@Search IS NULL OR title LIKE N'%' + @Search + N'%' OR business_ref LIKE N'%' + @Search + N'%')
    ORDER BY created_utc DESC
    OFFSET (@Page - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

/* Called by CRO Signing after the Circularo document exists */
CREATE OR ALTER PROCEDURE cro_api.request_set_document
    @RequestId     BIGINT,
    @DocumentId    VARCHAR(64),
    @FileHash      VARCHAR(128),
    @PlacementUsed VARCHAR(20) = NULL,
    @Detail        NVARCHAR(2000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE cro.signing_request
       SET circularo_document_id = @DocumentId, original_file_hash = @FileHash,
           placement_used = ISNULL(@PlacementUsed, placement_used), state = 'sending'
     WHERE request_id = @RequestId AND state IN ('draft','sending','failed');
    IF @@ROWCOUNT = 0
    BEGIN
        EXEC cro_api.audit_write N'system', 'request_set_document', 'refused', @RequestId, NULL, N'Request not found or not in draft/sending';
        THROW 50010, N'Request not found or already sent.', 1;
    END
    EXEC cro_api.audit_write N'system', 'request_set_document', 'ok', @RequestId, NULL, @Detail;
END
GO

/* @Json: [ { "recipientId":1, "shareId":"…", "shareTo":"…" } ] */
CREATE OR ALTER PROCEDURE cro_api.request_set_shares
    @RequestId BIGINT,
    @Json      NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRAN;
    UPDATE r SET r.share_id = j.share_id, r.share_to = j.share_to, r.status = 'waiting'
    FROM cro.recipient r
    JOIN OPENJSON(@Json) WITH (recipient_id BIGINT '$.recipientId', share_id VARCHAR(128) '$.shareId', share_to NVARCHAR(254) '$.shareTo') j
      ON j.recipient_id = r.recipient_id
    WHERE r.request_id = @RequestId;
    UPDATE cro.signing_request SET state = 'inprogress', sent_utc = SYSUTCDATETIME(), state_reason = NULL
     WHERE request_id = @RequestId;
    INSERT cro.audit_log (actor, action, outcome, request_id, detail)
    VALUES (N'system', 'request_sent', 'ok', @RequestId, N'Shares: ' + CAST((SELECT COUNT(*) FROM OPENJSON(@Json)) AS NVARCHAR(10)));
    COMMIT;
END
GO

/* Status sync from Circularo (webhook or poll).
   @RecipientsJson: [ { "recipientId":1, "status":"signed" } ]  (optional) */
CREATE OR ALTER PROCEDURE cro_api.request_set_state
    @RequestId      BIGINT,
    @State          VARCHAR(20),
    @Reason         NVARCHAR(2000) = NULL,
    @SignedFileHash VARCHAR(128)   = NULL,
    @RecipientsJson NVARCHAR(MAX)  = NULL,
    @Source         VARCHAR(20)    = 'poll',     -- poll|webhook|user|system
    @Actor          NVARCHAR(200)  = N'system'
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @State NOT IN ('draft','sending','inprogress','completed','rejected','expired','cancelled','failed')
        THROW 50020, N'Unknown state.', 1;
    DECLARE @old VARCHAR(20);
    SELECT @old = state FROM cro.signing_request WHERE request_id = @RequestId;
    IF @old IS NULL THROW 50021, N'Request not found.', 1;

    BEGIN TRAN;
    UPDATE cro.signing_request
       SET state = @State,
           state_reason = CASE WHEN @Reason IS NOT NULL THEN @Reason ELSE state_reason END,
           signed_file_hash = ISNULL(@SignedFileHash, signed_file_hash),
           completed_utc = CASE WHEN @State IN ('completed','rejected','expired','cancelled') AND completed_utc IS NULL THEN SYSUTCDATETIME() ELSE completed_utc END,
           last_checked_utc = CASE WHEN @Source = 'poll' THEN SYSUTCDATETIME() ELSE last_checked_utc END,
           last_event_utc = CASE WHEN @Source = 'webhook' THEN SYSUTCDATETIME() ELSE last_event_utc END
     WHERE request_id = @RequestId;

    IF @RecipientsJson IS NOT NULL AND ISJSON(@RecipientsJson) = 1
        UPDATE r SET r.status = j.status,
                     r.acted_utc = CASE WHEN j.status IN ('signed','rejected','delegated') AND r.acted_utc IS NULL THEN SYSUTCDATETIME() ELSE r.acted_utc END
        FROM cro.recipient r
        JOIN OPENJSON(@RecipientsJson) WITH (recipient_id BIGINT '$.recipientId', status VARCHAR(12) '$.status') j
          ON j.recipient_id = r.recipient_id
        WHERE r.request_id = @RequestId
          AND j.status IN ('pending','waiting','signed','rejected','delegated','expired','cancelled');

    IF @old <> @State
        INSERT cro.audit_log (actor, action, outcome, request_id, detail)
        VALUES (ISNULL(@Actor, N'system'), 'state_' + @State, 'ok', @RequestId,
                N'From ' + @old + N' via ' + ISNULL(@Source, '?') + ISNULL(N': ' + @Reason, N''));
    COMMIT;
END
GO

CREATE OR ALTER PROCEDURE cro_api.request_outputs_done
    @RequestId BIGINT,
    @Detail    NVARCHAR(2000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE cro.signing_request SET outputs_retrieved_utc = SYSUTCDATETIME() WHERE request_id = @RequestId;
    EXEC cro_api.audit_write N'system', 'outputs_retrieved', 'ok', @RequestId, NULL, @Detail;
END
GO

/* Requests the sync job should re-check: no event for @StaleMinutes, or within @NearDeadlineHours of the deadline,
   or completed without outputs retrieved. */
CREATE OR ALTER PROCEDURE cro_api.requests_due_check
    @StaleMinutes       INT = 30,
    @NearDeadlineMinutes INT = 1440,
    @NearDeadlineEvery  INT = 5,
    @Max                INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (@Max) request_id, circularo_document_id, document_type, state, valid_until_utc, last_event_utc, last_checked_utc
    FROM cro.signing_request
    WHERE circularo_document_id IS NOT NULL
      AND (
            (state = 'inprogress' AND ISNULL(last_checked_utc, sent_utc) < DATEADD(MINUTE, -@StaleMinutes, @now)
                                  AND ISNULL(last_event_utc, sent_utc)   < DATEADD(MINUTE, -@StaleMinutes, @now))
         OR (state = 'inprogress' AND valid_until_utc IS NOT NULL
                                  AND valid_until_utc < DATEADD(MINUTE, @NearDeadlineMinutes, @now)
                                  AND ISNULL(last_checked_utc, sent_utc) < DATEADD(MINUTE, -@NearDeadlineEvery, @now))
         OR (state = 'completed' AND outputs_retrieved_utc IS NULL)
          )
    ORDER BY ISNULL(last_checked_utc, sent_utc);
END
GO

/* ------------------------------------------------------------------ webhooks */
CREATE OR ALTER PROCEDURE cro_api.webhook_receive
    @SignatureValid BIT,
    @RawBody        NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @doc VARCHAR(64), @evt VARCHAR(64), @actor NVARCHAR(254), @ts DATETIME2(3), @req BIGINT;
    IF ISJSON(@RawBody) = 1
        SELECT @doc = LEFT(JSON_VALUE(@RawBody, '$.documentId'), 64),
               @evt = LEFT(JSON_VALUE(@RawBody, '$.event'), 64),
               @actor = LEFT(JSON_VALUE(@RawBody, '$.actor'), 254),
               @ts = TRY_CAST(LEFT(JSON_VALUE(@RawBody, '$.timestamp'), 23) AS DATETIME2(3));
    IF @doc IS NOT NULL SELECT @req = request_id FROM cro.signing_request WHERE circularo_document_id = @doc;

    INSERT cro.webhook_event (signature_valid, document_id, event_name, actor, event_utc, raw_body, request_id,
                              processed_utc, process_result)
    VALUES (@SignatureValid, @doc, @evt, @actor, @ts, LEFT(@RawBody, 20000), @req,
            CASE WHEN @SignatureValid = 0 OR @req IS NULL THEN SYSUTCDATETIME() END,
            CASE WHEN @SignatureValid = 0 THEN N'ignored: bad signature'
                 WHEN @req IS NULL THEN N'ignored: not a CRO document' END);

    SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS event_id, @req AS request_id;
END
GO

CREATE OR ALTER PROCEDURE cro_api.webhook_next
    @Max INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Max) e.event_id, e.request_id, e.document_id, e.event_name, e.actor, e.event_utc, e.received_utc,
           s.document_type, s.state
    FROM cro.webhook_event e
    JOIN cro.signing_request s ON s.request_id = e.request_id
    WHERE e.processed_utc IS NULL AND e.signature_valid = 1
    ORDER BY e.event_id;
END
GO

CREATE OR ALTER PROCEDURE cro_api.webhook_done
    @EventId BIGINT,
    @Result  NVARCHAR(2000)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE cro.webhook_event SET processed_utc = SYSUTCDATETIME(), process_result = @Result
    WHERE event_id = @EventId AND processed_utc IS NULL;
END
GO

/* ------------------------------------------------------------------ users */
CREATE OR ALTER PROCEDURE cro_api.user_list
AS
BEGIN
    SET NOCOUNT ON;
    SELECT user_id, tta_resource_id, email, full_name, circularo_user_id, circularo_username, circularo_role,
           status, last_error, created_utc, updated_utc
    FROM cro.circularo_user ORDER BY full_name;
END
GO

/* Creates or updates the local record; Circularo itself is called by CRO Users afterwards. */
CREATE OR ALTER PROCEDURE cro_api.user_upsert
    @ActorId       CHAR(32),
    @ActorName     NVARCHAR(200),
    @TtaResourceId CHAR(32)      = NULL,
    @Email         NVARCHAR(254),
    @FullName      NVARCHAR(200),
    @Role          VARCHAR(20)   = 'user'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @actor NVARCHAR(200) = ISNULL(@ActorName, N'') + N' (' + ISNULL(@ActorId, N'?') + N')';
    SET @Email = LOWER(LTRIM(RTRIM(@Email)));
    IF @Email IS NULL OR @Email NOT LIKE N'_%@_%._%'
    BEGIN
        EXEC cro_api.audit_write @actor, 'user_upsert', 'refused', NULL, NULL, N'Invalid email';
        THROW 50030, N'A valid email address is required.', 1;
    END
    IF @Role NOT IN ('admin','user','prepare','read','sign') SET @Role = 'user';

    DECLARE @id INT;
    SELECT @id = user_id FROM cro.circularo_user WHERE email = @Email
        OR (@TtaResourceId IS NOT NULL AND tta_resource_id = @TtaResourceId);
    IF @id IS NULL
    BEGIN
        INSERT cro.circularo_user (tta_resource_id, email, full_name, circularo_role) VALUES (@TtaResourceId, @Email, @FullName, @Role);
        SET @id = SCOPE_IDENTITY();
        EXEC cro_api.audit_write @actor, 'user_create', 'ok', NULL, @id, @Email;
    END
    ELSE
    BEGIN
        UPDATE cro.circularo_user SET tta_resource_id = ISNULL(@TtaResourceId, tta_resource_id), email = @Email,
               full_name = @FullName, circularo_role = @Role, updated_utc = SYSUTCDATETIME()
        WHERE user_id = @id;
        EXEC cro_api.audit_write @actor, 'user_update', 'ok', NULL, @id, @Email;
    END
    SELECT * FROM cro.circularo_user WHERE user_id = @id;
END
GO

/* Result of the Circularo call made by CRO Users */
CREATE OR ALTER PROCEDURE cro_api.user_set_circularo
    @UserId            INT,
    @Status            VARCHAR(20),
    @CircularoUserId   NVARCHAR(128) = NULL,
    @CircularoUsername NVARCHAR(254) = NULL,
    @Error             NVARCHAR(2000) = NULL,
    @Actor             NVARCHAR(200) = N'system'
AS
BEGIN
    SET NOCOUNT ON;
    IF @Status NOT IN ('pending','invited','active','suspended','deleted','error') THROW 50031, N'Unknown user status.', 1;
    UPDATE cro.circularo_user
       SET status = @Status,
           circularo_user_id = ISNULL(@CircularoUserId, circularo_user_id),
           circularo_username = ISNULL(@CircularoUsername, circularo_username),
           last_error = @Error, updated_utc = SYSUTCDATETIME()
     WHERE user_id = @UserId;
    DECLARE @outcome VARCHAR(10) = CASE WHEN @Status = 'error' THEN 'error' ELSE 'ok' END;
    DECLARE @detail NVARCHAR(4000) = @Status + ISNULL(N': ' + @Error, N'');
    EXEC cro_api.audit_write @Actor, 'user_circularo', @outcome, NULL, @UserId, @detail;
END
GO

/* ------------------------------------------------------------------ check */
DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id WHERE s.name = N'cro_api';
PRINT N'cro_api procedures present: ' + CAST(@n AS NVARCHAR(10)) + N' (expected 16)';
GO
