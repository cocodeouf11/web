"""Sprint 2 backend regression tests.

Covers:
- Linking child files via POST /api/files/upload with parent_id
- GET /api/access/file/{code} returns parent + children
- PATCH /api/files/{id}/fields with a 'signature' field
- Sign-all flow (multi-doc) via POST /api/access/sign/{code}
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


def _make_pdf(text: str = "Sprint2 PDF") -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.drawString(72, 770, text)
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, f"admin login failed {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def parent_and_child(session):
    # Upload parent
    pdf1 = _make_pdf("Parent doc")
    r = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_parent.pdf", pdf1, "application/pdf")},
        data={"document_type": "Devis"},
    )
    assert r.status_code == 200, r.text
    parent = r.json()
    pid = parent["id"]

    # Generate code
    r = session.post(f"{API}/files/{pid}/generate-code")
    assert r.status_code == 200, r.text
    code = r.json()["access_code"]

    # Upload child linked to parent
    pdf2 = _make_pdf("Child doc")
    r = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_child.pdf", pdf2, "application/pdf")},
        data={"document_type": "Devis", "parent_id": pid},
    )
    assert r.status_code == 200, r.text
    child = r.json()
    cid = child["id"]
    assert child.get("parent_file_id") == pid

    yield {"parent_id": pid, "child_id": cid, "code": code}

    # cleanup
    for _id in (cid, pid):
        try:
            session.delete(f"{API}/files/{_id}")
        except Exception:
            pass


# ---- Tests ----

def test_link_child_visible_via_admin_list(session, parent_and_child):
    r = session.get(f"{API}/files/{parent_and_child['parent_id']}/linked")
    assert r.status_code == 200
    children = r.json()
    ids = [c["id"] for c in children]
    assert parent_and_child["child_id"] in ids


def test_access_file_returns_parent_plus_children(parent_and_child):
    r = requests.get(f"{API}/access/file/{parent_and_child['code']}")
    assert r.status_code == 200, r.text
    data = r.json()
    # Endpoint may return either dict with 'documents' list or list of files
    if isinstance(data, dict) and "documents" in data:
        docs = data["documents"]
    elif isinstance(data, list):
        docs = data
    else:
        docs = [data]
    assert len(docs) >= 2, f"expected parent+child, got {len(docs)}: {docs}"
    for d in docs:
        assert "content_b64" in d
        assert d["content_b64"]
        # _id (Mongo) must NOT leak
        assert "_id" not in d


def test_patch_fields_with_signature_field(session, parent_and_child):
    pid = parent_and_child["parent_id"]
    payload = {
        "fields": [
            {
                "name": "__signature__",
                "label": "Signature",
                "type": "signature",
                "page": 1,
                "x": 100, "y": 100, "width": 220, "height": 80,
                "required": True,
            }
        ]
    }
    r = session.patch(f"{API}/files/{pid}/fields", json=payload)
    assert r.status_code == 200, r.text
    assert r.json().get("count") == 1

    # GET file via admin list to verify persistence
    r = session.get(f"{API}/files")
    assert r.status_code == 200
    parent = next((x for x in r.json() if x["id"] == pid), None)
    assert parent is not None
    fields = parent.get("fields") or []
    sigs = [f for f in fields if f.get("type") == "signature"]
    assert len(sigs) == 1
    assert sigs[0]["x"] == 100 and sigs[0]["width"] == 220


def test_patch_fields_can_clear_signature(session, parent_and_child):
    pid = parent_and_child["parent_id"]
    r = session.patch(f"{API}/files/{pid}/fields", json={"fields": []})
    assert r.status_code == 200
    r = session.get(f"{API}/files")
    parent = next(x for x in r.json() if x["id"] == pid)
    assert (parent.get("fields") or []) == []


def test_sign_multi_doc(session):
    """End-to-end: parent + child, then sign once → both become signed."""
    # Build fresh pair to avoid interfering with other tests
    pdf1 = _make_pdf("MultiP")
    r = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_mp.pdf", pdf1, "application/pdf")},
        data={"document_type": "Devis"},
    )
    pid = r.json()["id"]
    code = session.post(f"{API}/files/{pid}/generate-code").json()["access_code"]

    pdf2 = _make_pdf("MultiC")
    r = session.post(
        f"{API}/files/upload",
        files={"file": ("TEST_mc.pdf", pdf2, "application/pdf")},
        data={"document_type": "Devis", "parent_id": pid},
    )
    cid = r.json()["id"]

    # 1x1 png signature
    png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
    )
    sig_data_url = f"data:image/png;base64,{png_b64}"

    r = requests.post(
        f"{API}/access/sign/{code}",
        json={"signature_data_url": sig_data_url, "field_values": {}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # backend may return documents_signed or signed count
    signed = body.get("documents_signed") or body.get("count") or 0
    if not signed:
        # fall back: check both files status via admin
        r2 = session.get(f"{API}/files")
        statuses = {x["id"]: x["status"] for x in r2.json() if x["id"] in (pid, cid)}
        assert statuses.get(pid) == "signed" and statuses.get(cid) == "signed", statuses
    else:
        assert signed >= 2, f"expected >=2 signed docs, got {signed}"

    # cleanup
    for _id in (cid, pid):
        session.delete(f"{API}/files/{_id}")
