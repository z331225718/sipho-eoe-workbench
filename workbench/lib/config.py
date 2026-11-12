# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


WORKBENCH_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = WORKBENCH_ROOT / "config.yaml"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path) if path else DEFAULT_CONFIG
    if not p.is_file():
        raise FileNotFoundError(f"config not found: {p}")
    with p.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if not isinstance(cfg, dict):
        raise ValueError(f"config is not a mapping: {p}")
    cfg["_config_path"] = str(p.resolve())
    cfg["_workbench_root"] = str(WORKBENCH_ROOT)
    return cfg


def apply_short_smoke(cfg: dict[str, Any]) -> dict[str, Any]:
    """Shorter PHASE1/2 for a fast CLI check. PHASE3 Mode=5 is skipped (n_ui < 4352)."""
    cfg = dict(cfg)
    p1 = dict(cfg.get("phase1") or {})
    p2 = dict(cfg.get("phase2") or {})
    p3 = dict(cfg.get("phase3") or {})
    p1["n_bits"] = min(int(p1.get("n_bits", 5120)), 1024)
    p2["n_ui"] = min(int(p2.get("n_ui", 4352)), 512)
    p3["skip"] = True
    p3["skip_reason"] = (
        "short smoke: n_ui=512 << 4352 required by Mode=5 fine_tune_UI_by_slope at 106G"
    )
    cfg["phase1"], cfg["phase2"], cfg["phase3"] = p1, p2, p3
    cfg["_short_smoke"] = True
    return cfg


def bitrate_string(cfg: dict[str, Any]) -> str:
    return f"{float(cfg['link']['bitrate_gbps']):.6f} Gbps"


def eye_datarate(cfg: dict[str, Any]) -> str:
    # Eye probe prefers a compact token like "106.25 Gbps"
    v = float(cfg["link"]["bitrate_gbps"])
    if abs(v - round(v)) < 1e-9:
        return f"{int(round(v))} Gbps"
    return f"{v:g} Gbps"


def baud(cfg: dict[str, Any]) -> float:
    return float(cfg["link"]["baud_hz"])


def ui(cfg: dict[str, Any]) -> float:
    return 1.0 / baud(cfg)
