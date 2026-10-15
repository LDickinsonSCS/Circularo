# CRO – TotalAgility × Circularo e-signing: build notes

Prefix: **CRO** (TTA groups, server variables, forms, processes, SQL schema `cro` / `cro_api`, role `cro_app`).
Started: 2026-10-15.

## Reference docs (check first on every request)
- Circularo functionality: https://help.circularo.com/en
- Circularo API 26.1.0 reference: https://www.circularo.com/api/full/26.1.0/#description/introduction (JS-rendered; full OpenAPI JSON at https://circularo.com/api/full/26.1.0/OpenApi3.json)
- Circularo developer guide (worked examples): https://developers.circularo.com/latest
- Capability review: `claude/cro-circularo-capabilities.md` (repo `Default/docs/circularo-capabilities.md`)
- Design: `claude/cro-design.md` (repo `Default/docs/cro-design.md`)

## Environment
| Item | Value |
|---|---|
| TTA Designer | https://portal.sudocodesolutions.com/TotalAgility/designer (Leigh signs in; Claude drives via the built-in browser pane) |
| TTA version | Not exposed by the SDK; assumed 2026.3 (same server as the Information Rights build) – confirm |
| TTA category | `Circularo`, Id `AC841F4F5B6B4EBE8A75298867985488` – empty at start (2026-10-15). Claude may build, edit and release anything in it. |
| TTA service account | `scs-admin` (Windows; SQL access via role `cro_app`) |
| Circularo sandbox | https://sudocode.sandbox.circularo.com – API `…/api/v1`, `GET /ping` → `pong` (verified 2026-10-15). Webhooks enabled. |
| Circularo service account | support@sudocodesolutions.com (API key owner; must be org admin) |
| SQL | Database `Circularo` (SQL Express on the TTA server, demo) |
| Git | github.com/LDickinsonSCS/Circularo, project folder `Default/` (sql/, docs/) |

## Settled
- Prefix CRO; category Circularo; approval to build/edit/release in that category.
- Standard TTA pattern: CRO_CONFIG + CRO_UI_JS server variables, thin-shell forms, synchronous `CRO API` process, C# script nodes (tta-project-conventions, tta-forms-ui).
- SQL is the system of record (database `Circularo`).
- Signers: internal and external. UAE PASS deferred.
- Auth: API key under the service account, held in a TTA **secure** server variable, used server-side only (it travels as `?token=`).
- 2026-10-15: TTA is master for users – TTA creates/updates/suspends Circularo users.
- 2026-10-15: Signing from inside TTA forms as well as via Circularo emails.
- 2026-10-15: Field placement by anchor text; layouts per document type in CRO_CONFIG.
- 2026-10-15: External protection = email code (OTP) by default.
- 2026-10-15: Completion = webhooks (enabled on sandbox) as trigger + status polling as safety net (Circularo documents no webhook retry).

- 2026-10-15: **First integration – keep every option available for testing**; defaults in CRO_CONFIG, overridable per request/recipient.
- 2026-10-15: Production will mostly be **ad hoc documents** – ad hoc placement options A–E in the design (default position, Circularo editor, TTA placement page, field detection, typed tokens), with fallback when anchors find nothing.
- 2026-10-15: portal.sudocodesolutions.com is reachable from the web → webhook receiver on IIS there.
- 2026-10-15: Internal signing modes all built: Circularo login / as external with email code / SAML.

## Open decisions
1. Default internal signing mode after testing.
2. Ask Circularo: framing for portal.sudocodesolutions.com, webhook retries, SAML on sandbox.
3. Webhook registration (needs Leigh's go-ahead once the receiver is live).

## Sandbox findings (2026-10-15, read-only checks as support@)
- Org admin rights incl. manage_users, add_users, use_webhooks, view_api_keys, view_logs, seal_document.
- Protection rights: email OTP, password, OAuth. **No SMS OTP, KYC, TSA, custom fields.**
- Definitions: `d_default` only; workflow `wf_archive` (initialized → created).
- Settings: external sharing on; parallel default, changeable; same user in several steps off; provider internal; default rights print + rejectWithoutComment; detectSignFields off; upload 40 MB.
- Usernames may differ from email (`…@sudocodesolutions.com.1`).
- `X-Frame-Options: SAMEORIGIN` → no iframe; signing opens in new tab/pop-up.
- One API key "TTA-SCSDEMO-GENERIC" exists (created 2026-10-15 15:58 UTC); no webhooks registered; 3 users.

## Samples (Default/samples)
12 synthetic documents (9 PDF, 3 Word) + `out/manifest.json` (recipients, anchors, offsets) and a test matrix in `samples/README.md`. Anchor hits and predicted field boxes verified by rendering; dynamic Word template fields verified as whitespace-free JSON.

## Circularo API – key facts (detail in capability review)
- Auth: API key `POST /api/key {description}` → `{id}` (10 years, user's rights) or `POST /login`. `?token=` query parameter; no Bearer header.
- Upload `POST /files/saveFile` (multipart, optional `signatureAnchors`) → hash, anchorPositions.
- Create `POST /documents {body:{documentType, documentTitle, pdfFile:{content}, customFields}, definitionType:"ext", workflow:"wf_archive", optionalData}` → documentId.
- Send `POST /share {objectType, type, id, data[], signatureFields[], sequential, useTsa}` → shareIds.
- Status `GET /documents/{id}` → `workflow.shareStateName` (inprogress/completed/rejected/expired/cancelled), `waitingFor`.
- Signed PDF: re-read, then `GET /files/loadFile/hash/{hash}`. Audit `GET /documents/{id}/audit` (`?cof=true` = Certificate of Fulfillment).
- Cancel `PUT /share/disable {shareIds}` (cancels the whole process). Reminder `POST /share/reminder`.
- Webhooks `POST/GET/DELETE /webhooks`, HMAC `x-circularo-signature`.
- 26.1 errors `{status, type:"NAMESPACE:CODE", message, requestId}`.

## SQL scripts (Default/sql)
| Script | Purpose | Run (from Default/sql) | Status |
|---|---|---|---|
| 000_create_database.sql | Create DB `Circularo` | `sqlcmd -S .\SQLEXPRESS -E -d master -b -I -i 000_create_database.sql` | run 2026-10-15 (Leigh) |
| 001_schemas.sql | Schemas `cro`, `cro_api`, role `cro_app` | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 001_schemas.sql` | run 2026-10-15 (Leigh) |
| 002_service_login.sql | Login/user for `scs-admin` → `cro_app` (tries domain then machine name; `@override` if needed) | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 002_service_login.sql` | run 2026-10-15 (Leigh) |
| 003_core_tables.sql | `circularo_user`, `signing_request` (incl. placement/adhoc options), `recipient` (incl. internal mode, share_to, oauth), `webhook_event`, append-only `audit_log` |
| 003a_option_columns.sql | Adds placement/adhoc_option/placement_used, share_to/internal_mode, oauth protection to tables made by the first 003 | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 003a_option_columns.sql` | run 2026-10-15 (Leigh) |
| 004_procedures.sql | 16 `cro_api` procedures (health, audit, request create/get/list/set_document/set_shares/set_state/outputs_done/due_check, webhook receive/next/done, user list/upsert/set_circularo); raises compat level to 130 if needed. Parsed clean with sqlfluff (tsql). | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 004_procedures.sql` | run 2026-10-15 (Leigh) |
| 005_secrets.sql | `cro.secret` (DPAPI ciphertext, fingerprint) + `secret_set/get/status` | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 005_secrets.sql` | written, not yet run | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 003_core_tables.sql` | run 2026-10-15 (Leigh) |

## Live TTA items (category Circularo)
| Item | Id | Version | Local source | SHA-256 of live content |
|---|---|---|---|---|
| `CRO_CONFIG` (text server variable) | `CRO_CONFIG` | config v2 (adds `admins`) | `Default/tta/CRO_CONFIG.min.json` (pretty: `CRO_CONFIG.json`) | `605e18026849248f0e0eec8f26679c5d99190be650cc8f1de2574cd64c413452` |
| `CRO_API_KEY` (secure server variable) | `CRO_API_KEY` | – | entry point only: Leigh enters a key, `key_migrate` encrypts it into `cro.secret`, then the variable is blanked | – |
| `CRO API` (sync process) | `66799B626B1B411EB6FFFA0D0EF5270C` | 5 (released) | `Default/tta/scripts/cro_api.cs` (cro-api 0.2.0) | `f9863c4abf6ed4a1b21ab9ae99a60b8ef2012e1315ead2c29cf32c4c5e6db8c7` |

`CRO API` ops so far: version, whoami, health, config, circularo_ping, circularo_check, key_migrate*, key_status*, keycheck*, request_create, request_get, request_list, user_list (* = admins in CRO_CONFIG.admins only). Inputs OP, ARGS, SESSIONTOKEN, SPP_SYSTEM_SESSION_ID, CRO_CONFIG, AWF_JOBID; outputs RESULT, ERROR, DEBUG. Local compile check: `mcs -langversion:5` against `scripts/stubs/tta_stubs.cs`.

## Decisions & gotchas log
- 2026-10-15: **Key handling decided (Leigh): DPAPI.** The Circularo key is encrypted on the TTA server with DPAPI LocalMachine scope + CRO entropy and stored in `cro.secret`; `CRO_API_KEY` is only the entry point and is blanked after `key_migrate`. Machine scope because sync jobs (web app pool) and async jobs (Core Worker) may run as different identities. Rotation: enter new key in CRO_API_KEY → run key_migrate (admin) → check fingerprint → blank the variable.
- 2026-10-15: 004 first run failed – tables came from the first 003 (no option columns) and 003 never alters existing tables. Fixed with 003a. Rule: any later column change gets its own lettered script.
- 2026-10-15: **Security finding – secure server variables are readable through the client SDK.** A Designer browser session calling `ClientService.GetServerVariableValue('CRO_API_KEY')` got the full 64-char value; only the variable *list* blanks it. Not yet tested with a non-admin forms user. Mitigation proposed: encrypt the key server-side (DPAPI as scs-admin) so the stored value is useless off the server. Applies equally to DP project secrets.
- 2026-10-15: Server-side, C# reads the key with `TotalAgility.Sdk.ClientService.GetServerVariableValue(systemSession, "CRO_API_KEY")`, so CRO processes need **no secure input mapping** and Claude can keep saving them.
- 2026-10-15: Verified live from TTA: SQL connection to `Circularo` as the TTA service works (004 procs not yet present); Circularo `/ping` → 200; `/login?token=<key>` → logged True as support@sudocodesolutions.com, tenant `sandbox`.
- TTA SDK: `AddServerVariable` needs a `Grouping` object (`{Identity:{Id:'4FEE4E069417475DAC5D2C2E5C95CA49'},Category:{Id:'201F370CA5164F76ADDD8EEEFF666AF7'}}` = Default Data Grouping); `Grouping:null` gives a null-reference 500.
- TTA SDK: `ProcessService.CreateProcessBasedOnExisting {baseProcessIdentity, processName}` returns null and puts the copy in the **base process's category**; set `Data.Category` before the first save.
- TTA SDK: `CreateJobSync` `ReturnedVariables` carry no Id – read them by position in the order of `variablesToReturn`.
- TTA SDK: writes from the Designer also send `CSRFDesignerToken` (cookie) and `DesignerMode` headers; added to the helper, though the server-variable failure turned out to be the Grouping.
- TTA stores JSON exactly as sent; the live config is the `JSON.stringify` form (e.g. `0.0` → `0`), so hash the minified copy.
- 2026-10-15: Prefix CRO agreed.
- 2026-10-15: Category, sandbox, SQL DB, signer scope agreed.
- 2026-10-15: Users, embedded signing, anchors, email OTP, webhooks+polling agreed (see Settled).
- TTA SDK: `CategoryService.GetCategories` needs `categoryFilter:{ParentCategory:{Id:'',Name:''},CategoryLevel:0,CheckAccess:true,CheckChildren:true}` – `ParentCategory:null` gives a null-reference 500.
- TTA SDK: no version method found (ServerService.GetVersion etc. 404).
- Circularo docs conflict on token lifetime and `/share/reminder` body – verify on sandbox.
- Webhook payload only says what happened; always re-read the document from Circularo before acting.
- GitHub repo moved to `LDickinsonSCS/Circularo` (capital C); remote updated.

## Verified
- 2026-10-15 21:07: `health` → DB Circularo, login SCSDEMO\scs-admin, SQL Server 2022 Express (16.0.1000.6), compat 160, 6 cro tables, 19 cro_api procs.
- 2026-10-15 21:07: `key_migrate` → stored, fingerprint `dd7ce17399420cba`, length 64, machine SCSDEMO. `circularo_check` authenticates from the encrypted store (no fallback). `CRO_API_KEY` then blanked via SDK; client read returns length 0; `circularo_check` still OK.
- **Note:** SCSDEMO\scs-admin is **sysadmin** (maps to dbo), so the `cro_app` restriction is not in force on the demo server. Production needs a low-privilege service account.
- 2026-10-15: Circularo sandbox `/api/v1/ping` → pong.
- 2026-10-15: TTA Designer session valid (Leigh Dickinson); Circularo category exists and is empty.
