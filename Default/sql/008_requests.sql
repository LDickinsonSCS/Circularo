/*
  008_requests.sql  –  CRO (TotalAgility x Circularo)
  Request list and detail for the CRO_Requests / CRO_Request forms. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 008_requests.sql
  Filters match the dashboard counters (cro_api.dashboard_overview):
    assigned  – I am a recipient whose turn it is (request in progress)
    waiting   – in progress and sent by me (all in progress when @Scope = 'all')
    completed – completed
    deadline  – in progress, deadline within @DeadlineDays
    attention – rejected, expired, cancelled or failed
    sent      – created by me
    all / NULL – everything visible
  The caller's identity (@ResourceId, @Email) is decided server-side by CRO API.
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'008_requests.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

CREATE OR ALTER PROCEDURE cro_api.request_search
    @Scope        VARCHAR(10)   = 'mine',
    @ResourceId   CHAR(32),
    @Email        NVARCHAR(254) = NULL,
    @Filter       VARCHAR(20)   = NULL,
    @State        VARCHAR(20)   = NULL,
    @Search       NVARCHAR(100) = NULL,
    @Page         INT           = 1,
    @PageSize     INT           = 25,
    @DeadlineDays INT           = 3
AS
BEGIN
    SET NOCOUNT ON;
    SET @Email = LOWER(@Email);
    SET @Filter = LOWER(NULLIF(@Filter, ''));
    SET @State = LOWER(NULLIF(@State, ''));
    SET @Search = NULLIF(LTRIM(RTRIM(@Search)), N'');
    IF @Page IS NULL OR @Page < 1 SET @Page = 1;
    IF @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 200 SET @PageSize = 25;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();

    ;WITH v AS (
        SELECT s.*,
               (SELECT TOP (1) r.status FROM cro.recipient r
                 WHERE r.request_id = s.request_id AND @Email IS NOT NULL AND r.email = @Email
                 ORDER BY CASE r.status WHEN 'waiting' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END) AS my_status
        FROM cro.signing_request s
        JOIN cro.visible_requests(@Scope, @ResourceId, @Email) x ON x.request_id = s.request_id
    )
    SELECT v.request_id, v.request_ref, v.title, v.business_ref, v.state, v.state_reason, v.layout_key,
           ISNULL(v.placement_used, v.placement) AS placement, v.created_by_name, v.created_by_resource_id,
           CASE WHEN v.created_by_resource_id = @ResourceId THEN 1 ELSE 0 END AS is_mine,
           v.my_status, v.created_utc, v.sent_utc, v.completed_utc, v.valid_until_utc,
           CASE WHEN v.outputs_retrieved_utc IS NULL THEN 0 ELSE 1 END AS has_outputs,
           (SELECT COUNT(*) FROM cro.recipient r WHERE r.request_id = v.request_id)                            AS recipients,
           (SELECT COUNT(*) FROM cro.recipient r WHERE r.request_id = v.request_id AND r.status = 'signed')    AS signed,
           STUFF((SELECT N', ' + ISNULL(NULLIF(r.full_name, N''), r.email)
                  FROM cro.recipient r WHERE r.request_id = v.request_id AND r.status = 'waiting'
                  ORDER BY r.sign_order, r.recipient_id FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') AS waiting_for,
           COUNT(*) OVER () AS total_count
    FROM v
    WHERE (@State IS NULL OR v.state = @State)
      AND (@Search IS NULL
           OR v.title LIKE N'%' + @Search + N'%'
           OR v.business_ref LIKE N'%' + @Search + N'%'
           OR CAST(v.request_id AS NVARCHAR(20)) = @Search
           OR EXISTS (SELECT 1 FROM cro.recipient r WHERE r.request_id = v.request_id
                      AND (r.email LIKE N'%' + @Search + N'%' OR r.full_name LIKE N'%' + @Search + N'%')))
      AND (@Filter IS NULL OR @Filter = 'all'
           OR (@Filter = 'assigned'  AND v.state = 'inprogress' AND v.my_status = 'waiting')
           OR (@Filter = 'waiting'   AND v.state = 'inprogress' AND (@Scope = 'all' OR v.created_by_resource_id = @ResourceId))
           OR (@Filter = 'completed' AND v.state = 'completed')
           OR (@Filter = 'deadline'  AND v.state = 'inprogress' AND v.valid_until_utc IS NOT NULL
                                     AND v.valid_until_utc < DATEADD(DAY, @DeadlineDays, @now))
           OR (@Filter = 'attention' AND v.state IN ('rejected','expired','cancelled','failed'))
           OR (@Filter = 'sent'      AND v.created_by_resource_id = @ResourceId))
    ORDER BY COALESCE(v.sent_utc, v.created_utc) DESC, v.request_id DESC
    OFFSET (@Page - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

/* What the caller may do with one request: creator, recipient (and status), visible at all */
CREATE OR ALTER PROCEDURE cro_api.request_access
    @RequestId  BIGINT,
    @ResourceId CHAR(32),
    @Email      NVARCHAR(254) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Email = LOWER(@Email);
    SELECT s.request_id,
           CASE WHEN s.created_by_resource_id = @ResourceId THEN 1 ELSE 0 END AS is_creator,
           CASE WHEN @Email IS NOT NULL AND EXISTS (SELECT 1 FROM cro.recipient r WHERE r.request_id = s.request_id AND r.email = @Email)
                THEN 1 ELSE 0 END AS is_recipient,
           (SELECT TOP (1) r.status FROM cro.recipient r WHERE r.request_id = s.request_id AND @Email IS NOT NULL AND r.email = @Email
             ORDER BY CASE r.status WHEN 'waiting' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END) AS my_status
    FROM cro.signing_request s
    WHERE s.request_id = @RequestId;
END
GO

/* History of one request: audit log + signed webhook events, newest first */
CREATE OR ALTER PROCEDURE cro_api.request_timeline
    @RequestId BIGINT,
    @Max       INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    IF @Max NOT BETWEEN 1 AND 500 SET @Max = 100;
    SELECT TOP (@Max) x.at_utc, x.source, x.action, x.what, x.who, x.outcome, x.detail
    FROM (
        SELECT a.at_utc, 'tta' AS source, a.action,
               CASE a.action WHEN 'request_create' THEN 'Created'
                             WHEN 'request_sent' THEN 'Sent for signature'
                             WHEN 'state_inprogress' THEN 'In progress'
                             WHEN 'state_completed' THEN 'Completed'
                             WHEN 'state_rejected' THEN 'Rejected'
                             WHEN 'state_expired' THEN 'Expired'
                             WHEN 'state_cancelled' THEN 'Cancelled'
                             WHEN 'state_failed' THEN 'Failed'
                             WHEN 'outputs_retrieved' THEN 'Signed copy, audit trail and certificate stored'
                             WHEN 'output_view' THEN 'Downloaded'
                             WHEN 'sign_url' THEN 'Signing page opened from TotalAgility'
                             ELSE a.action END AS what,
               a.actor AS who, a.outcome, a.detail
        FROM cro.audit_log a
        WHERE a.request_id = @RequestId
        UNION ALL
        SELECT e.received_utc, 'circularo', e.event_name,
               CASE e.event_name WHEN 'documentSigned' THEN 'Signed'
                                 WHEN 'signRejected' THEN 'Rejected'
                                 WHEN 'signDelegated' THEN 'Delegated'
                                 WHEN 'signRequest' THEN 'Signature requested'
                                 WHEN 'documentCreated' THEN 'Document created in Circularo'
                                 WHEN 'documentCompleted' THEN 'Completed in Circularo'
                                 WHEN 'signExpired' THEN 'Expired in Circularo'
                                 WHEN 'signCancelled' THEN 'Cancelled in Circularo'
                                 ELSE e.event_name END,
               e.actor, CASE WHEN e.signature_valid = 1 THEN 'ok' ELSE 'refused' END, e.process_result
        FROM cro.webhook_event e
        WHERE e.request_id = @RequestId AND e.signature_valid = 1
    ) x
    ORDER BY x.at_utc DESC;
END
GO

DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
WHERE s.name = N'cro_api' AND p.name IN (N'request_search', N'request_access', N'request_timeline');
PRINT N'Request procedures present: ' + CAST(@n AS NVARCHAR(10)) + N'/3';
GO
