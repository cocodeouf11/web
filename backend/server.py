from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import uuid
import base64
import random
import string
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader

# ---------- DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------- Constants ----------
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# ---------- App ----------
app = FastAPI()
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO)


# ---------- Helpers ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, username: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def generate_access_code() -> str:
    """Format DEV-XXXXX-XX with digits and uppercase letters."""
    part1 = ''.join(random.choices(string.digits, k=5))
    part2 = ''.join(random.choices(string.ascii_uppercase, k=2))
    return f"DEV-{part1}-{part2}"


async def get_current_admin(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_super_admin(user=Depends(get_current_admin)) -> dict:
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Réservé au super admin")
    return user


def _files_scope(user: dict) -> dict:
    """Return a Mongo filter that scopes files to the current user (super_admin sees all)."""
    if user.get("role") == "super_admin":
        return {}
    return {"created_by": user["id"]}


# ---------- Models ----------
class LoginInput(BaseModel):
    username: str
    password: str


class FileMeta(BaseModel):
    id: str
    filename: str
    created_at: str
    status: str  # "unsigned" | "signed"
    access_code: Optional[str] = None
    size: int


class StatusUpdate(BaseModel):
    status: str  # "signed" | "unsigned"


class CodeVerify(BaseModel):
    code: str


class SignInput(BaseModel):
    signature_data_url: str  # data:image/png;base64,...


class UserCreate(BaseModel):
    username: str
    password: str


class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


# ---------- Auth Endpoints ----------
@api_router.post("/auth/login")
async def login(payload: LoginInput, response: Response):
    username = payload.username.strip().lower()
    user = await db.users.find_one({"username": username})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Identifiants invalides")
    token = create_access_token(user["id"], user["username"])
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=8 * 3600,
        path="/",
    )
    return {"id": user["id"], "username": user["username"], "role": user.get("role", "gestionnaire"), "token": token}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user=Depends(get_current_admin)):
    return user


# ---------- Files (Admin) Endpoints ----------
@api_router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    user=Depends(get_current_admin),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Seuls les fichiers PDF sont acceptés")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (max 10MB)")

    file_id = str(uuid.uuid4())
    doc = {
        "id": file_id,
        "filename": file.filename,
        "content_b64": base64.b64encode(content).decode("utf-8"),
        "size": len(content),
        "status": "unsigned",
        "access_code": None,
        "created_by": user["id"],
        "created_by_username": user["username"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "signed_at": None,
        "signed_content_b64": None,
    }
    await db.files.insert_one(doc)
    return {
        "id": file_id,
        "filename": file.filename,
        "status": "unsigned",
        "access_code": None,
        "size": len(content),
        "created_at": doc["created_at"],
        "created_by_username": user["username"],
    }


@api_router.get("/files")
async def list_files(user=Depends(get_current_admin)):
    cursor = db.files.find(
        _files_scope(user),
        {"_id": 0, "content_b64": 0, "signed_content_b64": 0},
    ).sort("created_at", -1)
    files = await cursor.to_list(1000)
    return files


@api_router.get("/files/{file_id}")
async def get_file_meta(file_id: str, user=Depends(get_current_admin)):
    f = await db.files.find_one(
        {"id": file_id, **_files_scope(user)},
        {"_id": 0, "content_b64": 0, "signed_content_b64": 0},
    )
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    return f


@api_router.get("/files/{file_id}/download")
async def download_file(file_id: str, signed: bool = False, user=Depends(get_current_admin)):
    f = await db.files.find_one({"id": file_id, **_files_scope(user)})
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    content_b64 = f.get("signed_content_b64") if signed and f.get("signed_content_b64") else f["content_b64"]
    return {"filename": f["filename"], "content_b64": content_b64}


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, user=Depends(get_current_admin)):
    res = await db.files.delete_one({"id": file_id, **_files_scope(user)})
    if res.deleted_count == 0:
        raise HTTPException(404, "Fichier introuvable")
    return {"ok": True}


@api_router.patch("/files/{file_id}/status")
async def update_status(file_id: str, payload: StatusUpdate, user=Depends(get_current_admin)):
    if payload.status not in ("signed", "unsigned"):
        raise HTTPException(400, "Statut invalide")
    res = await db.files.update_one(
        {"id": file_id, **_files_scope(user)},
        {"$set": {"status": payload.status}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Fichier introuvable")
    return {"ok": True, "status": payload.status}


@api_router.post("/files/{file_id}/generate-code")
async def generate_code(file_id: str, user=Depends(get_current_admin)):
    f = await db.files.find_one({"id": file_id, **_files_scope(user)}, {"_id": 0})
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    # generate unique code
    for _ in range(20):
        code = generate_access_code()
        existing = await db.files.find_one({"access_code": code})
        if not existing:
            break
    else:
        raise HTTPException(500, "Impossible de générer un code unique")
    await db.files.update_one({"id": file_id}, {"$set": {"access_code": code}})
    return {"access_code": code}


# ---------- Signer (Public) Endpoints ----------
@api_router.post("/access/verify")
async def verify_code(payload: CodeVerify):
    code = payload.code.strip().upper()
    f = await db.files.find_one(
        {"access_code": code},
        {"_id": 0, "content_b64": 0, "signed_content_b64": 0},
    )
    if not f:
        raise HTTPException(404, "Code d'accès invalide")
    return {"id": f["id"], "filename": f["filename"], "status": f["status"], "access_code": code}


@api_router.get("/access/file/{code}")
async def get_file_by_code(code: str):
    code = code.strip().upper()
    f = await db.files.find_one({"access_code": code})
    if not f:
        raise HTTPException(404, "Code d'accès invalide")
    content_b64 = f.get("signed_content_b64") if f["status"] == "signed" and f.get("signed_content_b64") else f["content_b64"]
    return {
        "id": f["id"],
        "filename": f["filename"],
        "status": f["status"],
        "content_b64": content_b64,
    }


def _embed_signature_in_pdf(pdf_bytes: bytes, signature_png_bytes: bytes) -> bytes:
    """Add signature image to the bottom-right of the last page of the PDF."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()

    # Build overlay PDF for the last page
    last_page = reader.pages[-1]
    media = last_page.mediabox
    width = float(media.width)
    height = float(media.height)

    # Open signature
    sig_img = Image.open(io.BytesIO(signature_png_bytes)).convert("RGBA")
    sig_w, sig_h = sig_img.size
    target_w = min(220.0, width * 0.4)
    aspect = sig_h / sig_w if sig_w else 1
    target_h = target_w * aspect

    overlay_buf = io.BytesIO()
    c = rl_canvas.Canvas(overlay_buf, pagesize=(width, height))
    margin = 36.0
    x = width - target_w - margin
    y = margin
    c.drawImage(ImageReader(sig_img), x, y, width=target_w, height=target_h, mask='auto')
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    c.drawString(x, y - 10, f"Signé le {timestamp}")
    c.save()

    overlay_reader = PdfReader(io.BytesIO(overlay_buf.getvalue()))
    overlay_page = overlay_reader.pages[0]

    for i, page in enumerate(reader.pages):
        if i == len(reader.pages) - 1:
            page.merge_page(overlay_page)
        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@api_router.post("/access/sign/{code}")
async def sign_file(code: str, payload: SignInput):
    code = code.strip().upper()
    f = await db.files.find_one({"access_code": code})
    if not f:
        raise HTTPException(404, "Code d'accès invalide")
    if f["status"] == "signed":
        raise HTTPException(400, "Ce document a déjà été signé")

    # Parse signature data url
    data_url = payload.signature_data_url
    if "," not in data_url:
        raise HTTPException(400, "Signature invalide")
    header, b64 = data_url.split(",", 1)
    try:
        sig_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(400, "Signature invalide")

    pdf_bytes = base64.b64decode(f["content_b64"])
    try:
        signed_pdf = _embed_signature_in_pdf(pdf_bytes, sig_bytes)
    except Exception as e:
        logger.exception("Erreur signature")
        raise HTTPException(500, f"Erreur lors de la signature: {e}")

    signed_b64 = base64.b64encode(signed_pdf).decode("utf-8")
    now = datetime.now(timezone.utc).isoformat()
    await db.files.update_one(
        {"id": f["id"]},
        {"$set": {"status": "signed", "signed_content_b64": signed_b64, "signed_at": now}},
    )
    return {"ok": True, "status": "signed", "signed_at": now}


# ---------- Health ----------
@api_router.get("/")
async def root():
    return {"message": "Devis Signature API", "ok": True}


# ---------- User Management (super_admin only) ----------
@api_router.get("/users")
async def list_users(user=Depends(require_super_admin)):
    cursor = db.users.find(
        {"role": {"$ne": "super_admin"}},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", -1)
    users = await cursor.to_list(1000)
    # attach file count for each user
    for u in users:
        u["files_count"] = await db.files.count_documents({"created_by": u["id"]})
    return users


@api_router.post("/users")
async def create_user(payload: UserCreate, user=Depends(require_super_admin)):
    username = payload.username.strip().lower()
    if not username or len(username) < 3:
        raise HTTPException(400, "Nom d'utilisateur trop court (min 3 caractères)")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(400, "Mot de passe trop court (min 6 caractères)")
    existing = await db.users.find_one({"username": username})
    if existing:
        raise HTTPException(400, "Ce nom d'utilisateur existe déjà")
    new_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": new_id,
        "username": username,
        "password_hash": hash_password(payload.password),
        "role": "gestionnaire",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"id": new_id, "username": username, "role": "gestionnaire"}


@api_router.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, user=Depends(require_super_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    if target.get("role") == "super_admin":
        raise HTTPException(403, "Impossible de modifier un super admin")
    updates = {}
    if payload.username is not None:
        new_username = payload.username.strip().lower()
        if len(new_username) < 3:
            raise HTTPException(400, "Nom d'utilisateur trop court")
        if new_username != target["username"]:
            clash = await db.users.find_one({"username": new_username})
            if clash:
                raise HTTPException(400, "Ce nom d'utilisateur existe déjà")
            updates["username"] = new_username
    if payload.password is not None and payload.password != "":
        if len(payload.password) < 6:
            raise HTTPException(400, "Mot de passe trop court (min 6 caractères)")
        updates["password_hash"] = hash_password(payload.password)
    if not updates:
        return {"ok": True, "updated": False}
    await db.users.update_one({"id": user_id}, {"$set": updates})
    # propagate username change to files
    if "username" in updates:
        await db.files.update_many(
            {"created_by": user_id},
            {"$set": {"created_by_username": updates["username"]}},
        )
    return {"ok": True, "updated": True}


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_super_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    if target.get("role") == "super_admin":
        raise HTTPException(403, "Impossible de supprimer un super admin")
    if target["id"] == user["id"]:
        raise HTTPException(400, "Impossible de se supprimer soi-même")
    await db.users.delete_one({"id": user_id})
    # delete files owned by this user
    await db.files.delete_many({"created_by": user_id})
    return {"ok": True}


# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    # Indexes
    await db.users.create_index("username", unique=True)
    await db.files.create_index("id", unique=True)
    # access_code unique only when set (partial filter excludes null/missing).
    # Drop legacy sparse index if present (sparse doesn't ignore null values).
    try:
        existing_indexes = await db.files.index_information()
        if "access_code_1" in existing_indexes and not existing_indexes["access_code_1"].get("partialFilterExpression"):
            await db.files.drop_index("access_code_1")
    except Exception as e:
        logger.warning(f"Could not inspect/drop access_code index: {e}")
    await db.files.create_index(
        "access_code",
        unique=True,
        partialFilterExpression={"access_code": {"$type": "string"}},
    )

    # Seed super admin
    username = ADMIN_USERNAME.strip().lower()
    existing = await db.users.find_one({"username": username})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "username": username,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "super_admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded super_admin user: {username}")
    else:
        # Ensure existing admin has the super_admin role and correct password
        updates = {}
        if existing.get("role") != "super_admin":
            updates["role"] = "super_admin"
        if not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
            updates["password_hash"] = hash_password(ADMIN_PASSWORD)
        if updates:
            await db.users.update_one({"username": username}, {"$set": updates})
            logger.info(f"Updated super_admin user: {username}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ---------- Mount router & CORS ----------
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
