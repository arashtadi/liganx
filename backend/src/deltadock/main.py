"""FastAPI application entrypoint."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import init_db
from .routers import catalog, jobs, lookup, me, me_compounds, structures, suggest

# Git SHA of the deployed image — injected by the GH Actions workflow as a
# build arg / env var. Lets us verify which commit is actually live without
# having to read Fly logs. Defaults to "dev" for local runs.
GIT_SHA = os.environ.get("GIT_SHA", "dev")

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("deltadock")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("Starting DeltaDock backend %s in %s mode", __version__, settings.app_env)
    init_db()
    yield
    log.info("Shutting down DeltaDock backend")


app = FastAPI(
    title="Liganx API",
    version=__version__,
    description="Mutation-aware structural-biology platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(catalog.router)
app.include_router(structures.router)
app.include_router(lookup.router)
app.include_router(suggest.router)
app.include_router(me.router)
app.include_router(me_compounds.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "env": settings.app_env,
        "git_sha": GIT_SHA,
    }
