/*
  007_dashboard.sql  –  CRO (TotalAgility x Circularo)
  Dashboard and monitoring: sync heartbeat, recent webhook events, overview counters,
  status breakdown, volume over time, success/turnaround, recent activity. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 007_dashboard.sql

  Scope: @Scope = 'mine' (requests the caller created, or is a recipient of) or 'all' (admins).
  The caller's identity (@ResourceId, @Email) is decided server-side by CRO API.
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'007_dashboard.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

/* ------------------------------------------------------------------ sync heartbeat */
IF OBJECT_ID(N'cro.sync_heartbeat', N'U') IS NULL
CREATE TABLE cro.sync_heartbeat (
    id             TINYINT        NOT NULL CONSTRAINT pk_sync_heartbeat PRIMARY KEY CONSTRAINT ck_hb_single CHECK (id = 1),
    last_run_utc   DATETIME2(3)   NOT NULL,
    last_work_utc  DATETIME2(3)   NULL,               -- last run that actually did something
    runs           BIGINT         NOT NULL,
    last_events    INT            NOT NULL,
    last_requests  INT            NOT NULL,
    last_failed    INT            NOT NULL,
    last_summary   NVARCHAR(4000) NULL
);
GO

CREATE OR ALTER PROCEDURE cro_api.sync_heartbeat
    @Events   INT,
    @Requests INT,
    @Failed   INT,
    @Summary  NVARCHAR(4000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
    MERGE cro.sync_heartbeat AS t
    USING (SELECT 1 AS id) AS s ON t.id = s.id
    WHEN MATCHED THEN UPDATE SET last_run_utc = @now,
                                 last_work_utc = CASE WHEN @Events > 0 OR @Requests > 0 THEN @now ELSE t.last_work_utc END,
                                 runs = t.runs + 1, last_events = @Events, last_requests = @Requests, last_failed = @Failed,
                                 last_summary = CASE WHEN @Events > 0 OR @Requests > 0 OR @Failed > 0 THEN @Summary ELSE t.last_summary END
    WHEN NOT MATCHED THEN INSERT (id, last_run_utc, last_work_utc, runs, last_events, last_requests, last_failed, last_summary)
                          VALUES (1, @now, CASE WHEN @Events > 0 OR @Requests > 0 THEN @now END, 1, @Events, @Requests, @Failed, @Summary);
    IF @Failed > 0
        INSERT cro.audit_log (actor, action, outcome, detail) VALUES (N'system', 'sync_run', 'error', LEFT(@Summary, 4000));
END
GO

/* ------------------------------------------------------------------ monitoring */
CREATE OR ALTER PROCEDURE cro_api.monitor_status
AS
BEGIN
    SET NOCOUNT ON;
    SELECT h.last_run_utc, h.last_work_utc, h.runs, h.last_events, h.last_requests, h.last_failed, h.last_summary,
           DATEDIFF(SECOND, h.last_run_utc, SYSUTCDATETIME()) AS seconds_since_run,
           (SELECT COUNT(*) FROM cro.webhook_event WHERE processed_utc IS NULL)                         AS webhooks_pending,
           (SELECT COUNT(*) FROM cro.webhook_event WHERE received_utc > DATEADD(HOUR, -24, SYSUTCDATETIME())) AS webhooks_24h,
           (SELECT COUNT(*) FROM cro.webhook_event WHERE signature_valid = 0
                                                   AND received_utc > DATEADD(DAY, -7, SYSUTCDATETIME())) AS bad_signatures_7d,
           (SELECT MAX(received_utc) FROM cro.webhook_event WHERE signature_valid = 1)                  AS last_valid_webhook_utc,
           (SELECT COUNT(*) FROM cro.signing_request WHERE state = 'failed')                            AS failed_requests,
           (SELECT COUNT(*) FROM cro.signing_request WHERE state = 'completed' AND outputs_retrieved_utc IS NULL) AS outputs_missing
    FROM (SELECT 1 AS x) d LEFT JOIN cro.sync_heartbeat h ON h.id = 1;
END
GO

CREATE OR ALTER PROCEDURE cro_api.webhook_recent
    @Max INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    IF @Max NOT BETWEEN 1 AND 500 SET @Max = 50;
    SELECT TOP (@Max) e.event_id, e.received_utc, e.event_name, e.actor, e.event_utc, e.document_id, e.request_id,
           s.title, e.signature_valid, e.processed_utc, e.process_result
    FROM cro.webhook_event e
    LEFT JOIN cro.signing_request s ON s.request_id = e.request_id
    ORDER BY e.event_id DESC;
END
GO

/* ------------------------------------------------------------------ dashboard */
/* Requests visible to the caller */
CREATE OR ALTER FUNCTION cro.visible_requests (@Scope VARCHAR(10), @ResourceId CHAR(32), @Email NVARCHAR(254))
RETURNS TABLE
AS RETURN
    SELECT s.request_id
    FROM cro.signing_request s
    WHERE @Scope = 'all'
       OR s.created_by_resource_id = @ResourceId
       OR (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM cro.recipient r WHERE r.request_id = s.request_id AND r.email = @Email));
GO

/* Home counters + status breakdown (two result sets) */
CREATE OR ALTER PROCEDURE cro_api.dashboard_overview
    @Scope        VARCHAR(10)   = 'mine',
    @ResourceId   CHAR(32),
    @Email        NVARCHAR(254) = NULL,
    @DeadlineDays INT           = 3
AS
BEGIN
    SET NOCOUNT ON;
    SET @Email = LOWER(@Email);
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
    SELECT
        /* waiting on me: I am a recipient whose turn it is */
        (SELECT COUNT(DISTINCT r.request_id) FROM cro.recipient r JOIN cro.signing_request s ON s.request_id = r.request_id
          WHERE @Email IS NOT NULL AND r.email = @Email AND r.status = 'waiting' AND s.state = 'inprogress')            AS assigned_to_me,
        /* I sent it and it is with someone else */
        (SELECT COUNT(*) FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
          WHERE s.state = 'inprogress' AND (@Scope = 'all' OR s.created_by_resource_id = @ResourceId))                 AS waiting_for_others,
        (SELECT COUNT(*) FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
          WHERE s.state = 'completed')                                                                                 AS completed,
        (SELECT COUNT(*) FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
          WHERE s.state = 'inprogress' AND s.valid_until_utc IS NOT NULL AND s.valid_until_utc < DATEADD(DAY, @DeadlineDays, @now)) AS approaching_deadline,
        (SELECT COUNT(*) FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
          WHERE s.state IN ('rejected','expired','cancelled','failed'))                                                AS needs_attention;

    SELECT s.state, COUNT(*) AS requests
    FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
    GROUP BY s.state;
END
GO

/* Reports: volume per day, turnaround and success, placement mix (three result sets) */
CREATE OR ALTER PROCEDURE cro_api.dashboard_reports
    @Scope      VARCHAR(10)   = 'mine',
    @ResourceId CHAR(32),
    @Email      NVARCHAR(254) = NULL,
    @Days       INT           = 30
AS
BEGIN
    SET NOCOUNT ON;
    SET @Email = LOWER(@Email);
    IF @Days NOT BETWEEN 1 AND 366 SET @Days = 30;
    DECLARE @from DATE = DATEADD(DAY, -@Days + 1, CAST(SYSUTCDATETIME() AS DATE));

    ;WITH d AS (SELECT @from AS day UNION ALL SELECT DATEADD(DAY, 1, day) FROM d WHERE day < CAST(SYSUTCDATETIME() AS DATE)),
          v AS (SELECT s.* FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) x ON x.request_id = s.request_id)
    SELECT d.day,
           (SELECT COUNT(*) FROM v WHERE CAST(v.sent_utc AS DATE) = d.day)                                      AS sent,
           (SELECT COUNT(*) FROM v WHERE CAST(v.completed_utc AS DATE) = d.day AND v.state = 'completed')       AS completed,
           (SELECT COUNT(*) FROM v WHERE CAST(v.completed_utc AS DATE) = d.day AND v.state <> 'completed')      AS not_completed
    FROM d ORDER BY d.day
    OPTION (MAXRECURSION 400);

    SELECT COUNT(*)                                                                       AS finished,
           SUM(CASE WHEN s.state = 'completed' THEN 1 ELSE 0 END)                          AS completed,
           SUM(CASE WHEN s.state = 'rejected' THEN 1 ELSE 0 END)                           AS rejected,
           SUM(CASE WHEN s.state = 'expired' THEN 1 ELSE 0 END)                            AS expired,
           SUM(CASE WHEN s.state = 'cancelled' THEN 1 ELSE 0 END)                          AS cancelled,
           AVG(CASE WHEN s.state = 'completed' THEN CAST(DATEDIFF(MINUTE, s.sent_utc, s.completed_utc) AS FLOAT) END) AS avg_minutes_to_complete,
           MIN(CASE WHEN s.state = 'completed' THEN DATEDIFF(MINUTE, s.sent_utc, s.completed_utc) END)                 AS min_minutes_to_complete,
           MAX(CASE WHEN s.state = 'completed' THEN DATEDIFF(MINUTE, s.sent_utc, s.completed_utc) END)                 AS max_minutes_to_complete
    FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
    WHERE s.completed_utc >= @from;

    SELECT ISNULL(s.placement_used, s.placement) AS placement, COUNT(*) AS requests
    FROM cro.signing_request s JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = s.request_id
    WHERE s.created_utc >= @from
    GROUP BY ISNULL(s.placement_used, s.placement);
END
GO

/* Recent activity: human-readable lines from the audit log and webhook events */
CREATE OR ALTER PROCEDURE cro_api.dashboard_activity
    @Scope      VARCHAR(10)   = 'mine',
    @ResourceId CHAR(32),
    @Email      NVARCHAR(254) = NULL,
    @Max        INT           = 20
AS
BEGIN
    SET NOCOUNT ON;
    SET @Email = LOWER(@Email);
    IF @Max NOT BETWEEN 1 AND 200 SET @Max = 20;
    SELECT TOP (@Max) x.at_utc, x.request_id, s.request_ref, s.title, x.what, x.who
    FROM (
        SELECT a.at_utc, a.request_id,
               CASE a.action WHEN 'request_create' THEN 'created'
                             WHEN 'request_sent' THEN 'sent for signature'
                             WHEN 'state_completed' THEN 'was completed'
                             WHEN 'state_rejected' THEN 'was rejected'
                             WHEN 'state_expired' THEN 'expired'
                             WHEN 'state_cancelled' THEN 'was cancelled'
                             WHEN 'state_failed' THEN 'failed'
                             WHEN 'outputs_retrieved' THEN 'signed copy stored'
                             WHEN 'output_view' THEN 'downloaded'
                             ELSE a.action END AS what,
               a.actor AS who
        FROM cro.audit_log a
        WHERE a.request_id IS NOT NULL AND a.outcome = 'ok'
          AND a.action IN ('request_create','request_sent','state_completed','state_rejected','state_expired','state_cancelled','state_failed','outputs_retrieved','output_view')
        UNION ALL
        SELECT e.received_utc, e.request_id,
               CASE e.event_name WHEN 'documentSigned' THEN 'signed'
                                 WHEN 'signRejected' THEN 'rejected'
                                 WHEN 'signDelegated' THEN 'delegated'
                                 WHEN 'signRequest' THEN 'signature requested'
                                 WHEN 'documentCompleted' THEN 'completed in Circularo'
                                 WHEN 'signExpired' THEN 'expired in Circularo'
                                 WHEN 'signCancelled' THEN 'cancelled in Circularo'
                                 ELSE e.event_name END,
               e.actor
        FROM cro.webhook_event e
        WHERE e.request_id IS NOT NULL AND e.signature_valid = 1
          AND e.event_name IN ('documentSigned','signRejected','signDelegated','documentCompleted','signExpired','signCancelled')
    ) x
    JOIN cro.signing_request s ON s.request_id = x.request_id
    JOIN cro.visible_requests(@Scope, @ResourceId, @Email) v ON v.request_id = x.request_id
    ORDER BY x.at_utc DESC;
END
GO

/* Function permissions: cro_app uses it only through the procedures (ownership chaining). */
DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
WHERE s.name = N'cro_api' AND p.name IN (N'sync_heartbeat', N'monitor_status', N'webhook_recent', N'dashboard_overview', N'dashboard_reports', N'dashboard_activity');
PRINT N'Dashboard procedures present: ' + CAST(@n AS NVARCHAR(10)) + N'/6, heartbeat table: '
    + CASE WHEN OBJECT_ID(N'cro.sync_heartbeat', N'U') IS NULL THEN N'no' ELSE N'yes' END;
GO
