# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .config import load_config
from .ads_env import apply_env, prepare_sim_dirs


def make_logger(run_dir: Path) -> Callable[[str], None]:
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "run_log.txt"

    def log(msg: str) -> None:
        line = msg if isinstance(msg, str) else str(msg)
        print(line, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    return log


def resolve_run_dir(cfg: dict, run_dir: str | Path | None, stamp: str | None = None) -> Path:
    if run_dir:
        p = Path(run_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p
    stamp = stamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    root = Path(cfg["paths"]["results_root"])
    p = root / f"run_{stamp}"
    p.mkdir(parents=True, exist_ok=True)
    return p


def bootstrap(config_path: str | Path | None, run_dir: str | Path | None = None):
    cfg = load_config(config_path)
    apply_env(cfg)
    wb = Path(cfg["_workbench_root"])
    dirs = prepare_sim_dirs(cfg, wb)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    rd = resolve_run_dir(cfg, run_dir, stamp)
    log = make_logger(rd)
    log(f"stamp={stamp} run_dir={rd}")
    log(f"config={cfg['_config_path']}")
    log(f"bitrate={cfg['link']['bitrate_gbps']} Gbps baud={cfg['link']['baud_hz']} format={cfg['link']['format']}")
    return cfg, rd, stamp, log, dirs


def write_json(path: Path, obj: Any) -> Path:
    path.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
    return path
