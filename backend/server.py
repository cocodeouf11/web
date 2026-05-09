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
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File as UploadFileParam
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader

from db import init_db, AsyncSessionLocal, User, File as FileModel, user_to_dict, file_to_dict
from config import USERS, ROLES, SYNC_PASSWORDS, SYNC_DELETE_MISSING, MAX_PDF_SIZE_MB, ACCESS_CODE_PREFIX

# ---------- Constants ----------
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")

# ---------- App ----------
app = FastAPI()
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO)


# ---------- DB session dependency ----------
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ---------- Auth helpers ----------
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
    part1 = ''.join(random.choices(string.digits, k=5))
    part2 = ''.join(random.choices(string.ascii_uppercase, k=2))
    return f"{ACCESS_CODE_PREFIX}-{part1}-{part2}"


def get_role_permissions(role: str) -> list:
    return ROLES.get(role, {}).get("permissions", [])


def get_role_label(role: str) -> str:
    return ROLES.get(role, {}).get("label", role)


async def get_current_admin(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
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
        result = await db.execute(select(User).where(User.id == payload["sub"]))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user_to_dict(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_super_admin(user=Depends(get_current_admin)) -> dict:
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Réservé au super admin")
    return user


def is_super_admin(user: dict) -> bool:
    return user.get("role") == "super_admin"


# ---------- Models ----------
class LoginInput(BaseModel):
    username: str
    password: str


class StatusUpdate(BaseModel):
    status: str


class CodeVerify(BaseModel):
    code: str


class SignInput(BaseModel):
    signature_data_url: str


class SignaturePositionUpdate(BaseModel):
    signature_position: str  # one of: top-left, top-center, top-right, middle-left, middle-center, middle-right, bottom-left, bottom-center, bottom-right


VALID_POSITIONS = {
    "top-left", "top-center", "top-right",
    "middle-left", "middle-center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
}


class UserCreate(BaseModel):
    username: str
    password: str


class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


# ---------- Auth Endpoints ----------
@api_router.post("/auth/login")
async def login(payload: LoginInput, response: Response, db: AsyncSession = Depends(get_db)):
    username = payload.username.strip().lower()
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Identifiants invalides")
    token = create_access_token(user.id, user.username)
    cookie_secure = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
    cookie_samesite = os.environ.get("COOKIE_SAMESITE", "none" if cookie_secure else "lax")
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=cookie_secure, samesite=cookie_samesite,
        max_age=8 * 3600, path="/",
    )
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "role_label": get_role_label(user.role),
        "permissions": get_role_permissions(user.role),
        "token": token,
    }


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user=Depends(get_current_admin)):
    role = user.get("role", "gestionnaire")
    return {**user, "role_label": get_role_label(role), "permissions": get_role_permissions(role)}


# ---------- Files ----------
@api_router.post("/files/upload")
async def upload_file(
    file: UploadFile = UploadFileParam(...),
    user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Seuls les fichiers PDF sont acceptés")
    content = await file.read()
    if len(content) > MAX_PDF_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Fichier trop volumineux (max {MAX_PDF_SIZE_MB}MB)")

    file_id = str(uuid.uuid4())
    new_file = FileModel(
        id=file_id,
        filename=file.filename,
        content_b64=base64.b64encode(content).decode("utf-8"),
        size=len(content),
        status="unsigned",
        access_code=None,
        created_by=user["id"],
        created_by_username=user["username"],
        created_at=datetime.now(timezone.utc).isoformat(),
        signed_at=None,
        signed_content_b64=None,
        signature_position="bottom-right",
    )
    db.add(new_file)
    await db.commit()
    return file_to_dict(new_file)


def _files_filter(query, user: dict):
    if not is_super_admin(user):
        return query.where(FileModel.created_by == user["id"])
    return query


@api_router.get("/files")
async def list_files(user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    q = select(FileModel).order_by(FileModel.created_at.desc())
    q = _files_filter(q, user)
    result = await db.execute(q)
    return [file_to_dict(f) for f in result.scalars().all()]


@api_router.get("/files/{file_id}")
async def get_file_meta(file_id: str, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    q = select(FileModel).where(FileModel.id == file_id)
    q = _files_filter(q, user)
    f = (await db.execute(q)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    return file_to_dict(f)


@api_router.get("/files/{file_id}/download")
async def download_file(file_id: str, signed: bool = False, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    q = select(FileModel).where(FileModel.id == file_id)
    q = _files_filter(q, user)
    f = (await db.execute(q)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    content_b64 = f.signed_content_b64 if signed and f.signed_content_b64 else f.content_b64
    return {"filename": f.filename, "content_b64": content_b64}


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    q = select(FileModel).where(FileModel.id == file_id)
    q = _files_filter(q, user)
    f = (await db.execute(q)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    await db.delete(f)
    await db.commit()
    return {"ok": True}


@api_router.patch("/files/{file_id}/status")
async def update_status(file_id: str, payload: StatusUpdate, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    if payload.status not in ("signed", "unsigned"):
        raise HTTPException(400, "Statut invalide")
    q = select(FileModel).where(FileModel.id == file_id)
    q = _files_filter(q, user)
    f = (await db.execute(q)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    f.status = payload.status
    await db.commit()
    return {"ok": True, "status": payload.status}


@api_router.post("/files/{file_id}/generate-code")
async def generate_code(file_id: str, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    q = select(FileModel).where(FileModel.id == file_id)
    q = _files_filter(q, user)
    f = (await db.execute(q)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    for _ in range(20):
        code = generate_access_code()
        clash = (await db.execute(select(FileModel).where(FileModel.access_code == code))).scalar_one_or_none()
        if not clash:
            break
    else:
        raise HTTPException(500, "Impossible de générer un code unique")
    f.access_code = code
    await db.commit()
    return {"access_code": code}


@api_router.patch("/files/{file_id}/signature-position")
async def update_signature_position(
    file_id: str,
    payload: SignaturePositionUpdate,
    user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.signature_position not in VALID_POSITIONS:
        raise HTTPException(400, "Position invalide")
    q = select(FileModel).where(FileModel.id == file_id)
    q = _files_filter(q, user)
    f = (await db.execute(q)).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    if f.status == "signed":
        raise HTTPException(400, "Impossible de modifier la position d'un document déjà signé")
    f.signature_position = payload.signature_position
    await db.commit()
    return {"ok": True, "signature_position": payload.signature_position}


# ---------- Signer (public) ----------
@api_router.post("/access/verify")
async def verify_code(payload: CodeVerify, db: AsyncSession = Depends(get_db)):
    code = payload.code.strip().upper()
    f = (await db.execute(select(FileModel).where(FileModel.access_code == code))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Code d'accès invalide")
    return {"id": f.id, "filename": f.filename, "status": f.status, "access_code": code}


@api_router.get("/access/file/{code}")
async def get_file_by_code(code: str, db: AsyncSession = Depends(get_db)):
    code = code.strip().upper()
    f = (await db.execute(select(FileModel).where(FileModel.access_code == code))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Code d'accès invalide")
    content_b64 = f.signed_content_b64 if f.status == "signed" and f.signed_content_b64 else f.content_b64
    return {"id": f.id, "filename": f.filename, "status": f.status, "content_b64": content_b64}


def _embed_signature_in_pdf(pdf_bytes: bytes, signature_png_bytes: bytes, position: str = "bottom-right") -> bytes:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    last_page = reader.pages[-1]
    media = last_page.mediabox
    width = float(media.width); height = float(media.height)
    sig_img = Image.open(io.BytesIO(signature_png_bytes)).convert("RGBA")
    sig_w, sig_h = sig_img.size
    target_w = min(220.0, width * 0.4)
    aspect = sig_h / sig_w if sig_w else 1
    target_h = target_w * aspect

    margin = 36.0
    parts = position.split("-") if "-" in position else ["bottom", "right"]
    v_pos = parts[0]  # top, middle, bottom
    h_pos = parts[1]  # left, center, right

    # Horizontal
    if h_pos == "left":
        x = margin
    elif h_pos == "center":
        x = (width - target_w) / 2
    else:  # right
        x = width - target_w - margin
    # Vertical (PDF coordinates: 0 = bottom)
    if v_pos == "top":
        y = height - target_h - margin
    elif v_pos == "middle":
        y = (height - target_h) / 2
    else:  # bottom
        y = margin

    overlay_buf = io.BytesIO()
    c = rl_canvas.Canvas(overlay_buf, pagesize=(width, height))
    c.drawImage(ImageReader(sig_img), x, y, width=target_w, height=target_h, mask='auto')
    c.setFont("Helvetica", 8); c.setFillColorRGB(0.4, 0.4, 0.4)
    label_y = y - 10 if v_pos != "top" else y + target_h + 4
    c.drawString(x, label_y, f"Signé le {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    c.save()
    overlay_reader = PdfReader(io.BytesIO(overlay_buf.getvalue()))
    overlay_page = overlay_reader.pages[0]
    for i, page in enumerate(reader.pages):
        if i == len(reader.pages) - 1:
            page.merge_page(overlay_page)
        writer.add_page(page)
    out = io.BytesIO(); writer.write(out)
    return out.getvalue()


@api_router.post("/access/sign/{code}")
async def sign_file(code: str, payload: SignInput, db: AsyncSession = Depends(get_db)):
    code = code.strip().upper()
    f = (await db.execute(select(FileModel).where(FileModel.access_code == code))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Code d'accès invalide")
    if f.status == "signed":
        raise HTTPException(400, "Ce document a déjà été signé")
    if "," not in payload.signature_data_url:
        raise HTTPException(400, "Signature invalide")
    _, b64 = payload.signature_data_url.split(",", 1)
    try:
        sig_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(400, "Signature invalide")
    pdf_bytes = base64.b64decode(f.content_b64)
    try:
        signed_pdf = _embed_signature_in_pdf(pdf_bytes, sig_bytes, f.signature_position or "bottom-right")
    except Exception as e:
        logger.exception("Erreur signature")
        raise HTTPException(500, f"Erreur lors de la signature: {e}")
    f.signed_content_b64 = base64.b64encode(signed_pdf).decode("utf-8")
    f.status = "signed"
    f.signed_at = datetime.now(timezone.utc).isoformat()
    await db.commit()
    return {"ok": True, "status": "signed", "signed_at": f.signed_at}


# ---------- Health ----------
@api_router.get("/")
async def root():
    return {"message": "Devis Signature API", "ok": True}


# ---------- User Management ----------
@api_router.get("/users")
async def list_users(user=Depends(require_super_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(User.role != "super_admin").order_by(User.created_at.desc())
    )
    users = result.scalars().all()
    out = []
    for u in users:
        d = user_to_dict(u)
        # files count
        cnt = (await db.execute(
            select(func.count()).select_from(FileModel).where(FileModel.created_by == u.id)
        )).scalar_one()
        d["files_count"] = cnt
        out.append(d)
    return out


@api_router.post("/users")
async def create_user(payload: UserCreate, user=Depends(require_super_admin), db: AsyncSession = Depends(get_db)):
    username = payload.username.strip().lower()
    if not username or len(username) < 3:
        raise HTTPException(400, "Nom d'utilisateur trop court (min 3 caractères)")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(400, "Mot de passe trop court (min 6 caractères)")
    existing = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Ce nom d'utilisateur existe déjà")
    new_id = str(uuid.uuid4())
    new_user = User(
        id=new_id, username=username,
        password_hash=hash_password(payload.password),
        role="gestionnaire",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(new_user)
    await db.commit()
    return {"id": new_id, "username": username, "role": "gestionnaire"}


@api_router.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, user=Depends(require_super_admin), db: AsyncSession = Depends(get_db)):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    if target.role == "super_admin":
        raise HTTPException(403, "Impossible de modifier un super admin")

    if payload.username is not None:
        new_username = payload.username.strip().lower()
        if len(new_username) < 3:
            raise HTTPException(400, "Nom d'utilisateur trop court")
        if new_username != target.username:
            clash = (await db.execute(select(User).where(User.username == new_username))).scalar_one_or_none()
            if clash:
                raise HTTPException(400, "Ce nom d'utilisateur existe déjà")
            old_username = target.username
            target.username = new_username
            # propagate to files
            files_to_update = (await db.execute(
                select(FileModel).where(FileModel.created_by == user_id)
            )).scalars().all()
            for f in files_to_update:
                f.created_by_username = new_username
    if payload.password is not None and payload.password != "":
        if len(payload.password) < 6:
            raise HTTPException(400, "Mot de passe trop court (min 6 caractères)")
        target.password_hash = hash_password(payload.password)
    await db.commit()
    return {"ok": True, "updated": True}


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_super_admin), db: AsyncSession = Depends(get_db)):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    if target.role == "super_admin":
        raise HTTPException(403, "Impossible de supprimer un super admin")
    if target.id == user["id"]:
        raise HTTPException(400, "Impossible de se supprimer soi-même")
    await db.execute(delete(FileModel).where(FileModel.created_by == user_id))
    await db.delete(target)
    await db.commit()
    return {"ok": True}


# ---------- Database Explorer (super_admin only) ----------
ALLOWED_TABLES = {"users", "files"}


@api_router.get("/admin/db/tables")
async def db_list_tables(user=Depends(require_super_admin), db: AsyncSession = Depends(get_db)):
    """List app tables with row counts."""
    out = []
    for name in ALLOWED_TABLES:
        model = User if name == "users" else FileModel
        cnt = (await db.execute(select(func.count()).select_from(model))).scalar_one()
        out.append({"name": name, "row_count": cnt})
    return out


@api_router.get("/admin/db/table/{table_name}")
async def db_browse_table(
    table_name: str,
    limit: int = 50,
    offset: int = 0,
    user=Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Browse table rows (read-only). Sensitive columns are masked."""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(400, "Table inconnue")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    if table_name == "users":
        rows = (await db.execute(
            select(User).order_by(User.created_at.desc()).offset(offset).limit(limit)
        )).scalars().all()
        total = (await db.execute(select(func.count()).select_from(User))).scalar_one()
        columns = ["id", "username", "role", "password_hash", "created_at"]
        data = []
        for u in rows:
            data.append({
                "id": u.id,
                "username": u.username,
                "role": u.role,
                "password_hash": (u.password_hash[:10] + "…[masqué]") if u.password_hash else "",
                "created_at": u.created_at,
            })
        return {"table": table_name, "columns": columns, "rows": data, "total": total, "limit": limit, "offset": offset}

    # files
    rows = (await db.execute(
        select(FileModel).order_by(FileModel.created_at.desc()).offset(offset).limit(limit)
    )).scalars().all()
    total = (await db.execute(select(func.count()).select_from(FileModel))).scalar_one()
    columns = ["id", "filename", "size", "status", "access_code", "created_by_username",
               "created_at", "signed_at", "signature_position", "content_b64"]
    data = []
    for f in rows:
        data.append({
            "id": f.id,
            "filename": f.filename,
            "size": f.size,
            "status": f.status,
            "access_code": f.access_code,
            "created_by_username": f.created_by_username,
            "created_at": f.created_at,
            "signed_at": f.signed_at,
            "signature_position": f.signature_position,
            "content_b64": f"[{len(f.content_b64) if f.content_b64 else 0} chars]",
        })
    return {"table": table_name, "columns": columns, "rows": data, "total": total, "limit": limit, "offset": offset}


# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    await init_db()

    async with AsyncSessionLocal() as session:
        config_usernames = set()
        for entry in USERS:
            username = entry.get("username", "").strip().lower()
            password = entry.get("password", "")
            role = entry.get("role", "gestionnaire")
            if not username or not password:
                logger.warning(f"Skipping invalid user entry: {entry}")
                continue
            if role not in ROLES:
                logger.warning(f"Unknown role '{role}' for '{username}'")
                continue
            config_usernames.add(username)
            existing = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
            if existing is None:
                session.add(User(
                    id=str(uuid.uuid4()),
                    username=username,
                    password_hash=hash_password(password),
                    role=role,
                    created_at=datetime.now(timezone.utc).isoformat(),
                ))
                logger.info(f"[config] Created user: {username} ({role})")
            else:
                changed = False
                if existing.role != role:
                    existing.role = role; changed = True
                if SYNC_PASSWORDS and not verify_password(password, existing.password_hash):
                    existing.password_hash = hash_password(password); changed = True
                if changed:
                    logger.info(f"[config] Updated user: {username}")

        if SYNC_DELETE_MISSING:
            all_users = (await session.execute(select(User))).scalars().all()
            for u in all_users:
                if u.username not in config_usernames:
                    await session.execute(delete(FileModel).where(FileModel.created_by == u.id))
                    await session.delete(u)
                    logger.info(f"[config] Removed user not in config: {u.username}")

        await session.commit()


# ---------- Mount ----------
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
