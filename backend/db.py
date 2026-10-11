"""SQLite：密码额度与结果存储"""

from __future__ import annotations

import json
import secrets
import sqlite3
import string
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "app.db"

# 预置密码，每个可用 3 次（可在库里改）
SEED_PASSWORDS = [
    "DEMO001",
    "DEMO002",
    "TEST888",
    "LOVE2026",
    "KEKE001",
    "XINLI01",
    "CEPING1",
    "CEPING2",
]

CODE_ALPHABET = string.ascii_uppercase + string.digits


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    cols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_db() -> None:
    conn = _connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS passwords (
                code TEXT PRIMARY KEY,
                max_uses INTEGER NOT NULL DEFAULT 3,
                used_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                batch_id TEXT,
                note TEXT,
                exported INTEGER NOT NULL DEFAULT 0,
                exported_at TEXT
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                password_code TEXT NOT NULL,
                consumed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(password_code) REFERENCES passwords(code)
            );
            CREATE TABLE IF NOT EXISTS results (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        _ensure_column(conn, "passwords", "batch_id", "TEXT")
        _ensure_column(conn, "passwords", "note", "TEXT")
        _ensure_column(conn, "passwords", "exported", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "passwords", "exported_at", "TEXT")

        now = datetime.now(timezone.utc).isoformat()
        for code in SEED_PASSWORDS:
            conn.execute(
                """
                INSERT OR IGNORE INTO passwords(
                    code, max_uses, used_count, created_at, batch_id, note, exported
                ) VALUES (?, 3, 0, ?, 'SEED', '系统预置', 0)
                """,
                (code, now),
            )
        conn.commit()
    finally:
        conn.close()


def _row_to_password(row: sqlite3.Row) -> dict:
    remaining = row["max_uses"] - row["used_count"]
    if remaining <= 0:
        status = "exhausted"
        status_label = "已用完"
    elif row["used_count"] == 0:
        status = "unused"
        status_label = "未使用"
    else:
        status = "partial"
        status_label = "使用中"

    return {
        "code": row["code"],
        "max_uses": row["max_uses"],
        "used_count": row["used_count"],
        "remaining": max(0, remaining),
        "batch_id": row["batch_id"] or "",
        "note": row["note"] or "",
        "exported": bool(row["exported"]),
        "exported_at": row["exported_at"],
        "created_at": row["created_at"],
        "status": status,
        "status_label": status_label,
    }


def _generate_code(prefix: str = "", length: int = 8) -> str:
    body = "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))
    prefix = (prefix or "").strip().upper()
    return f"{prefix}{body}" if prefix else body


def create_password_batch(
    count: int,
    max_uses: int = 3,
    prefix: str = "",
    note: str = "",
    code_length: int = 8,
) -> dict:
    if count < 1 or count > 5000:
        raise ValueError("单次生成数量需在 1–5000 之间")
    if max_uses < 1 or max_uses > 99:
        raise ValueError("可用次数需在 1–99 之间")
    if code_length < 6 or code_length > 16:
        raise ValueError("密码长度需在 6–16 之间")

    batch_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2).upper()
    now = datetime.now(timezone.utc).isoformat()
    codes: list[str] = []

    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        attempts = 0
        while len(codes) < count:
            attempts += 1
            if attempts > count * 50:
                conn.rollback()
                raise ValueError("生成冲突过多，请换前缀或稍后再试")
            code = _generate_code(prefix, code_length)
            try:
                conn.execute(
                    """
                    INSERT INTO passwords(
                        code, max_uses, used_count, created_at, batch_id, note, exported
                    ) VALUES (?, ?, 0, ?, ?, ?, 0)
                    """,
                    (code, max_uses, now, batch_id, note.strip()),
                )
                codes.append(code)
            except sqlite3.IntegrityError:
                continue
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "batch_id": batch_id,
        "count": len(codes),
        "max_uses": max_uses,
        "codes": codes,
    }


def list_passwords(
    status: str | None = None,
    batch_id: str | None = None,
    exported: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    where: list[str] = []
    params: list = []

    if batch_id:
        where.append("batch_id = ?")
        params.append(batch_id)
    if q:
        where.append("(code LIKE ? OR IFNULL(note,'') LIKE ?)")
        like = f"%{q.strip().upper()}%"
        params.extend([like, f"%{q.strip()}%"])
    if exported == "1":
        where.append("exported = 1")
    elif exported == "0":
        where.append("exported = 0")

    if status == "unused":
        where.append("used_count = 0")
    elif status == "partial":
        where.append("used_count > 0 AND used_count < max_uses")
    elif status == "exhausted":
        where.append("used_count >= max_uses")
    elif status == "available":
        where.append("used_count < max_uses")

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    conn = _connect()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM passwords{where_sql}",
            params,
        ).fetchone()["c"]
        rows = conn.execute(
            f"""
            SELECT * FROM passwords
            {where_sql}
            ORDER BY created_at DESC, code ASC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        items = [_row_to_password(r) for r in rows]
        return {"total": total, "items": items, "limit": limit, "offset": offset}
    finally:
        conn.close()


def list_batches(limit: int = 50) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT
                batch_id,
                COUNT(*) AS total,
                SUM(CASE WHEN used_count = 0 THEN 1 ELSE 0 END) AS unused,
                SUM(CASE WHEN used_count > 0 AND used_count < max_uses THEN 1 ELSE 0 END) AS partial,
                SUM(CASE WHEN used_count >= max_uses THEN 1 ELSE 0 END) AS exhausted,
                SUM(CASE WHEN exported = 1 THEN 1 ELSE 0 END) AS exported_count,
                MAX(created_at) AS created_at,
                MAX(max_uses) AS max_uses
            FROM passwords
            WHERE batch_id IS NOT NULL AND batch_id != ''
            GROUP BY batch_id
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def password_stats() -> dict:
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN used_count = 0 THEN 1 ELSE 0 END) AS unused,
                SUM(CASE WHEN used_count > 0 AND used_count < max_uses THEN 1 ELSE 0 END) AS partial,
                SUM(CASE WHEN used_count >= max_uses THEN 1 ELSE 0 END) AS exhausted,
                SUM(CASE WHEN exported = 0 AND used_count = 0 THEN 1 ELSE 0 END) AS ready_to_ship
            FROM passwords
            """
        ).fetchone()
        return {
            "total": row["total"] or 0,
            "unused": row["unused"] or 0,
            "partial": row["partial"] or 0,
            "exhausted": row["exhausted"] or 0,
            "ready_to_ship": row["ready_to_ship"] or 0,
        }
    finally:
        conn.close()


def export_codes(
    status: str = "unused",
    batch_id: str | None = None,
    only_unexported: bool = True,
    mark_exported: bool = False,
    limit: int = 10000,
) -> dict:
    data = list_passwords(
        status=status,
        batch_id=batch_id,
        exported="0" if only_unexported else None,
        limit=limit,
        offset=0,
    )
    codes = [item["code"] for item in data["items"]]
    exported_at = None
    if mark_exported and codes:
        exported_at = datetime.now(timezone.utc).isoformat()
        conn = _connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                "UPDATE passwords SET exported = 1, exported_at = ? WHERE code = ?",
                [(exported_at, c) for c in codes],
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    return {
        "count": len(codes),
        "codes": codes,
        "batch_id": batch_id or "",
        "marked_exported": bool(mark_exported and codes),
        "exported_at": exported_at,
    }


def delete_unused_codes(codes: list[str]) -> int:
    """仅允许删除未使用过的密码，避免误删已售出卡密。"""
    if not codes:
        return 0
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        deleted = 0
        for code in codes:
            cur = conn.execute(
                "DELETE FROM passwords WHERE code = ? AND used_count = 0",
                (code.strip().upper(),),
            )
            deleted += cur.rowcount
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def verify_and_start(password: str) -> dict:
    """校验密码并扣减 1 次，返回 session token。"""
    code = (password or "").strip().upper()
    if not code:
        return {"ok": False, "message": "请输入密码"}

    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT code, max_uses, used_count FROM passwords WHERE code = ?",
            (code,),
        ).fetchone()
        if not row:
            conn.rollback()
            return {"ok": False, "message": "密码无效"}

        remaining = row["max_uses"] - row["used_count"]
        if remaining <= 0:
            conn.rollback()
            return {"ok": False, "message": "该密码次数已用完（最多 3 次）"}

        conn.execute(
            "UPDATE passwords SET used_count = used_count + 1 WHERE code = ?",
            (code,),
        )
        token = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO sessions(token, password_code, consumed, created_at) VALUES (?, ?, 0, ?)",
            (token, code, now),
        )
        conn.commit()
        left = remaining - 1
        return {
            "ok": True,
            "token": token,
            "remaining": left,
            "message": f"验证成功，本密码还可测 {left} 次",
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def consume_session(token: str) -> bool:
    """提交结果时消费 session（每 token 只能提交一次）。"""
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT token, consumed FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            conn.rollback()
            return False
        if row["consumed"]:
            conn.rollback()
            return False
        conn.execute("UPDATE sessions SET consumed = 1 WHERE token = ?", (token,))
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def session_valid(token: str) -> bool:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT consumed FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
        return bool(row) and row["consumed"] == 0
    finally:
        conn.close()


def save_result(payload: dict) -> str:
    result_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO results(id, payload, created_at) VALUES (?, ?, ?)",
            (result_id, json.dumps(payload, ensure_ascii=False), now),
        )
        conn.commit()
        return result_id
    finally:
        conn.close()


def get_result(result_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT payload FROM results WHERE id = ?",
            (result_id,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row["payload"])
    finally:
        conn.close()
