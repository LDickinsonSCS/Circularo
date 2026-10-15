"""
Build the CRO synthetic sample documents for Circularo testing.

All names, companies, addresses and numbers are invented. Every page is
marked "SAMPLE – synthetic test document".

    python3 build_samples.py            # writes into ./out
"""
import json
import os
import random
import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle, KeepTogether)
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
random.seed(42)

SS = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=SS["Heading1"], fontSize=16, spaceAfter=8)
H2 = ParagraphStyle("H2", parent=SS["Heading2"], fontSize=12, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("B", parent=SS["BodyText"], fontSize=10, leading=14)
SMALL = ParagraphStyle("S", parent=BODY, fontSize=8, leading=10, textColor=colors.grey)
HIDDEN = ParagraphStyle("Hidden", parent=BODY, fontSize=6, leading=7, textColor=colors.white)

MARK = "SAMPLE – synthetic test document – not a real agreement"

LOREM = [
    "The parties wish to set out the terms on which information, services and obligations will be exchanged in connection with the project described in this document.",
    "Each party shall act in good faith and shall not unreasonably withhold or delay any consent, approval or decision required under this document.",
    "Nothing in this document creates a partnership, joint venture or agency relationship between the parties, and neither party may bind the other.",
    "Notices must be in writing and delivered by hand, by courier or by email to the addresses set out above, and take effect on receipt.",
    "This document may be signed electronically and in any number of counterparts, each of which is an original and all of which together form one document.",
    "If any provision of this document is held invalid, the remaining provisions continue in full force and effect.",
    "This document is governed by the laws of the jurisdiction stated in the schedule, and the courts of that jurisdiction have exclusive jurisdiction.",
    "Confidential information excludes information that is or becomes public other than through a breach of this document, or that the receiving party already lawfully held.",
]


def footer(c: canvas.Canvas, doc):
    c.saveState()
    c.setFont("Helvetica", 7)
    c.setFillColor(colors.grey)
    c.drawString(20 * mm, 10 * mm, MARK)
    c.drawRightString(190 * mm, 10 * mm, f"Page {doc.page}")
    c.restoreState()


def paras(n, start=0):
    return [Paragraph(f"{i + 1 + start}. " + LOREM[(i + start) % len(LOREM)], BODY) for i in range(n)]


def sig_block(rows, col_widths=(75 * mm, 95 * mm)):
    """rows: list of (label, value) – label text is the anchor."""
    t = Table([[Paragraph(f"<b>{a}</b>", BODY), b] for a, b in rows], colWidths=col_widths,
              rowHeights=[14 * mm if "Signature" in a or "Stamp" in a or "Initials" in a or "التوقيع" in a else 8 * mm for a, _ in rows])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (1, 0), (1, -1), 0.4, colors.grey),
    ]))
    return KeepTogether(t)


def build(name, story, onpage=footer):
    path = os.path.join(OUT, name)
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm, title=name, author="CRO sample generator")
    doc.build(story, onFirstPage=onpage, onLaterPages=onpage)
    return path


manifest = []


def add(file, title, purpose, recipients, anchors, placement, notes=""):
    manifest.append({"file": file, "title": title, "purpose": purpose, "placement": placement,
                     "recipients": recipients, "anchors": anchors, "notes": notes})


# Offsets are fractions of the page measured from the top-left of the anchor text's first letter.
SIG_OFFSET = {"percentX": 0.0, "percentY": 0.012, "percentWidth": 0.22, "percentHeight": 0.045}
RIGHT_OF_LABEL = {"percentX": 0.37, "percentY": -0.012, "percentWidth": 0.22, "percentHeight": 0.045}
INITIALS_OFFSET = {"percentX": 0.09, "percentY": -0.01, "percentWidth": 0.08, "percentHeight": 0.03}
DATE_OFFSET = {"percentX": 0.37, "percentY": -0.008, "percentWidth": 0.18, "percentHeight": 0.022}

# ---------------------------------------------------------------- 01 NDA
s = [Paragraph("Mutual Non-Disclosure Agreement", H1),
     Paragraph("Between <b>Falcon Ridge Analytics LLC</b> (fictional), Office 1204, Sample Tower, Dubai, and "
               "<b>Harbour Lane Consulting Ltd</b> (fictional), 18 Example Street, London.", BODY), Spacer(1, 6)]
s += paras(8) + [PageBreak(), Paragraph("Signatures", H2), Paragraph("Signed for and on behalf of each party.", BODY), Spacer(1, 6),
                 sig_block([("Disclosing Party Signature:", ""), ("Name:", "Amira Haddad (fictional)"), ("Disclosing Party Date:", "")]),
                 Spacer(1, 10),
                 sig_block([("Receiving Party Signature:", ""), ("Name:", "Oliver Grant (fictional)"), ("Receiving Party Date:", "")])]
build("01_mutual_nda.pdf", s)
add("01_mutual_nda.pdf", "Mutual NDA", "Basic label anchors, two signers in parallel, signing date fields",
    [{"role": "discloser", "kind": "internal", "purpose": "sign", "order": 1},
     {"role": "recipient", "kind": "external", "purpose": "sign", "order": 1, "protection": "email_otp"}],
    [{"id": "SIG_DISCLOSER", "text": "Disclosing Party Signature:", "role": "discloser", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "DATE_DISCLOSER", "text": "Disclosing Party Date:", "role": "discloser", "type": "annotation", "subtype": "annotation_date", "offset": DATE_OFFSET},
     {"id": "SIG_RECIPIENT", "text": "Receiving Party Signature:", "role": "recipient", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "DATE_RECIPIENT", "text": "Receiving Party Date:", "role": "recipient", "type": "annotation", "subtype": "annotation_date", "offset": DATE_OFFSET}],
    "anchors", "Parallel (sequential=false). Expect one match per anchor on page 2.")

# ---------------------------------------------------------------- 02 Offer letter (initials on every page)
def initials_footer(c, doc):
    footer(c, doc)
    c.saveState()
    c.setFont("Helvetica-Bold", 9)
    c.drawString(140 * mm, 16 * mm, "Initials:")
    c.restoreState()

s = [Paragraph("Offer of Employment", H1),
     Paragraph("Dear <b>Priya Nair</b> (fictional),", BODY), Spacer(1, 4),
     Paragraph("We are pleased to offer you the position of <b>Senior Integration Analyst</b> at Falcon Ridge Analytics LLC (fictional), "
               "on the terms below. This offer is subject to the conditions in the schedule.", BODY), Spacer(1, 6)]
s += [Table([["Start date", "1 December 2026 (sample)"], ["Location", "Dubai, UAE"], ["Probation", "6 months"],
             ["Notice period", "1 month"], ["Annual leave", "30 working days"]], colWidths=(45 * mm, 120 * mm),
            style=[("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]), Spacer(1, 8)]
s += paras(6) + [PageBreak(), Paragraph("Schedule – Terms and Conditions", H2)] + paras(8, 2) + [PageBreak(),
      Paragraph("Acceptance", H2),
      Paragraph("Approved for the company by the HR Manager, then accepted by the candidate.", BODY), Spacer(1, 6),
      sig_block([("HR Manager Signature:", ""), ("Name:", "Khalid Rahman (fictional)")]), Spacer(1, 10),
      sig_block([("Candidate Signature:", ""), ("Name:", "Priya Nair (fictional)"), ("Candidate Date:", "")])]
build("02_offer_letter.pdf", s, onpage=initials_footer)
add("02_offer_letter.pdf", "Offer letter", "Sequential internal → external; initials on every page (one anchor, many matches)",
    [{"role": "hr_manager", "kind": "internal", "purpose": "sign", "order": 1},
     {"role": "candidate", "kind": "external", "purpose": "sign", "order": 2, "protection": "email_otp"}],
    [{"id": "SIG_HR", "text": "HR Manager Signature:", "role": "hr_manager", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "SIG_CANDIDATE", "text": "Candidate Signature:", "role": "candidate", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "DATE_CANDIDATE", "text": "Candidate Date:", "role": "candidate", "type": "annotation", "subtype": "annotation_date", "offset": DATE_OFFSET},
     {"id": "INITIALS_CANDIDATE", "text": "Initials:", "role": "candidate", "type": "initials", "offset": INITIALS_OFFSET, "allMatches": True}],
    "anchors", "3 pages; 'Initials:' appears once per page → candidate initials on every page.")

# ---------------------------------------------------------------- 03 Supplier agreement (hidden tokens, group, stamp, approve)
s = [Paragraph("Supplier Services Agreement", H1),
     Paragraph("Between <b>Falcon Ridge Analytics LLC</b> (fictional) (the Customer) and <b>Desert Bloom Facilities Services LLC</b> "
               "(fictional) (the Supplier).", BODY), Spacer(1, 6)]
for sec in range(1, 6):
    s += [Paragraph(f"Clause {sec}", H2)] + paras(5, sec)
    s += [PageBreak()]
s += [Paragraph("Execution", H2),
      Paragraph("Signed by either of the Supplier's two authorised directors, approved and stamped by the Customer, "
                "and reviewed by Legal.", BODY), Spacer(1, 8),
      Paragraph("For the Supplier (any one director)", BODY), Spacer(1, 2),
      Paragraph("{{SUPPLIER_SIG}}", HIDDEN), Spacer(1, 44),
      Paragraph("Name: ________________________   Title: Director", BODY), Spacer(1, 10),
      Paragraph("Approved for the Customer", BODY), Spacer(1, 2),
      Paragraph("{{CUSTOMER_APPROVE}}", HIDDEN), Spacer(1, 44),
      Paragraph("Customer company stamp", BODY), Spacer(1, 2),
      Paragraph("{{CUSTOMER_STAMP}}", HIDDEN), Spacer(1, 74),
      Paragraph("Reviewed by Legal (no signature required)", BODY)]
build("03_supplier_agreement.pdf", s)
add("03_supplier_agreement.pdf", "Supplier services agreement",
    "Hidden white-text tokens, signing group with quorum 1, approve and review purposes, stamp field, 6 pages",
    [{"role": "supplier_director_a", "kind": "external", "purpose": "sign", "order": 1, "group": "supplier", "quorum": 1, "protection": "email_otp"},
     {"role": "supplier_director_b", "kind": "external", "purpose": "sign", "order": 1, "group": "supplier", "quorum": 1, "protection": "email_otp"},
     {"role": "customer_approver", "kind": "internal", "purpose": "approve", "order": 2},
     {"role": "customer_stamp", "kind": "internal", "purpose": "sign", "order": 3},
     {"role": "legal_review", "kind": "internal", "purpose": "review", "order": 4}],
    [{"id": "SIG_SUPPLIER", "text": "{{SUPPLIER_SIG}}", "role": "supplier_director_a,supplier_director_b", "type": "signature", "offset": SIG_OFFSET},
     {"id": "SIG_CUSTOMER", "text": "{{CUSTOMER_APPROVE}}", "role": "customer_approver", "type": "signature", "offset": SIG_OFFSET},
     {"id": "STAMP_CUSTOMER", "text": "{{CUSTOMER_STAMP}}", "role": "customer_stamp", "type": "stamp",
      "offset": {"percentX": 0.0, "percentY": 0.0, "percentWidth": 0.15, "percentHeight": 0.08}}],
    "anchors", "Tokens are 6pt white text: invisible to readers, detectable as text. Tests groups/quorum and approve/review.")

# ---------------------------------------------------------------- 04 Purchase approval (regex anchors)
rows = [["Line", "Item", "Qty", "Unit (AED)", "Total (AED)"]]
total = 0
for i, item in enumerate(["Laptop – 14 inch (sample)", "Docking station", "27 inch monitor", "Headset", "Software licence (1 yr)"], 1):
    q = random.randint(1, 12); u = random.choice([150, 420, 980, 1350, 4200]); total += q * u
    rows.append([str(i), item, str(q), f"{u:,.2f}", f"{q * u:,.2f}"])
rows.append(["", "", "", "Total", f"{total:,.2f}"])
s = [Paragraph("Purchase Requisition Approval – PR-2026-00417 (sample)", H1),
     Paragraph("Requested by: Sara Ali (fictional), IT Operations. Cost centre CC-4410 (sample).", BODY), Spacer(1, 6),
     Table(rows, colWidths=(12 * mm, 70 * mm, 15 * mm, 30 * mm, 35 * mm),
           style=[("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
                  ("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (2, 1), (-1, -1), "RIGHT")]), Spacer(1, 12),
     Paragraph("Approval chain", H2)]
appr = [["Step", "Role", "Action", "Signature"],
        ["1", "Line manager", "Review", "[SIGN-1]"],
        ["2", "Finance controller", "Approve", "[SIGN-2]"],
        ["3", "Head of IT", "Sign", "[SIGN-3]"]]
s += [Table(appr, colWidths=(12 * mm, 45 * mm, 25 * mm, 80 * mm), rowHeights=[8 * mm] + [16 * mm] * 3,
            style=[("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("FONTSIZE", (0, 0), (-1, -1), 9),
                   ("TEXTCOLOR", (3, 1), (3, -1), colors.lightgrey)])]
build("04_purchase_approval.pdf", s)
add("04_purchase_approval.pdf", "Purchase requisition approval", "Regex anchors in a table; review → approve → sign, all internal",
    [{"role": "line_manager", "kind": "internal", "purpose": "review", "order": 1},
     {"role": "finance_controller", "kind": "internal", "purpose": "approve", "order": 2},
     {"role": "head_of_it", "kind": "internal", "purpose": "sign", "order": 3}],
    [{"id": "SIGN_STEP", "regexp": "\\[SIGN-\\d\\]", "roleByMatchOrder": ["line_manager", "finance_controller", "head_of_it"],
      "type": "signature", "offset": {"percentX": 0.0, "percentY": -0.004, "percentWidth": 0.2, "percentHeight": 0.04}}],
    "anchors", "One regex returns three matches; map by order. Review purpose normally carries no signature field – tests what Circularo accepts.")

# ---------------------------------------------------------------- 05 Consent form (annotation fields)
s = [Paragraph("Customer Data Consent Form (sample)", H1),
     Paragraph("Please complete the details below and tick the boxes that apply.", BODY), Spacer(1, 8),
     sig_block([("Full name:", ""), ("Email:", ""), ("Phone:", ""), ("Company:", "")]), Spacer(1, 10),
     Paragraph("Consents", H2),
     Paragraph("[ ] I agree to the processing of my data for the purposes described.", BODY), Spacer(1, 4),
     Paragraph("[ ] I agree to receive service updates by email.", BODY), Spacer(1, 4),
     Paragraph("Preferred contact method:  Email  /  Phone", BODY), Spacer(1, 12),
     sig_block([("Customer Signature:", ""), ("Signed on:", "")])]
build("05_consent_form.pdf", s)
add("05_consent_form.pdf", "Customer consent form", "Fillable annotation fields placed by anchors: name, email, phone, company, checkboxes, date",
    [{"role": "customer", "kind": "external", "purpose": "sign", "order": 1, "protection": "email_otp"}],
    [{"id": "F_NAME", "text": "Full name:", "role": "customer", "type": "annotation", "subtype": "annotation_full_name", "offset": DATE_OFFSET},
     {"id": "F_MAIL", "text": "Email:", "role": "customer", "type": "annotation", "subtype": "annotation_mail", "offset": DATE_OFFSET},
     {"id": "F_PHONE", "text": "Phone:", "role": "customer", "type": "annotation", "subtype": "annotation_phone", "offset": DATE_OFFSET},
     {"id": "F_COMPANY", "text": "Company:", "role": "customer", "type": "annotation", "subtype": "annotation_company", "offset": DATE_OFFSET},
     {"id": "CHK_PROCESSING", "text": "I agree to the processing", "role": "customer", "type": "annotation", "subtype": "annotation_check",
      "offset": {"percentX": -0.03, "percentY": -0.002, "percentWidth": 0.02, "percentHeight": 0.015}},
     {"id": "CHK_UPDATES", "text": "I agree to receive service", "role": "customer", "type": "annotation", "subtype": "annotation_check",
      "offset": {"percentX": -0.03, "percentY": -0.002, "percentWidth": 0.02, "percentHeight": 0.015}},
     {"id": "SIG_CUSTOMER", "text": "Customer Signature:", "role": "customer", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "DATE_SIGNED", "text": "Signed on:", "role": "customer", "type": "annotation", "subtype": "annotation_date", "offset": DATE_OFFSET}],
    "anchors", "Subtype names from the Dynamic Word template docs; whether /share accepts them on signatureFields is to be verified.")

# ---------------------------------------------------------------- 06 Ad hoc memo (no anchors)
s = [Paragraph("Internal Memo (sample)", H1),
     Table([["To", "Operations team"], ["From", "Facilities (fictional)"], ["Date", "15 October 2026"], ["Subject", "Car park resurfacing works"]],
           colWidths=(25 * mm, 140 * mm), style=[("FONTSIZE", (0, 0), (-1, -1), 9), ("LINEBELOW", (0, -1), (-1, -1), 0.4, colors.grey)]),
     Spacer(1, 8)] + paras(6) + [Spacer(1, 30), Paragraph("Please acknowledge receipt.", BODY)]
build("06_adhoc_memo.pdf", s)
add("06_adhoc_memo.pdf", "Ad hoc memo", "No anchors at all – represents an arbitrary uploaded document",
    [{"role": "acknowledger", "kind": "internal", "purpose": "sign", "order": 1},
     {"role": "external_ack", "kind": "external", "purpose": "sign", "order": 2, "protection": "email_otp"}],
    [], "adhoc",
    "Tests ad hoc placement options: default position (last page, stacked per signer), Circularo signPrepare editor, or a TTA placement page.")

# ---------------------------------------------------------------- 07 Scanned letter (image only)
tmp = io.BytesIO()
build_tmp = SimpleDocTemplate(tmp, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=20 * mm)
build_tmp.build([Paragraph("Letter of Authority (scanned sample)", H1), Spacer(1, 6)] + paras(5) +
                [Spacer(1, 20), sig_block([("Authorised Signature:", ""), ("Date:", "")])], onFirstPage=footer, onLaterPages=footer)
import fitz  # PyMuPDF
src = fitz.open(stream=tmp.getvalue(), filetype="pdf")
dst = fitz.open()
for page in src:
    pix = page.get_pixmap(dpi=110, colorspace=fitz.csGRAY)
    p = dst.new_page(width=page.rect.width, height=page.rect.height)
    p.insert_image(p.rect, pixmap=pix)
dst.save(os.path.join(OUT, "07_scanned_letter.pdf"), deflate=True)
add("07_scanned_letter.pdf", "Scanned letter (image only)", "No text layer – anchors must find nothing",
    [{"role": "authoriser", "kind": "external", "purpose": "sign", "order": 1, "protection": "email_otp"}],
    [{"id": "SIG_AUTH", "text": "Authorised Signature:", "role": "authoriser", "type": "signature", "offset": RIGHT_OF_LABEL}],
    "anchors-expected-to-fail", "Expect anchorPositions empty → integration must fall back to ad hoc placement and report it.")

# ---------------------------------------------------------------- 08 Large document
s = [Paragraph("Facilities Management Master Agreement – Volume 1 (sample)", H1)]
for page in range(1, 40):
    s += [Paragraph(f"Part {page}", H2)] + paras(7, page) + [PageBreak()]
s += [Paragraph("Final execution", H2), Spacer(1, 6),
      sig_block([("Customer Authorised Signature:", ""), ("Supplier Authorised Signature:", "")])]
build("08_large_agreement_40p.pdf", s)
add("08_large_agreement_40p.pdf", "Large agreement (40 pages)", "Size/page-count handling, signature on the last page only",
    [{"role": "customer", "kind": "internal", "purpose": "sign", "order": 1},
     {"role": "supplier", "kind": "external", "purpose": "sign", "order": 2, "protection": "email_otp"}],
    [{"id": "SIG_CUSTOMER", "text": "Customer Authorised Signature:", "role": "customer", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "SIG_SUPPLIER", "text": "Supplier Authorised Signature:", "role": "supplier", "type": "signature", "offset": RIGHT_OF_LABEL}],
    "anchors", "40 pages; checks upload time, anchor scan time and download of the signed file.")

# ---------------------------------------------------------------- 09 Edge cases (bottom-right anchor, duplicate text)
def edge_page(c, doc):
    footer(c, doc)
    c.saveState()
    c.setFont("Helvetica-Bold", 9)
    c.drawRightString(200 * mm, 18 * mm, "Sign here:")   # near the bottom-right corner
    c.restoreState()

s = [Paragraph("Anchor Edge Cases (sample)", H1),
     Paragraph("The word Approver appears several times: Approver one, Approver two, and Approver three are listed only for testing.", BODY),
     Spacer(1, 6)] + paras(4) + [Spacer(1, 10), sig_block([("Approver Signature:", "")])]
build("09_anchor_edge_cases.pdf", s, onpage=edge_page)
add("09_anchor_edge_cases.pdf", "Anchor edge cases", "Anchor near page edge (offset pushes past 1.0 → must be clamped) and ambiguous repeated text",
    [{"role": "approver", "kind": "internal", "purpose": "sign", "order": 1}],
    [{"id": "SIG_EDGE", "text": "Sign here:", "role": "approver", "type": "signature", "offset": RIGHT_OF_LABEL},
     {"id": "SIG_AMBIGUOUS", "text": "Approver", "role": "approver", "type": "initials", "offset": INITIALS_OFFSET},
     {"id": "SIG_PROPER", "text": "Approver Signature:", "role": "approver", "type": "signature", "offset": RIGHT_OF_LABEL}],
    "anchors", "Expect SIG_EDGE x > 1 (clamp), SIG_AMBIGUOUS many matches (reject or take first, configurable).")

with open(os.path.join(OUT, "manifest_pdf.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
print("PDF samples:", len(manifest))
