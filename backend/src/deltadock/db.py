"""Database engine and session management."""

from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

settings = get_settings()

# Per-driver connect_args.
# SQLite needs check_same_thread=False because FastAPI uses threads.
# Postgres (Supabase Session pooler) benefits from a small connect_timeout so
# transient DNS/TCP hiccups surface fast instead of stalling a request.
_is_sqlite = settings.effective_database_url.startswith("sqlite")
_connect_args = (
    {"check_same_thread": False}
    if _is_sqlite
    else {"connect_timeout": 10}
)

# pool_pre_ping: ping the connection before each checkout, transparently
# recycling stale ones. The Supabase pooler closes idle connections after a
# few minutes, so without this we'd see the dreaded "server closed the
# connection unexpectedly" on the first request after an idle period.
# pool_recycle=1800: belt-and-braces; force a recycle every 30 min even when
# pre_ping says ok, to stay well clear of any upstream idle timeout.
_engine_kwargs: dict = dict(echo=settings.is_dev, connect_args=_connect_args)
if not _is_sqlite:
    _engine_kwargs.update(pool_pre_ping=True, pool_recycle=1800)

engine = create_engine(settings.effective_database_url, **_engine_kwargs)


def init_db() -> None:
    """Create tables. Called once at app startup. In production we'd use Alembic instead."""
    # Import models so SQLModel registers them on its metadata before creating tables.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a DB session per request."""
    with Session(engine) as session:
        yield session
