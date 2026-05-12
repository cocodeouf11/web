"""SQLAlchemy ORM models + async engine for Soizic."""
import os
from sqlalchemy import String, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./soizic.db",
)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="gestionnaire")
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class File(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_b64: Mapped[str] = mapped_column(Text, nullable=False)
    signed_content_b64: Mapped[str | None] = mapped_column(Text, nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unsigned", index=True)
    access_code: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_by_username: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    signed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    signature_position: Mapped[str] = mapped_column(String(20), nullable=False, default="bottom-right")
    document_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Devis", index=True)
    # Sprint 2 additions
    parent_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)  # linked docs
    fields: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list of field defs
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # within group


class DocumentType(Base):
    __tablename__ = "document_types"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    default_signature_position: Mapped[str] = mapped_column(String(20), nullable=False, default="bottom-right")
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


# Async engine + session factory
engine = create_async_engine(DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db():
    """Create tables if they don't exist + run light migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text
        try:
            cols = await conn.execute(text("PRAGMA table_info(files)"))
            col_names = [row[1] for row in cols.fetchall()]
            if "signature_position" not in col_names:
                await conn.execute(text(
                    "ALTER TABLE files ADD COLUMN signature_position VARCHAR(20) NOT NULL DEFAULT 'bottom-right'"
                ))
            if "document_type" not in col_names:
                await conn.execute(text(
                    "ALTER TABLE files ADD COLUMN document_type VARCHAR(50) NOT NULL DEFAULT 'Devis'"
                ))
            if "parent_file_id" not in col_names:
                await conn.execute(text(
                    "ALTER TABLE files ADD COLUMN parent_file_id VARCHAR(36)"
                ))
            if "fields" not in col_names:
                await conn.execute(text(
                    "ALTER TABLE files ADD COLUMN fields TEXT"
                ))
            if "sort_order" not in col_names:
                await conn.execute(text(
                    "ALTER TABLE files ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
                ))
        except Exception:
            pass


def user_to_dict(u: User, include_password: bool = False) -> dict:
    d = {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "created_at": u.created_at,
    }
    if include_password:
        d["password_hash"] = u.password_hash
    return d


def file_to_dict(f: File, include_content: bool = False) -> dict:
    import json as _json
    fields_list = []
    if f.fields:
        try: fields_list = _json.loads(f.fields)
        except Exception: fields_list = []
    d = {
        "id": f.id,
        "filename": f.filename,
        "size": f.size,
        "status": f.status,
        "access_code": f.access_code,
        "created_by": f.created_by,
        "created_by_username": f.created_by_username,
        "created_at": f.created_at,
        "signed_at": f.signed_at,
        "signature_position": f.signature_position or "bottom-right",
        "document_type": f.document_type or "Devis",
        "parent_file_id": f.parent_file_id,
        "fields": fields_list,
        "sort_order": f.sort_order or 0,
    }
    if include_content:
        d["content_b64"] = f.content_b64
        d["signed_content_b64"] = f.signed_content_b64
    return d
