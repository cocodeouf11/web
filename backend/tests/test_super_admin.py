"""Tests for new super_admin & multi-user features."""
import os, io, base64, uuid, pytest, requests
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


# -------- Fixtures --------
@pytest.fixture(scope="module")
def super_token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "super_admin", f"expected super_admin role, got {d.get('role')}"
    return d["token"]


@pytest.fixture(scope="module")
def super_h(super_token):
    return {"Authorization": f"Bearer {super_token}"}


@pytest.fixture(scope="module")
def gestionnaire(super_h):
    """Create a gestionnaire 'TEST_mgr_<rand>' & return its credentials/token."""
    suffix = uuid.uuid4().hex[:6]
    username = f"test_mgr_{suffix}"  # backend lowercases
    password = "secret123"
    r = requests.post(f"{API}/users", headers=super_h, json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    user = r.json()
    assert user["role"] == "gestionnaire"
    assert user["username"] == username
    user_id = user["id"]

    # login as the new gestionnaire
    r2 = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d["role"] == "gestionnaire"
    yield {"id": user_id, "username": username, "password": password, "token": d["token"]}

    # teardown: delete (idempotent)
    requests.delete(f"{API}/users/{user_id}", headers=super_h)


# -------- Tests --------
class TestSuperAdminLogin:
    def test_admin_role_is_super_admin(self, super_token):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {super_token}"})
        assert r.status_code == 200
        assert r.json()["role"] == "super_admin"


class TestUserManagement:
    def test_list_users_excludes_super_admin(self, super_h, gestionnaire):
        r = requests.get(f"{API}/users", headers=super_h)
        assert r.status_code == 200
        users = r.json()
        assert all(u.get("role") != "super_admin" for u in users)
        assert all("password_hash" not in u for u in users)
        assert all("_id" not in u for u in users)
        assert all("files_count" in u for u in users)
        assert any(u["id"] == gestionnaire["id"] for u in users)

    def test_create_duplicate_username_400(self, super_h, gestionnaire):
        r = requests.post(f"{API}/users", headers=super_h,
                          json={"username": gestionnaire["username"], "password": "anotherpw"})
        assert r.status_code == 400

    def test_create_too_short_password(self, super_h):
        r = requests.post(f"{API}/users", headers=super_h,
                          json={"username": f"test_short_{uuid.uuid4().hex[:4]}", "password": "12"})
        assert r.status_code == 400

    def test_patch_username_and_password(self, super_h, gestionnaire):
        new_username = f"test_renamed_{uuid.uuid4().hex[:4]}"
        new_password = "newsecret456"
        r = requests.patch(f"{API}/users/{gestionnaire['id']}", headers=super_h,
                           json={"username": new_username, "password": new_password})
        assert r.status_code == 200, r.text

        # old creds should fail
        r1 = requests.post(f"{API}/auth/login", json={"username": gestionnaire["username"], "password": gestionnaire["password"]})
        assert r1.status_code == 401

        # new creds should work
        r2 = requests.post(f"{API}/auth/login", json={"username": new_username, "password": new_password})
        assert r2.status_code == 200
        # update fixture-shared creds for downstream cleanup
        gestionnaire["username"] = new_username
        gestionnaire["password"] = new_password
        gestionnaire["token"] = r2.json()["token"]

    def test_patch_super_admin_forbidden(self, super_h):
        r = requests.get(f"{API}/auth/me", headers=super_h)
        super_id = r.json()["id"]
        r2 = requests.patch(f"{API}/users/{super_id}", headers=super_h, json={"password": "abcdef"})
        assert r2.status_code == 403

    def test_users_endpoint_forbidden_for_gestionnaire(self, gestionnaire):
        h = {"Authorization": f"Bearer {gestionnaire['token']}"}
        for m, ep in [("get", "/users"), ("post", "/users")]:
            r = getattr(requests, m)(f"{API}{ep}", headers=h, json={"username": "x", "password": "y"})
            assert r.status_code == 403, f"{m} {ep} -> {r.status_code}"
        r = requests.patch(f"{API}/users/{gestionnaire['id']}", headers=h, json={"password": "x"})
        assert r.status_code == 403
        r = requests.delete(f"{API}/users/{gestionnaire['id']}", headers=h)
        assert r.status_code == 403


class TestFileScoping:
    def test_file_scoping_and_cascade_delete(self, super_h, super_token):
        # super uploads
        super_pdf = _make_pdf()
        r = requests.post(f"{API}/files/upload", headers=super_h,
                          files={"file": ("super.pdf", super_pdf, "application/pdf")})
        assert r.status_code == 200, r.text
        super_file = r.json()
        assert super_file["created_by_username"] == "admin"
        super_file_id = super_file["id"]

        # create a fresh gestionnaire (separate from module fixture for isolation)
        suffix = uuid.uuid4().hex[:6]
        username = f"test_scope_{suffix}"
        password = "scopepw123"
        r = requests.post(f"{API}/users", headers=super_h,
                          json={"username": username, "password": password})
        assert r.status_code == 200
        gid = r.json()["id"]
        gtoken = requests.post(f"{API}/auth/login", json={"username": username, "password": password}).json()["token"]
        gh = {"Authorization": f"Bearer {gtoken}"}

        # gestionnaire's file list should NOT contain super's file
        r = requests.get(f"{API}/files", headers=gh)
        assert r.status_code == 200
        ids = [f["id"] for f in r.json()]
        assert super_file_id not in ids, "Gestionnaire should not see super_admin's files"

        # gestionnaire uploads
        r = requests.post(f"{API}/files/upload", headers=gh,
                          files={"file": ("g.pdf", _make_pdf(), "application/pdf")})
        assert r.status_code == 200
        gfile = r.json()
        gfile_id = gfile["id"]
        assert gfile["created_by_username"] == username

        # super_admin sees both files
        r = requests.get(f"{API}/files", headers=super_h)
        assert r.status_code == 200
        ids = [f["id"] for f in r.json()]
        assert super_file_id in ids
        assert gfile_id in ids
        # check created_by_username present
        for f in r.json():
            if f["id"] == gfile_id:
                assert f.get("created_by_username") == username

        # gestionnaire delete on super's file -> 404
        r = requests.delete(f"{API}/files/{super_file_id}", headers=gh)
        assert r.status_code == 404

        # gestionnaire generate-code on super's file -> 404
        r = requests.post(f"{API}/files/{super_file_id}/generate-code", headers=gh)
        assert r.status_code == 404

        # gestionnaire GET /files/{super_id} -> 404
        r = requests.get(f"{API}/files/{super_file_id}", headers=gh)
        assert r.status_code == 404

        # delete user -> file should cascade-delete
        r = requests.delete(f"{API}/users/{gid}", headers=super_h)
        assert r.status_code == 200

        # super_admin should NOT see gfile anymore
        r = requests.get(f"{API}/files", headers=super_h)
        assert gfile_id not in [f["id"] for f in r.json()], "Cascade delete failed"

        # cleanup super's file
        requests.delete(f"{API}/files/{super_file_id}", headers=super_h)
