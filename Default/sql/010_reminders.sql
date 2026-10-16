/*
  010_reminders.sql  –  CRO (TotalAgility x Circularo)
  Reminders sent by TotalAgility (email with the link to the signing page) instead of Circularo. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 010_reminders.sql
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'010_reminders.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

IF COL_LENGTH(N'cro.recipient', N'reminder_count') IS NULL
    ALTER TABLE cro.recipient ADD reminder_count INT NOT NULL CONSTRAINT df_rcp_remcount DEFAULT (0);
IF COL_LENGTH(N'cro.recipient', N'last_reminded_utc') IS NULL
    ALTER TABLE cro.recipient ADD last_reminded_utc DATETIME2(3) NULL;
IF COL_LENGTH(N'cro.recipient', N'waiting_since_utc') IS NULL
    ALTER TABLE cro.recipient ADD waiting_since_utc DATETIME2(3) NULL;   -- when it became this recipient's turn (set by CRO)
GO

/* Waiting recipients due a reminder: first one @FirstAfterHours after it became their turn (or after sending),
   then every @EveryHours, at most @Max in total. */
CREATE OR ALTER PROCEDURE cro_api.reminders_due
    @FirstAfterHours INT = 48,
    @EveryHours      INT = 48,
    @Max             INT = 5,
    @Batch           INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (@Batch) r.recipient_id, r.request_id, r.email, r.full_name, r.kind, r.internal_mode, r.share_id, r.share_to,
           r.share_purpose, r.reminder_count, r.last_reminded_utc, s.title, s.valid_until_utc, s.created_by_name, s.circularo_document_id, s.document_type
    FROM cro.recipient r
    JOIN cro.signing_request s ON s.request_id = r.request_id
    WHERE s.state = 'inprogress' AND r.status = 'waiting' AND r.share_id IS NOT NULL
      AND r.reminder_count < @Max
      AND (s.valid_until_utc IS NULL OR s.valid_until_utc > @now)
      AND ((r.last_reminded_utc IS NULL AND COALESCE(r.waiting_since_utc, s.sent_utc) < DATEADD(HOUR, -@FirstAfterHours, @now))
        OR (r.last_reminded_utc IS NOT NULL AND r.last_reminded_utc < DATEADD(HOUR, -@EveryHours, @now)))
    ORDER BY COALESCE(r.last_reminded_utc, r.waiting_since_utc, s.sent_utc);
END
GO

CREATE OR ALTER PROCEDURE cro_api.reminder_mark
    @RecipientId BIGINT,
    @Outcome     VARCHAR(10) = 'ok',
    @Detail      NVARCHAR(2000) = NULL,
    @Actor       NVARCHAR(200) = N'system'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @req BIGINT = (SELECT request_id FROM cro.recipient WHERE recipient_id = @RecipientId);
    IF @Outcome = 'ok'
        UPDATE cro.recipient SET reminder_count = reminder_count + 1, last_reminded_utc = SYSUTCDATETIME() WHERE recipient_id = @RecipientId;
    INSERT cro.audit_log (actor, action, outcome, request_id, detail)
    VALUES (@Actor, 'reminder_sent', CASE WHEN @Outcome IN ('ok','refused','error') THEN @Outcome ELSE 'error' END, @req, @Detail);
END
GO

/* Keep waiting_since_utc current: called after each status refresh */
CREATE OR ALTER PROCEDURE cro_api.recipients_turn_mark
    @RequestId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE cro.recipient SET waiting_since_utc = SYSUTCDATETIME()
     WHERE request_id = @RequestId AND status = 'waiting' AND waiting_since_utc IS NULL;
    UPDATE cro.recipient SET waiting_since_utc = NULL
     WHERE request_id = @RequestId AND status <> 'waiting' AND waiting_since_utc IS NOT NULL;
END
GO

DECLARE @n INT;
SELECT @n = COUNT(*) FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
WHERE s.name = N'cro_api' AND p.name IN (N'reminders_due', N'reminder_mark', N'recipients_turn_mark');
PRINT N'Reminder procedures present: ' + CAST(@n AS NVARCHAR(10)) + N'/3, columns: '
    + CASE WHEN COL_LENGTH(N'cro.recipient', N'waiting_since_utc') IS NULL THEN N'missing' ELSE N'ok' END;
GO
