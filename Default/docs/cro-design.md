# CRO design – TotalAgility × Circularo e-signing

Status: draft for review, 2026-10-15. Builds on `circularo-capabilities.md`.

**Principle: this is a first integration, so every option stays available for testing.** Defaults are set in `CRO_CONFIG`; each request (and each recipient) can override them. Nothing below is removed by choosing a default.

## Decisions (defaults)

| Topic | Default | Also available for testing |
|---|---|---|
| Signers | Internal (Circularo users managed from TTA) and external (email-only, no account) | – |
| External protection | Email code (OTP) | None, password, OAuth login; SMS and KYC once licensed |
| Field placement | Anchor text, layouts per document type in `CRO_CONFIG` | Fixed coordinates, Circularo templates, dynamic Word templates, field auto-detection, and the ad hoc options below |
| Signing experience | Circularo emails **and** signing launched from TTA (new tab/pop-up) | Internal signing mode per request: Circularo login / as external with email code / SAML |
| Completion | Webhooks as the trigger, status polling as the safety net | Polling only (webhook off) for comparison |
| Users | TTA is the master; TTA creates, updates and suspends Circularo users |
| Record keeping | SQL database `Circularo` (schemas `cro`, `cro_api`) |
| Service identity | TTA runs as `scs-admin`; SQL access via role `cro_app` (EXECUTE on `cro_api` only) |
| Circularo identity | API key owned by support@sudocodesolutions.com (must be an organization admin to manage users and webhooks) |
| Deferred | UAE PASS |

## Why webhooks *and* polling

Circularo posts an event within moments of each action, but it does not document retries; if a delivery is missed (TTA server restarting, network blip) nothing resends it. So:

- **Webhook** → stored in `cro.webhook_event` immediately; the sync job acts on it within a minute.
- **Poll** → the sync job also re-checks any open request that has had no event for a set time (default 30 min) and every request close to its deadline.

The result is near-real-time status with no request left stuck.

## Components

```
                ┌──────────────── TotalAgility (category Circularo) ────────────────┐
 TTA user ──▶   │ CRO forms (thin shells + CRO_UI_JS)                                │
                │   Send, Track, Sign (embedded), Users                              │
                │        │ CreateJobSync                                             │
                │        ▼                                                           │
                │ CRO API (sync process, C#) ── OP dispatch ──┐                      │
                │ CRO Signing (business process per request)  │                      │
                │ CRO Sync (scheduled, every 1 min)           │                      │
                │ CRO Users (provisioning)                    │                      │
                └─────────────────────────────────────────────┼──────────────────────┘
                                         │ cro_api.* procs    │ HTTPS ?token=<API key>
                                         ▼                    ▼
                                  SQL: Circularo        Circularo sandbox
                                         ▲                    │ webhook POST
                                         │                    ▼
                                  CRO webhook receiver (IIS, outside TTA)
                                  verifies HMAC → cro_api.webhook_receive
```

### TTA items (all prefixed CRO, category Circularo)

| Item | Type | Purpose |
|---|---|---|
| `CRO_CONFIG` | server variable (text JSON) | URLs, defaults (deadline, reminders, protection), anchor layouts per document type, poll intervals |
| `CRO_UI_JS` | server variable (text) | Whole front end; pages chosen by marker |
| `CRO_API_KEY` | **secure** server variable | Circularo API key – Leigh creates it |
| `CRO_SQL` | server variable / CONFIG entry | Connection string (Integrated Security, no secrets) |
| `CRO API` | synchronous process | Ops for the forms: `REQUEST_CREATE`, `REQUEST_SEND`, `REQUEST_GET`, `REQUEST_LIST`, `REQUEST_CANCEL`, `REQUEST_REMIND`, `SIGN_URL`, `DOWNLOAD`, `USER_LIST`, `USER_SAVE`, `USER_SUSPEND`, `CONFIG_GET` |
| `CRO Signing` | business process | One job per request: upload with anchors → create document → share → wait for SQL state → fetch signed PDF + audit + certificate → attach to job → end state |
| `CRO Sync` | scheduled process | Processes the webhook inbox, polls stale/near-deadline requests, retrieves outputs, updates SQL |
| `CRO Users` | process | Creates/updates/suspends Circularo users from TTA resources; records result |
| Forms | thin shells | `CRO Send`, `CRO Requests`, `CRO Request`, `CRO Sign`, `CRO Users` |
| Groups | TTA groups | `CRO Senders`, `CRO Signers` (internal), `CRO Admins` – checked server-side |

### Webhook receiver (outside TTA)

Circularo's callback is a raw JSON POST with an HMAC header; TTA has no endpoint that accepts that without a session, so a very small IIS handler is needed on the TTA web server (for example `https://portal.sudocodesolutions.com/cro-webhook/`):

1. Read the raw body; compute HMAC-SHA256 with the secret (kept in the handler's own config, never in TTA text variables) and compare in constant time with `x-circularo-signature`.
2. Call `cro_api.webhook_receive` (stores the event, valid or not, with the raw body).
3. Return 200 immediately. No TTA credentials, no processing in the request.

The webhook is registered once with `POST /webhooks {type:"tenant", callbackUrl, hmacSecret}` by the service account. The URL must be reachable from Circularo's cloud over HTTPS.

## Main flows

**Send (TTA user or another TTA process)**
1. `CRO Send` form → `CRO API REQUEST_CREATE` validates (sender in `CRO Senders`, recipients, document) and writes `signing_request` + `recipient` rows (state `draft`).
2. `REQUEST_SEND` starts a `CRO Signing` job with the request id; other TTA processes can start it directly.
3. `CRO Signing`: `saveFile` with the layout's anchors → map anchor matches to recipients (de-duplicate, clamp 0–1) → `POST /documents` (the TTA link is kept in SQL; the sandbox account lacks the custom-fields right) → `POST /share` (sequential by default, `mail` OTP for externals, deadline and reminders from config) → store share ids, state `inprogress`.
4. Job waits, checking SQL state on a timer.

**Status**
- Webhook → inbox → `CRO Sync` re-reads `GET /documents/{id}` (the event payload only says *what* happened) → updates recipients from `waitingFor` and the request from `shareStateName`.
- Poll for requests with no event in 30 min, and every 5 min in the last day before the deadline.
- On `completed`: re-read document, download signed PDF by the new hash, audit trail and Certificate of Fulfillment (`?cof=true`), store against the job; `rejected`/`expired`/`cancelled` recorded with reason.

**Sign from inside TTA**
- Circularo pages send `X-Frame-Options: SAMEORIGIN` (checked on the sandbox), so they **cannot be shown inside a TTA form frame**. The `CRO Sign` form opens the signing page in a new tab or pop-up and watches for completion (status refresh via `CRO API`). Ask Circularo whether they can allow framing for portal.sudocodesolutions.com; if they do, the frame becomes an option.
- External: `SIGN_URL` validates the TTA user's right to see that request, calls `GET /share/{shareId}/validate`, returns `<frontend>/share?shareToken=…`. The signer still enters the email code.
- Internal, three modes (configurable per request, all to be tested):
  1. **Circularo login** – `<frontend>/#!/sign?documentId=…&documentType=…`; the user signs in to Circularo once and stays signed in.
  2. **As external with email code** – the staff member is shared as an external recipient (their email), so the share-token link works; no Circularo licence used, but the signature is not tied to their Circularo account.
  3. **SAML** – the sandbox has a SAML configuration entry; if usable, single sign-on from the organisation's identity provider.

**Ad hoc documents (production will mostly be these)**

An arbitrary uploaded document has no known layout. Placement options, all to be built so they can be compared:

| Option | How | Notes |
|---|---|---|
| A. Default position | Fields stacked on the last page (bottom, one row per signer), with initials optional on every page | Zero effort for the sender; may overlap content |
| B. Circularo's own editor | `<frontend>/signPrepare?mode=create&documentId=…&documentType=…&callbackUrl=<TTA form>` in a new tab; the sender places fields and sends in Circularo, then returns to TTA | Full Circularo field set; TTA reads the resulting shares back |
| C. TTA placement page | `CRO Place` form renders the PDF (PDF.js) and the sender clicks to place each signer's fields; TTA sends with exact coordinates | Stays in TTA; most build effort |
| D. Field detection | Circularo detects AcroForm/XFA/Word fields on upload (`signFields`, `formFields`; org setting "Detect signature fields", currently off) | Only for documents that already have form fields |
| E. Typed tokens | The author types an agreed token (e.g. `{{sign:1}}`) in the document; treated as anchors | Good for documents produced by other systems |

The integration always tries the configured layout first; if anchors find nothing (sample 07, scanned), it falls back to the request's ad hoc option and records that it did.

**Users**
- `CRO Users` form (CRO Admins) lists TTA resources in `CRO Signers` and their Circularo status; Save/Suspend call `CRO Users` → `POST /users`, `PUT /users/{id}`; results in `circularo_user` and the audit log.

## Security

- API key only in a secure server variable mapped to C# nodes; never sent to the browser, never logged (it is in the query string, so request URLs are not logged either).
- Browser → `CRO API` with its own session token, validated server-side; actor always taken from the validated session, never from the browser.
- Who may send, view, cancel or sign is checked in `CRO API` against TTA groups and the request's recipients.
- SQL: `cro_app` can only execute `cro_api` procedures; every view, change and refusal is written to the append-only `cro.audit_log`.
- Webhooks accepted only with a valid HMAC; invalid ones are stored for diagnosis but never acted on. The sync job always re-reads Circularo rather than trusting the payload.

## Data model (003_core_tables.sql)

- `cro.circularo_user` – TTA resource ↔ Circularo account, role, status.
- `cro.signing_request` – one per document; Circularo document id, hashes, state, timestamps.
- `cro.recipient` – order, internal/external, purpose, protection, anchor, share id, status.
- `cro.webhook_event` – raw inbox with HMAC result and processing outcome.
- `cro.audit_log` – append-only (trigger blocks update/delete).

## Build order

1. SQL 000–003 (Leigh runs) → procedures 004+.
2. Sandbox checks with the service account: plan/add-ons, definitions/workflows, org settings, token and reminder behaviour, framing headers.
3. `CRO_CONFIG`, secure `CRO_API_KEY` (Leigh), `CRO API` skeleton with `CONFIG_GET` and a Circularo ping.
4. `CRO Signing` end-to-end with one external signer (synthetic document), polling only.
5. Webhook receiver + registration, `CRO Sync`.
6. Forms: Send, Requests, Request, Sign.
7. Users provisioning and internal signers.
8. Package export into the repo; test checklist.

## Dashboard (CRO Dashboard form)

Modelled on Circularo's Home and Reports pages, built from the CRO SQL record, so it covers only what went through TTA, with more detail than Circularo shows.

| Area | Content | Source |
|---|---|---|
| Quick start | Three tiles like Circularo's: **Sign now** (only me), **We sign** (me + others), **They sign** (others only), each opening CRO Send with that preset | – |
| Overview | Assigned to me · Waiting for others · Completed · Approaching deadline (≤ 3 days) · Needs attention (rejected / expired / cancelled / failed) – each clickable to the filtered list | `dashboard_overview` |
| Status | Donut of requests by state | `dashboard_overview` (2nd set) |
| Volume over time | Sent vs completed per day (7 / 30 / 90 days) | `dashboard_reports` |
| Success & turnaround | Completion rate, rejected/expired/cancelled counts, average / fastest / slowest time to complete | `dashboard_reports` |
| Placement mix | Anchors vs default position vs other ad hoc options – useful while testing the options | `dashboard_reports` |
| Recent activity | "CRO test 03 … signed by Leigh Dickinson – 3 minutes ago" from the audit log and webhook events | `dashboard_activity` |
| Integration health (admins) | Last sync run, events waiting, webhooks in the last 24 h, bad signatures, failed requests, completed without outputs | `monitor_status`, `webhook_recent` |

Scope toggle: **Mine** (requests I created or am a recipient of) / **All** (CRO admins). Charts are drawn as inline SVG in CRO_UI_JS (no external libraries), matching the forms' look. Optionally later: Circularo's own org-wide figures via `POST /search/dashboards` (trans_status, trans_per_date, …) for documents created outside TTA.

## Sandbox findings (2026-10-15)

- Service account support@sudocodesolutions.com is an organization admin (`manage_users`, `add_users`, `use_webhooks`, `view_api_keys`, `view_logs`, `seal_document`).
- Protection rights present: email OTP, password, OAuth. **No SMS OTP, KYC, TSA timestamp or custom-fields rights.**
- Document definitions: only `d_default` (ext); workflow `wf_archive` (states initialized, created).
- Org settings: external sharing on; parallel by default, order changeable; same user in several steps **off**; signature inputs draw/type/upload/wacom/mobile; provider internal only; default share rights print + reject without comment; field detection off; upload limit 40 MB; date format dd/MM/yyyy.
- Internal usernames are not always the email (e.g. `ldickinson@sudocodesolutions.com.1`), so store the Circularo username separately from the email.
- Framing: `X-Frame-Options: SAMEORIGIN` on all pages.
- API keys: one generic key exists ("TTA-SCSDEMO-GENERIC", created today). Webhooks: none registered yet.
- Users: 3 (support, ldickinson, svlakum). Org role groups: admin, user, prepare, read, sign.

## Open questions

1. Which internal signing mode becomes the default after testing (all three are built).
2. Ask Circularo: allow framing for portal.sudocodesolutions.com; webhook retry policy; whether SAML can be used on the sandbox.
3. Webhook receiver on IIS at portal.sudocodesolutions.com (reachable from the web – confirmed). Registering the webhook needs your go-ahead when the receiver is ready.
