/*
  003a_option_columns.sql  –  CRO (TotalAgility x Circularo)
  Adds the option columns that the revised 003 defines, to tables created by the first
  version of 003 (CREATE ... IF missing never alters an existing table). Idempotent.
    sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 003a_option_columns.sql
  Then re-run 004_procedures.sql.
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'Circularo'
BEGIN
    RAISERROR(N'003a_option_columns.sql must be run in the Circularo database (use -d Circularo).', 16, 1);
    RETURN;
END
GO

/* signing_request */
IF COL_LENGTH(N'cro.signing_request', N'placement') IS NULL
    ALTER TABLE cro.signing_request ADD placement VARCHAR(20) NOT NULL CONSTRAINT df_sr_placement DEFAULT ('anchors');
IF COL_LENGTH(N'cro.signing_request', N'adhoc_option') IS NULL
    ALTER TABLE cro.signing_request ADD adhoc_option VARCHAR(20) NULL;
IF COL_LENGTH(N'cro.signing_request', N'placement_used') IS NULL
    ALTER TABLE cro.signing_request ADD placement_used VARCHAR(20) NULL;
GO
IF OBJECT_ID(N'cro.ck_sr_placement', N'C') IS NULL
    ALTER TABLE cro.signing_request ADD CONSTRAINT ck_sr_placement
        CHECK (placement IN ('anchors','coordinates','template','word_template','detect','adhoc'));
IF OBJECT_ID(N'cro.ck_sr_adhoc', N'C') IS NULL
    ALTER TABLE cro.signing_request ADD CONSTRAINT ck_sr_adhoc
        CHECK (adhoc_option IS NULL OR adhoc_option IN ('default_position','circularo_editor','tta_placer','detect','tokens'));
GO

/* recipient */
IF COL_LENGTH(N'cro.recipient', N'share_to') IS NULL
    ALTER TABLE cro.recipient ADD share_to NVARCHAR(254) NULL;
IF COL_LENGTH(N'cro.recipient', N'internal_mode') IS NULL
    ALTER TABLE cro.recipient ADD internal_mode VARCHAR(20) NULL;
GO
IF OBJECT_ID(N'cro.ck_rcp_mode', N'C') IS NULL
    ALTER TABLE cro.recipient ADD CONSTRAINT ck_rcp_mode
        CHECK (internal_mode IS NULL OR internal_mode IN ('circularo_login','as_external','saml'));
GO

/* protection: first version lacked 'oauth' – replace the check if it does not allow it */
DECLARE @def NVARCHAR(MAX);
SELECT @def = cc.[definition] FROM sys.check_constraints AS cc WHERE cc.name = N'ck_rcp_prot' AND cc.parent_object_id = OBJECT_ID(N'cro.recipient');
IF @def IS NULL OR @def NOT LIKE N'%oauth%'
BEGIN
    IF @def IS NOT NULL ALTER TABLE cro.recipient DROP CONSTRAINT ck_rcp_prot;
    ALTER TABLE cro.recipient ADD CONSTRAINT ck_rcp_prot
        CHECK (protection IN ('none','email_otp','sms_otp','password','oauth'));
    PRINT N'ck_rcp_prot now allows oauth.';
END
GO

/* check */
DECLARE @missing NVARCHAR(400) = N'';
IF COL_LENGTH(N'cro.signing_request', N'placement') IS NULL      SET @missing += N' signing_request.placement';
IF COL_LENGTH(N'cro.signing_request', N'adhoc_option') IS NULL   SET @missing += N' signing_request.adhoc_option';
IF COL_LENGTH(N'cro.signing_request', N'placement_used') IS NULL SET @missing += N' signing_request.placement_used';
IF COL_LENGTH(N'cro.recipient', N'share_to') IS NULL             SET @missing += N' recipient.share_to';
IF COL_LENGTH(N'cro.recipient', N'internal_mode') IS NULL        SET @missing += N' recipient.internal_mode';
PRINT CASE WHEN @missing = N'' THEN N'All option columns present.' ELSE N'STILL MISSING:' + @missing END;
GO
