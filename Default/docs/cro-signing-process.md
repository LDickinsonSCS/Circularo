# CRO Signing – using it from other TotalAgility processes

`CRO Signing` (process id `A99F9A5787D94258AF5D45D51D93811C`, category Circularo) sends a TotalAgility document for signature in Circularo, waits, and puts the signed PDF back into TotalAgility. Add it to a process as a sub-job, or start it with `JobService.CreateJob`.

## Inputs
| Variable | Required | Meaning |
|---|---|---|
| `CRO_DOCUMENT_ID` | yes | TotalAgility (Capture) document id. PDF and Word (.docx) are sent as they are; anything else (TIFF, images) is rendered to PDF by TotalAgility first. |
| `CRO_REQUEST` | yes | JSON, same shape as the CRO_Send form uses (below). |
| `CRO_FOLDER_ID` | no | Folder for the signed documents. Default: the folder of `CRO_DOCUMENT_ID`. |

`CRO_REQUEST`:
```json
{
  "title": "Supplier agreement – ACME",            // default: document name
  "businessRef": "CASE-1234",                       // default: "TTA document <id>"
  "senderResourceId": "<32-char TTA resource id>", // shows as the sender; needed for the sender's dashboard
  "senderName": "Jane Smith",
  "layoutKey": "03_supplier_agreement",             // anchor layout in CRO_CONFIG; omit for ad hoc
  "placement": "anchors",                           // or "adhoc" (default position on the last page)
  "validUntilUtc": "2026-11-30T20:00:00Z",          // default: deadlineDays from CRO_CONFIG
  "recipients": [
    { "order": 1, "kind": "internal", "email": "a@company.com", "fullName": "A", "purpose": "sign",
      "internalMode": "circularo_login", "anchorId": "customer_approver" },
    { "order": 2, "kind": "external", "email": "b@supplier.com", "fullName": "B", "purpose": "sign",
      "protection": "email_otp", "anchorId": "supplier_director_a" }
  ]
}
```
`purpose`: sign, approve, accept, review, view. `protection` (externals): email_otp or none. `internalMode`: circularo_login or as_external. Same order number = sign in parallel.

## Outputs
| Variable | Meaning |
|---|---|
| `CRO_REQUEST_ID` | CRO request number (CRO_Request form: `?id=`) |
| `CRO_STATE` | completed, rejected, expired, cancelled, or failed |
| `CRO_SIGNED_DOCUMENT_ID` | TotalAgility document id of the signed PDF (audit trail and certificate are added to the same folder; switch off with `signing.attachAudit` / `signing.attachCertificate` = false in CRO_CONFIG) |
| `ERROR` | Error text, if any |

## How it runs
`Send for signature` → `Finished?` → `Check status` (waits 2 minutes, then re-checks) → `Finished?` … → `Finished`.
Both script steps run the CRO API script with `CRO_RUNMODE=signing`. Status normally arrives by webhook through `CRO Sync`; `Check status` reads the CRO record, refreshes from Circularo when needed and, on completion, adds the documents. If sending fails, the job ends at once with `CRO_STATE=failed` and `ERROR`. Errors while checking are retried on the next check.
