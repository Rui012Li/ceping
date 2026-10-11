"""计分与结果组装"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from content import QUESTIONS, TYPE_META


def _clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def score_answers(answers: dict[str, Any]) -> dict[str, Any]:
    """
    answers 格式:
      量表题: {"1": 4, "2": 3, ...}  # 1-4
      快选题: {"13": "A", "14": "B", "15": "F"}
    """
    dims = {k: 0 for k in "ABCDEF"}

    for qid in range(1, 13):
        q = QUESTIONS[qid]
        raw = answers.get(str(qid), answers.get(qid))
        if raw is None:
            raise ValueError(f"缺少第 {qid} 题答案")
        val = int(raw)
        if val not in (1, 2, 3, 4):
            raise ValueError(f"第 {qid} 题答案无效")
        dims[q["dimension"]] += val

    for qid in (13, 14, 15):
        raw = answers.get(str(qid), answers.get(qid))
        if raw is None:
            raise ValueError(f"缺少第 {qid} 题答案")
        key = str(raw).upper()
        if key not in dims:
            raise ValueError(f"第 {qid} 题答案无效")
        dims[key] = min(10, dims[key] + 2)

    percents = {
        k: int(round(_clamp((v - 2) / 8 * 100, 0, 100))) for k, v in dims.items()
    }

    ranked = sorted(percents.items(), key=lambda x: (-x[1], x[0]))
    primary_code, primary_score = ranked[0]
    secondary_code, secondary_score = ranked[1]

    is_clear = primary_score < 40
    dual = (not is_clear) and (primary_score - secondary_score <= 10)

    primary = deepcopy(TYPE_META[primary_code])
    secondary = deepcopy(TYPE_META[secondary_code])

    if is_clear:
        primary["title"] = (
            f"你整体边界尚可，若要破防，最可能从「{primary['name']}」打开"
        )
        primary["hook"] = (
            "清醒不是免疫。压力大、孤独久时，弱点仍可能被放大。"
            + primary["hook"]
        )
        result_badge = "相对清醒型"
    else:
        result_badge = primary["name"]

    radar = {
        "拯救欲": percents["A"],
        "甜度成瘾": percents["B"],
        "边界厚度": 100 - percents["C"],
        "刺激渴求": percents["D"],
        "自我坚定": int(round(((100 - percents["E"]) + (100 - percents["F"])) / 2)),
    }

    return {
        "result_badge": result_badge,
        "is_clear": is_clear,
        "dual_weakness": dual,
        "primary": primary,
        "secondary": secondary,
        "scores": percents,
        "raw_scores": dims,
        "radar": radar,
        "disclaimer": "本测评用于自我觉察与趣味参考，不构成心理咨询、诊断或医疗建议。",
    }
