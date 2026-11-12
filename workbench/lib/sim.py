# -*- coding: utf-8 -*-
"""Headless CircuitSimulator / hpeesofsim wrapper."""
from __future__ import annotations

import os
import shutil
import traceback
from pathlib import Path
from typing import Callable

from .ads_env import circuit_simulator


def newest_logfile(search_root: Path) -> Path | None:
    files = list(search_root.rglob("logFile.txt"))
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def filter_log_lines(text: str) -> list[str]:
    keys = (
        "Error", "Warning", "AMI", "GetWave", "wvfm", "Init", "bits",
        "fine_tune", "Calling", "Finished", "SER", "CPU", "HB", "Eye",
        "Length of waveform", "Waveform Vmean", "terminated",
    )
    out = []
    for ln in text.splitlines():
        if any(k in ln for k in keys):
            out.append(ln.strip()[:240])
    return out


def run_netlist(
    net_text: str,
    *,
    cwd: Path,
    output_dir: Path,
    dataset_name: str,
    net_path: Path,
    log: Callable[[str], None],
    run_dir: Path,
    log_copy_name: str = "sim_logFile.txt",
) -> dict:
    """Write netlist, chdir, CircuitSimulator.run_netlist. Returns status dict."""
    output_dir.mkdir(parents=True, exist_ok=True)
    net_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        net_path.write_text(net_text, encoding="ascii", newline="\n")
    except UnicodeEncodeError:
        # comments may contain punctuation; ADS accepts UTF-8 netlists in practice
        net_path.write_text(net_text, encoding="utf-8", newline="\n")
    prev = os.getcwd()
    info: dict = {
        "ok": False,
        "dataset_name": dataset_name,
        "net": str(net_path),
        "cwd": str(cwd),
        "output_dir": str(output_dir),
    }
    try:
        os.chdir(str(cwd))
        log(f"SIM {dataset_name} cwd={cwd} net={net_path.name}")
        sim = circuit_simulator()
        sim.run_netlist(net_text, output_dir=str(output_dir), dataset_name=dataset_name)
        info["ok"] = True
        log(f"SIM OK {dataset_name}")
    except Exception as e:
        info["ok"] = False
        info["error"] = repr(e)[:2000]
        info["traceback"] = traceback.format_exc()[-2000:]
        log(f"SIM FAIL {dataset_name}: {repr(e)[:800]}")
    finally:
        os.chdir(prev)

    lf = newest_logfile(output_dir)
    if lf is None:
        lf = newest_logfile(cwd)
    if lf and lf.is_file():
        dest = run_dir / log_copy_name
        try:
            shutil.copy2(lf, dest)
            txt = lf.read_text(encoding="utf-8", errors="replace")
            info["logfile"] = str(dest)
            highlights = filter_log_lines(txt)
            info["log_highlights"] = highlights[-80:]
            for ln in highlights[-40:]:
                log("  " + ln)
        except Exception as e:
            log(f"log copy fail: {e}")

    ds = output_dir / f"{dataset_name}.ds"
    if ds.is_file():
        copied = run_dir / ds.name
        shutil.copy2(ds, copied)
        info["dataset"] = str(copied)
        info["dataset_src"] = str(ds)
        info["dataset_size"] = ds.stat().st_size
        log(f"DS {copied.name} size={ds.stat().st_size}")
        if ds.stat().st_size > 100_000 and not info["ok"]:
            info["ok"] = True
            log("DS size>100k — treat as ok despite exception")
    return info
