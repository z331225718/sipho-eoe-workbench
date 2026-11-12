# -*- coding: utf-8 -*-
"""Orchestrate PHASE1 -> PHASE2 -> PHASE3 headless EOE workbench."""
from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from lib.config import load_config, apply_short_smoke
from lib.ads_env import apply_env, prepare_sim_dirs, hpeesofsim, preferred_python
from lib.runutil import make_logger, resolve_run_dir, write_json
from phase1_tx_ami import run_phase1
from phase2_optics import run_phase2
from phase3_rx_ami import run_phase3


def main():
    ap = argparse.ArgumentParser(description="SiPho EOE headless workbench (PHASE1-3)")
    ap.add_argument("--config", default=None, help="path to config.yaml")
    ap.add_argument("--run-dir", default=None)
    ap.add_argument("--from-phase", type=int, default=1, choices=(1, 2, 3))
    ap.add_argument("--short", action="store_true", help="short smoke: n_ui=512, skip PHASE3")
    ap.add_argument("--no-tdecq", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.short:
        cfg = apply_short_smoke(cfg)
    apply_env(cfg)
    wb = Path(cfg["_workbench_root"])
    dirs = prepare_sim_dirs(cfg, wb)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = resolve_run_dir(cfg, args.run_dir, stamp)
    log = make_logger(run_dir)
    now = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S Asia/Shanghai (UTC+8)")
    log(f"EOE workbench start {now}")
    log(f"run_dir={run_dir}")
    log(f"python preferred={preferred_python(cfg)}")
    log(f"hpeesofsim={hpeesofsim(cfg)}")
    log(f"from_phase={args.from_phase} short={bool(args.short)}")

    summary = {
        "stamp": stamp,
        "when": now,
        "run_dir": str(run_dir),
        "config": cfg["_config_path"],
        "bitrate_gbps": cfg["link"]["bitrate_gbps"],
        "baud_hz": cfg["link"]["baud_hz"],
        "format": cfg["link"]["format"],
        "short": bool(args.short),
        "from_phase": args.from_phase,
        "phase1": None,
        "phase2": None,
        "phase3": None,
        "ok": False,
    }

    p1 = p2 = p3 = None
    if args.from_phase <= 1:
        p1 = run_phase1(cfg, run_dir, stamp, log, dirs)
        summary["phase1"] = p1
        if not p1.get("ok"):
            summary["failed_at"] = "phase1"
            write_json(run_dir / "summary.json", summary)
            log("ABORT at PHASE1")
            raise SystemExit(2)
    else:
        log("skip PHASE1 (--from-phase)")

    if args.from_phase <= 2:
        drive = run_dir / "Tx_AMI_diff_scaled.csv"
        p2 = run_phase2(
            cfg, run_dir, stamp, log, dirs,
            drive_csv=drive if drive.is_file() else None,
            do_tdecq=not args.no_tdecq,
        )
        summary["phase2"] = p2
        if not p2.get("ok"):
            summary["failed_at"] = "phase2"
            write_json(run_dir / "summary.json", summary)
            log("ABORT at PHASE2")
            raise SystemExit(3)
    else:
        log("skip PHASE2 (--from-phase)")

    p3 = run_phase3(cfg, run_dir, stamp, log, dirs)
    summary["phase3"] = p3
    if p3.get("skipped"):
        summary["ok"] = bool((p1 or {}).get("ok", True) and (p2 or {}).get("ok", True))
        summary["note"] = p3.get("reason")
    elif not p3.get("ok"):
        summary["failed_at"] = "phase3"
        summary["ok"] = False
    else:
        summary["ok"] = True

    write_json(run_dir / "summary.json", summary)
    log("SUMMARY " + str({
        "ok": summary["ok"],
        "p1": None if not p1 else p1.get("ok"),
        "p2": None if not p2 else p2.get("ok"),
        "p3": None if not p3 else p3.get("ok") or p3.get("skipped"),
        "run_dir": str(run_dir),
    }))
    if not summary["ok"] and not (p3 or {}).get("skipped"):
        raise SystemExit(4)


if __name__ == "__main__":
    main()
