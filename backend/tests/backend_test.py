"""Backend API tests for PDF Quote Signature platform."""
import os, io, base64, re, pytest, requests
from reportlab.pdfgen import canvas as rl_canvas
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://quote-vault-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _make_pdf() -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf)
    c.drawString(100, 750, "TEST PDF")
    c.save()
    return buf.getvalue()


def _make_png_data_url() -> str:
    img = Image.new("RGBA", (100, 50), (0, 0, 0, 0))
    for x in range(100):
        img.putpixel((x, 25), (0, 0, 0, 255))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


@pytest.fixture(scope="session")
def session():
    return requests.Session()


@pytest.fixture(scope="session")
def auth(session):
    r = session.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "cookies": session.cookies}


@pytest.fixture(scope="session")
def headers(auth):
    return {"Authorization": f"Bearer {auth['token']}"}


# ---- Auth ----
class TestAuth:
    def test_health(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200

    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        d = r.json()
        assert d["username"] == "admin"
        assert "token" in d and len(d["token"]) > 10
        assert "access_token" in r.cookies

    def test_login_wrong(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_me_with_token(self, headers):
        r = requests.get(f"{API}/auth/me", headers=headers)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_files_unauth(self):
        r = requests.get(f"{API}/files")
        assert r.status_code == 401


# ---- Files Admin ----
class TestFiles:
    def test_full_flow(self, headers):
        # Upload
        pdf = _make_pdf()
        r = requests.post(f"{API}/files/upload", headers=headers,
                          files={"file": ("test.pdf", pdf, "application/pdf")})
        assert r.status_code == 200, r.text
        f = r.json()
        assert f["filename"] == "test.pdf"
        assert f["status"] == "unsigned"
        fid = f["id"]

        # Reject non-pdf
        r2 = requests.post(f"{API}/files/upload", headers=headers,
                           files={"file": ("a.txt", b"hello", "text/plain")})
        assert r2.status_code == 400

        # List - no _id leak
        r = requests.get(f"{API}/files", headers=headers)
        assert r.status_code == 200
        listing = r.json()
        assert any(x["id"] == fid for x in listing)
        for x in listing:
            assert "_id" not in x
            assert "content_b64" not in x

        # Generate code
        r = requests.post(f"{API}/files/{fid}/generate-code", headers=headers)
        assert r.status_code == 200
        code = r.json()["access_code"]
        assert re.match(r"^DEV-\d{5}-[A-Z]{2}$", code), code

        # Public verify
        r = requests.post(f"{API}/access/verify", json={"code": code})
        assert r.status_code == 200
        assert r.json()["id"] == fid

        # Public verify invalid
        r = requests.post(f"{API}/access/verify", json={"code": "DEV-00000-ZZ"})
        assert r.status_code == 404

        # Public file fetch
        r = requests.get(f"{API}/access/file/{code}")
        assert r.status_code == 200
        assert r.json()["status"] == "unsigned"
        assert "content_b64" in r.json()

        # Sign
        r = requests.post(f"{API}/access/sign/{code}", json={"signature_data_url": _make_png_data_url()})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "signed"

        # Double sign
        r = requests.post(f"{API}/access/sign/{code}", json={"signature_data_url": _make_png_data_url()})
        assert r.status_code == 400

        # Verify status updated
        r = requests.post(f"{API}/access/verify", json={"code": code})
        assert r.json()["status"] == "signed"

        # PATCH status (toggle back)
        r = requests.patch(f"{API}/files/{fid}/status", headers=headers, json={"status": "unsigned"})
        assert r.status_code == 200
        assert r.json()["status"] == "unsigned"

        # Bad status
        r = requests.patch(f"{API}/files/{fid}/status", headers=headers, json={"status": "bogus"})
        assert r.status_code == 400

        # Delete
        r = requests.delete(f"{API}/files/{fid}", headers=headers)
        assert r.status_code == 200

        # Delete again -> 404
        r = requests.delete(f"{API}/files/{fid}", headers=headers)
        assert r.status_code == 404
