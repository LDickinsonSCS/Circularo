# CRO sample documents

Synthetic test documents for the TotalAgility × Circularo integration. Every name, company, address and figure is invented, and every page is marked "SAMPLE – synthetic test document".

Rebuild with:

```
python3 build_samples.py        # PDFs 01–09 (reportlab, pymupdf)
python3 build_word_samples.py   # Word 10–12, writes out/manifest.json
```

`out/manifest.json` gives, for each document, the recipients (role, internal/external, purpose, order, protection) and the anchors (text or regex, field type, offset). The anchor list is the draft for the document layouts in `CRO_CONFIG`. Offsets were checked by drawing the predicted fields onto the pages.

## Test matrix

| # | File | Main things it tests |
|---|---|---|
| 01 | `01_mutual_nda.pdf` | Label anchors, two signers in parallel (internal + external), date fields |
| 02 | `02_offer_letter.pdf` | Sequential internal → external, one anchor matching on every page (initials), 3 pages |
| 03 | `03_supplier_agreement.pdf` | Hidden white-text tokens, signing group with quorum 1, approve and review purposes, stamp, 6 pages |
| 04 | `04_purchase_approval.pdf` | Regex anchor with three matches mapped by order, review → approve → sign, all internal |
| 05 | `05_consent_form.pdf` | Fillable fields by anchor: name, email, phone, company, two checkboxes, date |
| 06 | `06_adhoc_memo.pdf` | **Ad hoc**: no anchors at all |
| 07 | `07_scanned_letter.pdf` | Image-only page: anchors must find nothing; fallback to ad hoc |
| 08 | `08_large_agreement_40p.pdf` | 40 pages: upload, anchor scan and download times; signatures on last page |
| 09 | `09_anchor_edge_cases.pdf` | Anchor near the page edge (position past 1.0, must be clamped), ambiguous repeated text |
| 10 | `10_bilingual_tenancy_addendum.docx` | Word → PDF conversion, Arabic RTL text, bilingual labels as anchors |
| 11 | `11_dynamic_word_template.docx` | Circularo dynamic Word template notation in rectangle shapes: roles, dropdown, checkbox, stamp, timestamp |
| 12 | `12_adhoc_letter.docx` | **Ad hoc** Word upload: conversion plus ad hoc placement |

Also to be tested with these files: email code vs password protection, deadlines and expiry, automatic and manual reminders, cancel, reject, delegate, signing links opened from TTA, webhook events for each outcome, and download of the signed PDF, audit trail and Certificate of Fulfillment.

Note on 11: the shapes are generated in code. If Circularo does not detect them, open and re-save the file once in Microsoft Word.
