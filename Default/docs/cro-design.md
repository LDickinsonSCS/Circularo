# CRO design – TotalAgility × Circularo e-signing

Status: draft for review, 2026-10-15. Builds on `circularo-capabilities.md`.

## Decisions

| Topic | Decision |
|---|---|
| Signers | Internal (Circularo users managed from TTA) and external (email-only, no account) |
| External protection | Email code (OTP) by default; SMS/password available per recipient later |
| Field placement | Anchor text, with layouts per document type in `CRO_CONFIG` |
| Signing experience | Circularo emails **and** signing from inside TTA forms |
| Completion | Webhooks as the trigger, status polling as the safety net |
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
3. `CRO Signing`: `saveFile` with the layout's anchors → map anchor matches to recipients (de-duplicate, clamp 0–1) → `POST /documents` (custom field `tta_request` = request ref) → `POST /share` (sequential by default, `mail` OTP for externals, deadline and reminders from config) → store share ids, state `inprogress`.
4. Job waits, checking SQL state on a timer.

**Status**
- Webhook → inbox → `CRO Sync` re-reads `GET /documents/{id}` (the event payload only says *what* happened) → updates recipients from `waitingFor` and the request from `shareStateName`.
- Poll for requests with no event in 30 min, and every 5 min in the last day before the deadline.
- On `completed`: re-read document, download signed PDF by the new hash, audit trail and Certificate of Fulfillment (`?cof=true`), store against the job; `rejected`/`expired`/`cancelled` recorded with reason.

**Sign from inside TTA**
- External: `SIGN_URL` validates the TTA user's right to see that request, calls `GET /share/{shareId}/validate`, returns `<frontend>/share?shareToken=…`; the `CRO Sign` form shows it in a frame (or new tab if Circularo refuses framing). The signer still enters the email code.
- Internal: `<frontend>/#!/sign?documentId=…&documentType=…`. **The user must be signed in to Circularo** – see open question 1.

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

## Open questions

1. **Internal signers inside TTA need a Circularo sign-in.** Options: (a) SAML single sign-on add-on so the TTA user's identity carries over; (b) users sign in to Circularo once in their browser and stay signed in (session ~30 days); (c) treat staff as "external" recipients with an email code when signing from TTA (no Circularo licence needed, but the signature is not tied to a Circularo account). Recommend (b) to start, (a) if licensed.
2. Where to host the webhook receiver: IIS on the TTA server (proposed) – confirm it is reachable from the internet over HTTPS.
3. Which TTA documents/templates are signed first (drives the anchor layouts).
