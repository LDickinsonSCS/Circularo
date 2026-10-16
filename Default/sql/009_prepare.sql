/*
  009_prepare.sql  –  CRO (TotalAgility x Circularo)
  Ad hoc option "Circularo editor": the sender places fields and picks recipients in Circularo's own editor,
  then CRO imports the recipients Circularo created. Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 009_prepare.sql
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'009_prepare.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

/* Replace the recipients of a prepared request with the shares found in Circularo and mark it sent.
   @Json: [{ "order":1, "kind":"internal|external", "email":"", "fullName":"", "purpose":"sign", "shareId":"", "shareTo":"" }] */
CREATE OR ALTER PROCEDURE cro_api.request_import_recipients
    @RequestId BIGINT,
    @Json      NVARCHAR(MAX),
    @Actor     NVARCHAR(200) = N'system'
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF ISJSON(@Json) <> 1 THROW 50040, N'Recipients are not valid JSON.', 1;
    IF NOT EXISTS (SELECT 1 FROM cro.signing_request WHERE request_id = @RequestId AND state = 'sending')
        THROW 50041, N'Request not found or not waiting for the sender.', 1;

    DECLARE @r TABLE (sign_order INT, kind VARCHAR(10), email NVARCHAR(254), full_name NVARCHAR(200), share_purpose VARCHAR(10),
                      share_id VARCHAR(128), share_to NVARCHAR(254));
    INSERT @r
    SELECT ISNULL(TRY_CAST(JSON_VALUE(v.value, '$.order') AS INT), 1),
           CASE WHEN LOWER(JSON_VALUE(v.value, '$.kind')) = 'internal' THEN 'internal' ELSE 'external' END,
           LOWER(LTRIM(RTRIM(JSON_VALUE(v.value, '$.email')))),
           JSON_VALUE(v.value, '$.fullName'),
           CASE WHEN LOWER(JSON_VALUE(v.value, '$.purpose')) IN ('sign','approve','accept','review','view')
                THEN LOWER(JSON_VALUE(v.value, '$.purpose')) ELSE 'sign' END,
           JSON_VALUE(v.value, '$.shareId'),
           JSON_VALUE(v.value, '$.shareTo')
    FROM OPENJSON(@Json) v;
    IF NOT EXISTS (SELECT 1 FROM @r) THROW 50042, N'No recipients to import.', 1;

    BEGIN TRAN;
    DELETE FROM cro.recipient WHERE request_id = @RequestId;
    INSERT cro.recipient (request_id, sign_order, kind, email, full_name, share_to, internal_mode, share_purpose, protection, share_id, status)
    SELECT @RequestId, sign_order, kind, ISNULL(NULLIF(email, N''), share_to), full_name, share_to,
           CASE WHEN kind = 'internal' THEN 'circularo_login' END, share_purpose,
           CASE WHEN kind = 'internal' THEN 'none' ELSE 'email_otp' END, share_id, 'waiting'
    FROM @r;
    UPDATE cro.signing_request
       SET state = 'inprogress', sent_utc = SYSUTCDATETIME(), state_reason = NULL,
           sequential = CASE WHEN (SELECT COUNT(DISTINCT sign_order) FROM @r) > 1 THEN 1 ELSE 0 END
     WHERE request_id = @RequestId;
    INSERT cro.audit_log (actor, action, outcome, request_id, detail)
    VALUES (@Actor, 'request_sent', 'ok', @RequestId, N'Sent from the Circularo editor; recipients imported: ' + CAST((SELECT COUNT(*) FROM @r) AS NVARCHAR(10)));
    COMMIT;
END
GO

PRINT N'request_import_recipients present: ' + CASE WHEN OBJECT_ID(N'cro_api.request_import_recipients', N'P') IS NULL THEN N'no' ELSE N'yes' END;
GO
