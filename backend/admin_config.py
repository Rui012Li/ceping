"""管理后台配置：可通过环境变量覆盖"""

from __future__ import annotations

import os
import secrets

# 默认管理员密码，上线请改：export CEPING_ADMIN_PASSWORD='你的强密码'
ADMIN_PASSWORD = os.getenv("CEPING_ADMIN_PASSWORD", "admin888")

# 进程内签发的简易 token（重启后需重新登录）
_active_tokens: set[str] = set()


def issue_token() -> str:
    token = secrets.token_hex(24)
    _active_tokens.add(token)
    return token


def revoke_token(token: str) -> None:
    _active_tokens.discard(token)


def verify_admin_token(token: str | None) -> bool:
    return bool(token) and token in _active_tokens
