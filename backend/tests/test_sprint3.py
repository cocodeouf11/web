"""Sprint 3 backend tests:
- Bug fix: signing multi-page PDFs with field+sig only on page 1 (no Sequence index OOR)
- POST /api/files/{id}/link-attestation
- POST /api/files/{id}/link-existing
- signed_filename = "{parent_base}+{child_base}.pdf"
- direct unit test of _build_overlay_pdf with 3-page PDF
"""
import io
import os
import base64
import pytest
import requests
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.pagesizes import A4

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"username": "admin", "password": "admin123"}

# Small 1x1 transparent PNG
SIG_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)
SIG_DATA_URL = f"data:image/png;base64,{SIG_PNG}"


def _make_multipage_pdf(npages: int = 3) -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    for i in range(npages):
        c.drawString(72, 770, f"Page {i+1}")
        c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return s


# ---------- Unit test: _build_overlay_pdf with multi-page PDF (the original bug) ----------
def test_build_overlay_multipage_no_index_error():
    import sys
    sys.path.insert(0, "/app/backend")
    from server import _build_overlay_pdf  # type: ignore
    from pypdf import PdfReader

    pdf_in = _make_multipage_pdf(3)
    fields = [
        {"name": "nom", "label": "Nom", "type": "text", "page": 1, "x": 100, "y": 700, "width": 200, "height": 14},
        {"name": "__signature__", "label": "Signature", "type": "signature",
         "page": 1, "x": 100, "y": 100, "width": 200, "height": 60},
    ]
    sig_bytes = base64.b64decode(SIG_PNG)
    out_bytes = _build_overlay_pdf(pdf_in, signature_png_bytes=sig_bytes,
                                   fields=fields, field_values={"nom": "Jean"})
    assert out_bytes and len(out_bytes) > 100
    r = PdfReader(io.BytesIO(out_bytes))
    assert len(r.pages) == 3, f"Expected 3 pages in signed output, got {len(r.pages)}"


# ---------- POST /api/files/{id}/link-attestation ----------
@pytest.fixture(scope="module")
def parent_file(session):
    pdf = _make_multipage_pdf(1)
    r = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_parent_s3.pdf", pdf, "application/pdf")},
        data={"document_type": "Devis"},
    )
    assert r.status_code == 200, r.text
    parent = r.json()
    pid = parent["id"]
    # generate code
    r = session.post(f"{API}/files/{pid}/generate-code")
    assert r.status_code == 200
    code = r.json()["access_code"]
    yield {"id": pid, "code": code, "filename": "TEST_parent_s3.pdf"}
    # cleanup children + parent
    try:
        kids = session.get(f"{API}/files/{pid}/linked").json()
        for k in kids:
            session.delete(f"{API}/files/{k['id']}")
    except Exception:
        pass
    session.delete(f"{API}/files/{pid}")


def test_link_attestation_creates_child_with_8_fields(session, parent_file):
    r = session.post(f"{API}/files/{parent_file['id']}/link-attestation")
    assert r.status_code == 200, r.text
    child = r.json()
    assert child["filename"] == "attestation_simplifiee.pdf"
    assert child["document_type"] == "Attestation Simplifiée"
    assert child["parent_file_id"] == parent_file["id"]
    fields = child.get("fields") or []
    assert isinstance(fields, list)
    assert len(fields) == 8, f"expected 8 fields, got {len(fields)}: {[f.get('name') for f in fields]}"
    names = {f["name"] for f in fields}
    assert {"nom", "prenom", "adresse", "code_postal", "commune", "fait_a", "le_date", "__signature__"} <= names
    sig = next(f for f in fields if f["type"] == "signature")
    assert sig["page"] == 1
    parent_file["attestation_child_id"] = child["id"]


def test_link_attestation_refuses_duplicate(session, parent_file):
    r = session.post(f"{API}/files/{parent_file['id']}/link-attestation")
    assert r.status_code == 400, r.text


def test_link_attestation_missing_parent(session):
    r = session.post(f"{API}/files/nonexistent-id-xyz/link-attestation")
    assert r.status_code == 404


# ---------- POST /api/files/{id}/link-existing ----------
def test_link_existing_attaches_child(session):
    pdf_p = _make_multipage_pdf(1)
    p = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_le_parent.pdf", pdf_p, "application/pdf")},
        data={"document_type": "Devis"},
    ).json()
    pid = p["id"]

    pdf_c = _make_multipage_pdf(1)
    c = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_le_child.pdf", pdf_c, "application/pdf")},
        data={"document_type": "Devis"},
    ).json()
    cid = c["id"]
    # Give child its own code; link-existing should clear it
    r = session.post(f"{API}/files/{cid}/generate-code")
    assert r.status_code == 200

    r = session.post(f"{API}/files/{pid}/link-existing", json={"child_id": cid})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("parent_id") == pid and body.get("child_id") == cid

    # Verify child now has parent and no access code
    files = session.get(f"{API}/files").json()
    child = next(x for x in files if x["id"] == cid)
    assert child["parent_file_id"] == pid
    assert not child.get("access_code")

    # Duplicate link should fail (child already has parent)
    pdf_p2 = _make_multipage_pdf(1)
    p2 = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_le_parent2.pdf", pdf_p2, "application/pdf")},
        data={"document_type": "Devis"},
    ).json()
    r = session.post(f"{API}/files/{p2['id']}/link-existing", json={"child_id": cid})
    assert r.status_code == 400

    # Self-link should fail
    r = session.post(f"{API}/files/{pid}/link-existing", json={"child_id": pid})
    assert r.status_code == 400

    # cleanup
    session.delete(f"{API}/files/{cid}")
    session.delete(f"{API}/files/{pid}")
    session.delete(f"{API}/files/{p2['id']}")


# ---------- BUG fix end-to-end: sign attestation linked to parent ----------
def test_sign_with_attestation_multi_page(session):
    """Reproduces the bug_002 scenario: parent + attestation (3 pages) → sign → 200."""
    pdf_p = _make_multipage_pdf(1)
    p = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_sign_parent.pdf", pdf_p, "application/pdf")},
        data={"document_type": "Devis"},
    ).json()
    pid = p["id"]
    code = session.post(f"{API}/files/{pid}/generate-code").json()["access_code"]
    r = session.post(f"{API}/files/{pid}/link-attestation")
    assert r.status_code == 200, r.text
    child = r.json()
    cid = child["id"]

    # Sign with field_values for all required text fields
    payload = {
        "signature_data_url": SIG_DATA_URL,
        "field_values": {
            "nom": "Dupont",
            "prenom": "Jean",
            "adresse": "12 Rue Test",
            "code_postal": "75001",
            "commune": "Paris",
            "fait_a": "Paris",
        },
    }
    r = requests.post(f"{API}/access/sign/{code}", json=payload)
    assert r.status_code == 200, f"SIGN FAILED: {r.status_code} {r.text}"
    body = r.json()
    docs_signed = body.get("documents_signed", 0)
    assert docs_signed >= 2, body

    # signed_filename for child should be "{parent_base}+attestation_simplifiee.pdf"
    files = session.get(f"{API}/files").json()
    child_db = next(x for x in files if x["id"] == cid)
    expected = "TEST_sign_parent+attestation_simplifiee.pdf"
    # field may be at top level (file_to_dict) — check both
    sname = child_db.get("signed_filename")
    assert sname == expected, f"signed_filename mismatch: got {sname!r} expected {expected!r}"

    # GET /api/access/file/{code} should show signed filename for child
    pub = requests.get(f"{API}/access/file/{code}").json()
    docs = pub["documents"]
    assert len(docs) == 2
    child_doc = next(d for d in docs if d["id"] == cid)
    assert child_doc["filename"] == expected

    # Admin download with signed=true returns JSON {filename, content_b64} using signed_filename
    r = session.get(f"{API}/files/{cid}/download?signed=true")
    assert r.status_code == 200, r.text
    dl = r.json()
    assert dl["filename"] == expected, f"download filename: {dl['filename']!r}"

    # Verify the signed PDF still has 3 pages (the original bug would have crashed)
    from pypdf import PdfReader
    signed_bytes = base64.b64decode(dl["content_b64"])
    pages = len(PdfReader(io.BytesIO(signed_bytes)).pages)
    assert pages == 3, f"Expected 3 pages preserved, got {pages}"

    # cleanup
    session.delete(f"{API}/files/{cid}")
    session.delete(f"{API}/files/{pid}")
