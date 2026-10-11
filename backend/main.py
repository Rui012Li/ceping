"""测评 API + 管理后台 + 静态前端托管"""

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from admin_config import ADMIN_PASSWORD, issue_token, revoke_token, verify_admin_token
from content import QUESTION_ORDER, QUESTIONS, SCALE_OPTIONS
from db import (
    consume_session,
    create_password_batch,
    delete_unused_codes,
    export_codes,
    get_result,
    init_db,
    list_batches,
    list_passwords,
    password_stats,
    save_result,
    session_valid,
    verify_and_start,
)
from scoring import score_answers

ROOT = Path(__file__).resolve().parent
DIST = ROOT.parent / "frontend" / "dist"

app = FastAPI(title="情感弱点地图测评")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


class PasswordBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=64)


class SubmitBody(BaseModel):
    token: str
    answers: dict


class AdminLoginBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


class GenerateBody(BaseModel):
    count: int = Field(..., ge=1, le=5000)
    max_uses: int = Field(3, ge=1, le=99)
    prefix: str = Field("", max_length=12)
    note: str = Field("", max_length=200)
    code_length: int = Field(8, ge=6, le=16)


class ExportBody(BaseModel):
    status: str = Field("unused")
    batch_id: str | None = None
    only_unexported: bool = True
    mark_exported: bool = False
    format: str = Field("txt")  # txt | csv | json


class DeleteBody(BaseModel):
    codes: list[str] = Field(default_factory=list)


def require_admin(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="请先登录管理后台")
    token = authorization.split(" ", 1)[1].strip()
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return token


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/start")
def auth_start(body: PasswordBody):
    result = verify_and_start(body.password)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.get("/api/quiz")
def quiz(token: str):
    if not session_valid(token):
        raise HTTPException(status_code=401, detail="会话无效或已提交，请重新输入密码")
    ordered = [QUESTIONS[i] for i in QUESTION_ORDER]
    return {
        "total": len(ordered),
        "scale_options": SCALE_OPTIONS,
        "questions": ordered,
    }


@app.post("/api/submit")
def submit(body: SubmitBody):
    if not consume_session(body.token):
        raise HTTPException(status_code=401, detail="会话无效或已提交，请重新输入密码")
    try:
        scored = score_answers(body.answers)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    result_id = save_result(scored)
    scored["id"] = result_id
    return scored


@app.get("/api/results/{result_id}")
def read_result(result_id: str):
    data = get_result(result_id)
    if not data:
        raise HTTPException(status_code=404, detail="结果不存在")
    data["id"] = result_id
    return data


# ---------- 管理后台 ----------


@app.post("/api/admin/login")
def admin_login(body: AdminLoginBody):
    if body.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="管理员密码错误")
    token = issue_token()
    return {"ok": True, "token": token}


@app.post("/api/admin/logout")
def admin_logout(_: Annotated[str, Depends(require_admin)], authorization: Annotated[str | None, Header()] = None):
    if authorization and authorization.lower().startswith("bearer "):
        revoke_token(authorization.split(" ", 1)[1].strip())
    return {"ok": True}


@app.get("/api/admin/stats")
def admin_stats(_: Annotated[str, Depends(require_admin)]):
    return password_stats()


@app.get("/api/admin/batches")
def admin_batches(_: Annotated[str, Depends(require_admin)]):
    return {"items": list_batches()}


@app.get("/api/admin/passwords")
def admin_passwords(
    _: Annotated[str, Depends(require_admin)],
    status: str | None = None,
    batch_id: str | None = None,
    exported: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    return list_passwords(
        status=status,
        batch_id=batch_id,
        exported=exported,
        q=q,
        limit=limit,
        offset=offset,
    )


@app.post("/api/admin/passwords/generate")
def admin_generate(body: GenerateBody, _: Annotated[str, Depends(require_admin)]):
    try:
        return create_password_batch(
            count=body.count,
            max_uses=body.max_uses,
            prefix=body.prefix,
            note=body.note,
            code_length=body.code_length,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/admin/passwords/export")
def admin_export(body: ExportBody, _: Annotated[str, Depends(require_admin)]):
    data = export_codes(
        status=body.status,
        batch_id=body.batch_id or None,
        only_unexported=body.only_unexported,
        mark_exported=body.mark_exported,
    )
    fmt = (body.format or "txt").lower()
    filename_base = f"ceping-codes-{data['batch_id'] or 'all'}-{data['count']}"

    if fmt == "json":
        return data

    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["code", "batch_id"])
        for code in data["codes"]:
            writer.writerow([code, data["batch_id"]])
        content = buf.getvalue()
        return StreamingResponse(
            iter([content]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
        )

    # 默认 TXT：一行一个，适合闲鱼/自动发货卡密库
    text = "\n".join(data["codes"]) + ("\n" if data["codes"] else "")
    return PlainTextResponse(
        text,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename_base}.txt"',
            "X-Export-Count": str(data["count"]),
            "X-Marked-Exported": "1" if data["marked_exported"] else "0",
        },
    )


@app.post("/api/admin/passwords/delete")
def admin_delete(body: DeleteBody, _: Annotated[str, Depends(require_admin)]):
    deleted = delete_unused_codes(body.codes)
    return {"ok": True, "deleted": deleted}


if DIST.exists():
    assets = DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        file_path = DIST / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST / "index.html")
