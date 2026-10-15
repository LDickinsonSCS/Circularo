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
| 004_procedures.sql | 16 `cro_api` procedures (health, audit, request create/get/list/set_document/set_shares/set_state/outputs_done/due_check, webhook receive/next/done, user list/upsert/set_circularo); raises compat level to 130 if needed. Parsed clean with sqlfluff (tsql). | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 004_procedures.sql` | run 2026-10-15 (Leigh), re-run 21:27 with the acted_utc fix |
| 006_outputs.sql | `cro.output_file` (signed / audit / certificate PDFs, sha256, has_signature) + `output_save/list/get` | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 006_outputs.sql` | run 2026-10-15 (Leigh) |
| 007_dashboard.sql | `cro.sync_heartbeat`, `cro.visible_requests()`, `sync_heartbeat`, `monitor_status`, `webhook_recent`, `dashboard_overview/reports/activity` | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 007_dashboard.sql` | run 2026-10-15 (Leigh) |
| 008_requests.sql | `request_search` (list filters = dashboard counters), `request_access`, `request_timeline` | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 008_requests.sql` | written, not yet run |
| 005_secrets.sql | `cro.secret` (DPAPI ciphertext, fingerprint) + `secret_set/get/status` | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 005_secrets.sql` | written, not yet run | `sqlcmd -S .\SQLEXPRESS -E -d Circularo -b -I -i 003_core_tables.sql` | run 2026-10-15 (Leigh) |

## Live TTA items (category Circularo)
| Item | Id | Version | Local source | SHA-256 of live content |
|---|---|---|---|---|
| `CRO_CONFIG` (text server variable) | `CRO_CONFIG` | config v3 (admins, receiver URL) | `Default/tta/CRO_CONFIG.min.json` (pretty: `CRO_CONFIG.json`) | `9cdf37a0d2a3252adefc5dd5146e9bd56fae815c45e3c96a1b77489549317b7a` |
| `CRO_API_KEY` (secure server variable) | `CRO_API_KEY` | – | entry point only: Leigh enters a key, `key_migrate` encrypts it into `cro.secret`, then the variable is blanked | – |
| `CRO API` (sync process) | `66799B626B1B411EB6FFFA0D0EF5270C` | released 2026-10-15 with 0.7.0 (was v11) | `Default/tta/scripts/cro_api.cs` (cro-api 0.7.0) | `a2e2b7a2aa3983551fef351e73c45b30cafa99496a44b649c598b133d13554be` (file; live = without final newline) |
| `CRO Sync` (async process) | `444C34DDCB8E4CE3BFC7D553688E92FB` | released 2026-10-15 with 0.7.0 (was v5) | same script as CRO API (cro-api 0.7.0); process variable `CRO_RUNMODE=sync` (not an input) | same as CRO API |
| `CRO_UI_JS` (text server variable) | `CRO_UI_JS` | cro-ui 0.2.2 (shell, nav, dashboard, send) | `Default/tta/CRO_UI_JS.js` | `54e24d1c90a90730d4e15afdd1f1b2acdc4b34ea35149e1e5a4649939ba7bd99` |
| `CRO_Dashboard` (form, thin shell) | `9BEA4B2F0C424E2C80ACFF93591E5793` | 2 (released) | copy of DP_Home: header row + marker `data-cro-page="dashboard"` + loader action `jsCRO` → `CRO_UI_JS` | – |
| `CRO_Send` / `CRO_Requests` / `CRO_Request` / `CRO_Users` (forms) | `05EC778DA27B4D089639CC849D166EB8` / `519EA033DDEB46E5886368CA29BB78E2` / `6E21070706A24F23ACC0B827A137E9E8` / `D76D95A953BC474498AD033D922448C4` | 2 (released) | copies of CRO_Dashboard with their own marker | – |
| Job schedule `CRO Sync - every 2 minutes` | ScheduleId `A67CA440EF924666B53D4ADEC15FCABD` | active | – | – |
| Circularo webhook | `4PSeQKEB_eIBv4MnskB-` (organization) | – | callback `https://portal.sudocodesolutions.com/cro-webhook/receive.ashx`; HMAC secret DPAPI in `cro.secret` (fingerprint `2c8bb95309136469`) | – |
| Webhook receiver (IIS) | app `cro-webhook` on portal | deployed 2026-10-15 (Leigh) | `Default/webhook/receive.ashx`, `web.config`, `README.md` | – |

`CRO API` ops so far: version, whoami, health, config, circularo_ping, circularo_check, key_migrate*, key_status*, keycheck*, request_create, request_get, request_list, request_send, request_refresh, request_outputs, output_list, output_get, dashboard, monitor*, webhook_recent*, sync_now*, webhook_list*, webhook_setup*, webhook_delete*, user_list, me, sign_url, request_cancel (* = admins in CRO_CONFIG.admins only). Inputs OP, ARGS, SESSIONTOKEN, SPP_SYSTEM_SESSION_ID, CRO_CONFIG, AWF_JOBID; outputs RESULT, ERROR, DEBUG. Local compile check: `mcs -langversion:5` against `scripts/stubs/tta_stubs.cs`.

## Decisions & gotchas log
- 2026-10-15: CRO_Requests / CRO_Request written (cro-ui 0.3.0) with cro-api 0.8.0 (`request_search`, `request_detail`; detail allowed for creator, recipient or admin; documents only for creator/admin). Needs 008_requests.sql. Not yet deployed: the browser bridge dropped before the deploy step.
- 2026-10-15: **CRO_Send built and tested**: modes Sign now / We sign / They sign; PDF or DOCX; layout auto-picked from the file name (anchors) or ad hoc (default position; the other ad hoc options shown as "not built yet"); recipients with order, internal/external, purpose, email code / Circularo account / as external. Request 4 (Sign now, 09 anchor edge cases) sent: 3 anchor fields, SIG_AMBIGUOUS extra matches ignored as designed.
- 2026-10-15: TTA renders form HTML controls as **srcdoc iframes**, so `[data-cro-page]` is not in the page DOM. CRO_UI_JS picks the page from the form name (CRO_Send.form → send) and falls back to the iframe srcdoc.
- 2026-10-15: `sign_url` for internal signers returns `<frontend>/#!/sign?documentId=…&documentType=…` (documented pattern). Circularo sends that URL to the document in the folder view for whoever is signed in to Circularo; in the browser pane that is support@, so internal signing must be tested in a browser signed in as the signer. Externals (and internals in `as_external` mode) get `/share?shareToken=` after `GET /share/{shareId}/validate`.
- 2026-10-15: Processes: `GetProcess` → set node `Script` → `LockProcess` → `SaveProcess2 {saveProcessOptions:{IgnoreSaveWarnings:true,Release:true}}` → `UnlockProcess {lockResourceInfo:null, force:true}` (SaveProcess2 leaves the lock).
- 2026-10-15: CRO_Dashboard verified in Workspace (Leigh signed in): counters, donut, volume, success/turnaround, placement mix, activity and integration health all match requests 1–3. Forms need a Workspace session; without one the loader shows "Invalid Session ID".
- 2026-10-15: TTA SDK server variables: list with `GetServerVariables {serverVariablesFilter:{CategoryIdentity:{Id,Name},ServerIdentity:{Id:'',Name:''},SearchText:''}}`; create with `AddServerVariable {variableSummary:{…}}`; **update by taking the summary returned by GetServerVariables**, setting `Value` and `ValueChanged:true` (a hand-built summary gives "Database error occurred"). `GetServerVariable` returns "not found" for these ids.
- 2026-10-15: Forms: `FormService.CopyForm {formIdentity:{Id:<base>,Name:<new>}}` returns the new identity (version 1, locked by caller). Edit, set `FormIdentity.Version=2`, then `SaveForm2 {form, options:{IgnoreSaveWarnings:true,Release:true}}` and `UnlockForm {force:true}` (saving at version 1 gives "same version already exists").
- 2026-10-15: Deploying large text: the GitHub repo is public, so the Designer tab fetches the file from raw.githubusercontent.com pinned to a commit hash, checks SHA-256 before writing, and checks again after reading back.
- 2026-10-15: TTA resource email: server-side `TotalAgility.Sdk.ResourceService.GetResourceSummary(session, ResourceIdentity)` → `EmailAddress` (`GetResource` does not exist).
- 2026-10-15: **Dashboard requested (Leigh)** "along the lines of Circularo's": quick-start tiles (Sign now / We sign / They sign), overview counters, status donut, volume over time, success/turnaround, placement mix, recent activity, and an admin integration-health panel. Scope Mine/All. Design section added.
- 2026-10-15: **TTA strips the final newline of a script on save** – compare hashes of the trimmed text (live CRO API = file minus trailing `\n`).
- 2026-10-15: `CreateProcessBasedOnExisting` copies the **released** version of the base; set the node script explicitly on the copy.
- 2026-10-15: CRO Sync = same script as CRO API in an async process with process variable `CRO_RUNMODE=sync`, which is **not** in `Data.InputVariables`, so no caller can switch CRO API into sync mode.
- 2026-10-15: Webhook create as org admin works with `type:"organization"`; `GET /webhooks` returns `hmacSecret` in clear (masked by `webhook_list`).
- 2026-10-15: Job schedules: `ServerService.AddJobSchedule {jobSchedule}` – copy an existing schedule's shape (`TimeSpanInMinutes`, `OneActiveAtTime`, `StartByDate` as `/Date(ms+0400)/`).
- 2026-10-15: **Circularo resolves an email that belongs to an internal user to that user** (ldickinson@… → `ldickinson@sudocodesolutions.com.1`, type internal), even when shared as external with OTP. Status must be matched by **shareId** (present in `workflow.waitingFor[]`), never by username – fixed in cro-api 0.3.1 after the first refresh wrongly showed "signed".
- 2026-10-15: `request_set_state` now clears `recipient.acted_utc` when a status goes back to waiting/pending (fix in 004; re-run 004).
- 2026-10-15: `POST /documents` returned the id under `id`; folder path `TTA/CRO` auto-created. `signatureAnchors` sent as a JSON string multipart field works. Date annotations are off by default (`defaults.annotations` absent) until the annotation field format is verified.
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
- 2026-10-15 22:49: Dashboard data checked against requests 1–3: completed 3; success 3/3, avg 6.7 min (3–9); placement anchors 2 / default_position 1; activity feed and webhook list (5 events incl. the bad-signature self-test, ignored) correct. Caller email resolved via `ResourceService.GetResourceSummary` → `EmailAddress`. Heartbeat recorded by manual and scheduled CRO Sync runs.
- 2026-10-15 22:37–22:38: **Fully automatic completion.** Leigh signed request 3 → Circularo events arrived (valid HMAC) → scheduled CRO Sync at 18:37:58Z marked it completed, recipient signed, and stored outputs by 18:38:04Z (signed 71,792 bytes with signature; audit; certificate). No manual calls.
- 2026-10-15 22:34: Receiver live: GET → `{"service":"cro-webhook","ok":true}`; POST with a bad signature → 200 (stored, flagged invalid).
- 2026-10-15 22:34–22:36: **Webhook chain proven.** Request 3 (NDA, doc `52dfd1f7-e99a-44d8-b7cc-9ac74c6e7e49`, share `E_TYQKEB_eIBv4MnOEEF`): 2 events arrived from Circularo with **valid HMAC** and matched to the request; the scheduled CRO Sync job processed them at 18:35:57Z (`last_event_utc` set, `last_checked_utc` null → no polling involved).
- 2026-10-15 21:27: `request_outputs` for requests 1 and 2 → 3 files each stored in `cro.output_file` (signed 72,207 / 82,490 bytes with signature; audit; certificate). `output_get` round-trip SHA-256 matches (`e3a8a456…`). Audit trail is generated per request (size/hash vary slightly between downloads).
- 2026-10-15 21:32: webhook registered (organization scope). `CRO Sync` test job completed (0 events, nothing due). Schedule created.
- 2026-10-15 21:22: Leigh signed both test requests. `request_refresh` → both **completed**, recipients signed. Direct check of outputs (browser session): signed PDF 72 KB / 82 KB with 1 `/Sig` + `/ByteRange`; audit trail ~351 KB and Certificate of Fulfillment (`/audit?cof=true`) ~384 KB, both sealed PDFs. Signed hash differs from the original (re-read before download).
- 2026-10-15 21:14: **First end-to-end send.** Request 1 = sample 01 NDA, anchors, external recipient ldickinson@sudocodesolutions.com (email OTP). Upload → anchor `SIG_RECIPIENT` matched on page 2 → field at x 0.47532, y 0.23599, 0.22×0.045 (as predicted by the sample preview) → document `b6042b53-9a42-402f-856d-5830cef2f065` in folder TTA/CRO → share `hfSOQKEB_eIBv4Mnx0Ac`. Refresh: inprogress, waiting.
- 2026-10-15 21:20: **Ad hoc send.** Request 2 = sample 06 memo, placement adhoc/default_position → 1 field on last page → document `15126ba2-62a2-4678-bc1b-c95df0928235`, share `mvSQQKEB_eIBv4MnQECE`.
- 2026-10-15 21:07: `health` → DB Circularo, login SCSDEMO\scs-admin, SQL Server 2022 Express (16.0.1000.6), compat 160, 6 cro tables, 19 cro_api procs.
- 2026-10-15 21:07: `key_migrate` → stored, fingerprint `dd7ce17399420cba`, length 64, machine SCSDEMO. `circularo_check` authenticates from the encrypted store (no fallback). `CRO_API_KEY` then blanked via SDK; client read returns length 0; `circularo_check` still OK.
- **Note:** SCSDEMO\scs-admin is **sysadmin** (maps to dbo), so the `cro_app` restriction is not in force on the demo server. Production needs a low-privilege service account.
- 2026-10-15: Circularo sandbox `/api/v1/ping` → pong.
- 2026-10-15: TTA Designer session valid (Leigh Dickinson); Circularo category exists and is empty.
