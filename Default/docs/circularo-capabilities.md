# Circularo capability review for the CRO integration

Reviewed 2026-10-15 against the Circularo Help Center (help.circularo.com) and the Developer Guide for API 26.1.0 (developers.circularo.com/latest). Sandbox: https://sudocode.sandbox.circularo.com (API `…/api/v1`, `GET /ping` → `pong`, verified).

Scope agreed: internal and external signers; UAE PASS deferred.

Legend: **[Expose]** an option TTA should offer per request · **[Config]** a Circularo org setting to fix once · **[Gap]** not documented, verify on the sandbox.

---

## 1. Connecting

| Item | Detail |
|---|---|
| Base URL | `https://sudocode.sandbox.circularo.com/api/v1`; frontend links use the same host without `/api/v1`. Tenant is taken from the host. |
| Auth | `?token=` query parameter (or cookie). **No Bearer header.** |
| API key | `POST /api/key {description}` → `{id}` is the key. Lasts 10 years, has the creating user's rights. `GET /api/key` lists, `DELETE /api/key/{key}` revokes. Rotate = create new, switch, delete old. |
| Session login | `POST /login {name, password}` → `token` (about 30 days, refreshed on use — the docs conflict; verify). MFA unlock via `POST /login/unlock`. `GET /logout`. |
| Token check | `GET /login?token=` → `logged`, `isUnlocked`. |
| Licensing | "REST API for Custom Integrations" is a Business+ add-on — confirm the sandbox has it. SMS OTP, KYC and qualified timestamps consume credits. |
| Errors (26.1) | `{status, type:"NAMESPACE:CODE", message, requestId, details?}`; e.g. `VALIDATION:INPUT_INVALID` 400, `AUTH:UNAUTHORIZED` 401, `RESOURCE:NOT_FOUND` 404, `DOCUMENT:VERSION_CONFLICT` / `DOCUMENT:STATE_CONFLICT` 409, 402 subscription capacity, 412 storage quota. |
| Rate limits | None documented except password reset/registration. Docs ask for one token reused, not a login per call. |
| Spec | Full OpenAPI: https://circularo.com/api/full/26.1.0/OpenApi3.json (integrator subset under `/api/integrators/`). |

**Decision:** the integration authenticates with an API key created under the `support@sudocodesolutions.com` service account, stored in a TTA **secure** server variable, used only server-side (it travels in the URL).

## 2. Documents

- **Upload:** `POST /files/saveFile` (multipart: `file`, `fileName`, optional `signatureAnchors`) → file `hash`, `pages`, detected `signFields`/`formFields`, `anchorPositions`.
- **Create:** `POST /documents {body:{documentType:"d_default", documentTitle, pdfFile:{content:hash}, file:[attachments], customFields:[…]}, definitionType:"ext", workflow:"wf_archive", optionalData:{folder | path}}` → `documentId`. Folder paths are auto-created.
- **Definitions:** `GET /definitions/documents`, `GET /definitions/workflows` — only `d_default` / `wf_archive` are documented, so list the sandbox's own. **[Gap]**
- **Formats:** pdf, doc/docx, xls/xlsx, ppt/pptx, rtf, txt, html, images; converted to PDF. No conversion endpoint documented. **[Gap]**
- **Limits:** 40 MB per document (80 MB add-on); 50 attachments / 200 MB (help centre) vs 20 attachments (API changelog) **[Gap]**; title 85–255 chars, no `/ ? < > \ : * | "`.
- **Custom fields:** `customFields[{key, displayName, type, value}]` — good for storing the TTA job ID / case reference on the Circularo document. Needs the `allow_documents_custom_fields` right in 26.1.
- **Attachments:** `POST /attachments/{docId} {fileHash, document_name}`; only *public* attachments are visible to external signers.
- **Search:** `POST /search` with Elasticsearch-style `esFilters`, paging, or scroll. Useful filters: `workflow.shareStateName`, `workflow.waitingFor.user.name`, date ranges.
- **Folders:** `POST /folders`, `PUT /folders/move`, export folder as zip via `POST /export`.
- **Delete:** `DELETE /documents?hardDelete=false` (trash) or `true` (permanent). No restore API.
- **Versions:** `_version` is an optimistic-concurrency counter (must match on sign/seal/annotate; re-read first). Revisions can be uploaded only before signing starts.

## 3. Signing requests (`POST /share`)

| Option | API field | Notes |
|---|---|---|
| Action per recipient **[Expose]** | `data[].sharePurpose` | `sign`, `approve`, `accept`, `review`, `view` (also `edit`, `execute`). Approve/Accept seal with a certificate; Review does not. |
| Recipient | `data[].shareTo` | Internal = Circularo username; external = email. Externals need no account or licence. |
| Order **[Expose]** | `sequential`, `data[].order` | Parallel (default) or sequential; same `order` + `quorum` = signing group (all or n of the group). Max 100 participants. |
| Message **[Expose]** | `data[].message` | Private message per recipient, max 1,500 chars. |
| Deadline **[Expose]** | `data[].validUntil` | 1 day to 6 months. Expired = failed; **cannot be extended** — start a new request. |
| External security **[Expose]** | `password`, `otpEnabled` + `phone` (SMS, add-on) or `mail` (email OTP) | Email link alone is weakest. OTP is **mandatory** for embedded external signing links. Phone in `+<country><number>`. |
| KYC **[Expose, optional]** | `kycProviders:["identomat"]`, `kycFactors` | ID scan, selfie, liveness. Credit-based add-on. |
| Reminders **[Expose]** | `data[].automaticReminder{start, intervalDays}` | Max 10 automatic per recipient; manual `POST /share/reminder` once per day per share (body shape differs between docs **[Gap]**). |
| Fields | `signatureFields[]` | `type`: `signature`, `initials`, `stamp`, `wacom`, `annotation`, `image`; `user`, `pages`, `position` (0–1 from top-left), `required`, `timestamp`, `tooltip`, `readOnly`. Recommended minimum 0.2 × 0.05. |
| Placement **[Expose]** | anchors / coordinates / templates | See §5. |
| Sender signs too | `signatures[]` on the same call | "We sign" in one step. |
| Trusted timestamp | `useTsa:true` | RFC-3161; needs `set_tsa` right and a configured TSA. |
| Recipient rights | org defaults **[Config]** | Delegation, download/print, reject without reason, annotate on reject, upload files. Not documented as per-share API fields **[Gap]**. |

Response: one share per recipient (`shareId`, `sharedWith`, `order`, `validUntil`, masked OTP phone).

**After sending:** recipients cannot be **added** (cancel and resend); they can be swapped only if "Enable recipient editing" is on. Cancel = `PUT /share/disable {shareIds}` — cancelling one share cancels the whole process. Recipients can reject or delegate (if allowed); delegation chain ≤ 10.

## 4. Status, completion and outputs

- **State:** `GET /documents/{id}` → `workflow.shareStateName` = `inprogress` | `completed` | `rejected` | `expired` | `cancelled`; `workflow.waitingFor[]` (`user.name`, `hasTurn`); `isSigned`.
- **Webhooks:** `documentCreated`, `documentEdited`, `documentDeleted`, `signRequest`, `signDelegated`, `signRejected`, `signExpired`, `signCancelled`, `documentSigned`, `documentCompleted`, `documentSimpleActionExecuted`. Payload `{documentId, event, actor, timestamp}`; optional HMAC-SHA256 in `x-circularo-signature`. Tenant/team/organization scope, no per-event filter, no update (delete + recreate), retry policy undocumented. **Must be enabled by Circularo support.** Signed files are never pushed — always pull.
- **Signed PDF:** re-read the document, then `GET /files/loadFile/hash/{pdfFile.content}` (signing creates a new hash; the old hash still returns the unsigned file).
- **Audit trail:** `GET /documents/{id}/audit` (PDF, on demand). `?cof=true` → **Certificate of Fulfillment**, sealed once at completion, includes signing method, LTV, timestamps, per-event IP and geolocation.
- **Verification:** DocID + verification portal (UAE tenants: mena.circularo.com/verification). PDF upload verifies content; DocID alone does not.
- **Audit logs:** `POST /logs/search` (needs `view_logs`); reports `POST /search/dashboards`, `POST /search/reports`.

## 5. Placing signature fields — three options

1. **Anchor text** (recommended default): send `signatureAnchors[{id, text|regexp, offset}]` on upload; Circularo returns positions per match. Works for TTA-generated or standard documents with labels like "Signed by:". De-duplicate matches and clamp positions to 0–1. Does not see text in images/scans.
2. **Fixed coordinates** per document type, held in `CRO_CONFIG`.
3. **Circularo templates:** PDF eSigning templates (roles, order, fields, settings); `POST /documents` with `customTemplate` + `cloneMainFile:true`, **then resend the fields in `POST /share`** (not applied automatically). 26.1 moved template share settings into `shareSettings` — old shape is silently ignored. **Dynamic MS Word templates** carry field JSON inside Word shapes. Templates export/import as JSON between environments.

Also: Circularo auto-detects AcroForm/XFA/Word fields on upload (`signFields`, `formFields`).

## 6. Signer experience (embedding)

- **Email (default):** Circularo emails each recipient (from noreply@circularo.com, or a custom identity add-on), in the recipient's chosen language (English, Arabic RTL).
- **Embedded internal:** `<frontend>/#!/sign?documentId=…&documentType=…` (user signs in to Circularo). `<frontend>/loginRedirect?…&token=` can carry a session.
- **Embedded external:** OTP-protected share → `GET /share/{shareId}/validate` → `shareToken` → `<frontend>/share?shareToken=…`; usable in an iframe per Circularo.
- **Sender preparation UI:** `<frontend>/signPrepare?mode=create&documentId=&documentType=&callbackUrl=` lets a TTA user place fields in Circularo's own editor and return to TTA.
- External signers: draw/type/upload/mobile-QR signature, stamps, reject, delegate; download the signed PDF if permitted; no history visible.

## 7. Signature levels and certificates

- Default: PAdES signatures with LTV, AATL-trusted I.CA certificates (TDRA-approved), Circularo stated as eIDAS **Advanced**.
- **[Config] Signing method:** *Composite* (default; one certificate for the PDF, all field types) vs *Individual* (certificate per signature; signature/initials/stamp only; ≤ 10 per signer).
- Seal: `PUT /documents/seal/{version}` — invisible certificate; cannot seal a signed or in-progress document.
- Qualified: only via I.CA qualified cards (USB/NFC), or UAE PASS (deferred).
- Customer-unique certificate available as an add-on.

## 8. Users and teams (internal signers)

- Roles: Admin, Member, Member Lite (Prepare / Sign / Read only).
- API (org admin): `POST /users` (invite or create active), `POST /users/search`, `PUT /users/{id}` (incl. suspend), `DELETE /users/{id}`, group add/remove. **[Decide]** whether TTA provisions internal signers or they are maintained in Circularo (SAML/SCIM are add-ons).

## 9. Org settings to fix on the sandbox [Config]

Allow external sharing = **on** (mandatory) · default signing order and whether changeable · recipient editing level · repeat recipients · default rights (delegation, download, reject without reason) · default deadline and automatic reminders · signing method (Composite/Individual) · PDF/A · hide IPs · enabled languages · webhook activation (support ticket) · custom email identity / branding (add-ons).

## 10. Open questions / gaps to verify on the sandbox

1. Which plan and add-ons the sandbox has (REST API, SMS OTP, KYC, TSA, webhooks).
2. Document definitions and workflows available beyond `d_default` / `wf_archive`.
3. Session token lifetime (30 days vs 30 min).
4. `POST /share/reminder` body shape.
5. Per-share recipient rights (delegation, download) via API.
6. Office → PDF conversion endpoint.
7. Webhook retry behaviour.
8. Attachment limit (20 vs 50).
