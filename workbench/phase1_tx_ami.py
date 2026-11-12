# -*- coding: utf-8 -*-
"""PHASE1: ChannelSim + my_Ethernet PAM4 Tx AMI (Mode=1 GetWave) -> electrical eye CSV/.ds."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from lib.config import baud, ui as ui_of
from lib.netlists import build_phase1_net, ami_paths
from lib.sim import run_netlist
from lib.waveforms import dump_eye_vector, save_csv, scale_diff_to_halfvolt, n_ui, fold_plot
from lib.runutil import bootstrap, write_json


def run_phase1(cfg, run_dir: Path, stamp: str, log, dirs) -> dict:
    baud_hz = baud(cfg)
    ui = ui_of(cfg)
    n_bits = int(cfg["phase1"]["n_bits"])
    rng = np.random.default_rng(53)
    sym = run_dir / "pam4_symbols.txt"
    # plenty of symbols for ChannelSim + later PHASE3
    n_sym = max(n_bits, int(cfg["phase3"]["n_ui_min"]), 8000)
    sym.write_text("\n".join(str(int(s)) for s in rng.integers(0, 4, size=n_sym)) + "\n", encoding="ascii")

    paths = ami_paths(cfg)
    for key in ("tx_ibs", "rx_ibs", "tx_s4p", "rx_s4p"):
        if not paths[key].is_file():
            raise FileNotFoundError(f"missing AMI artifact {key}: {paths[key]}")
        log(f"AMI {key}={paths[key]}")

    net = build_phase1_net(cfg, symbol_file=sym)
    dsname = f"Phase1TxAMI_{stamp}"
    info = run_netlist(
        net,
        cwd=dirs["eoe_sim"],
        output_dir=dirs["eoe_sim"],
        dataset_name=dsname,
        net_path=run_dir / "phase1_tx_ami.net",
        log=log,
        run_dir=run_dir,
        log_copy_name="phase1_logFile.txt",
    )
    result = {
        "phase": 1,
        "ok": False,
        "sim": info,
        "symbol_file": str(sym),
        "n_bits": n_bits,
    }
    ds = Path(info["dataset"]) if info.get("dataset") else None
    if not (info.get("ok") and ds and ds.is_file() and ds.stat().st_size > 100_000):
        result["error"] = "PHASE1 ChannelSim did not produce a usable .ds"
        write_json(run_dir / "phase1_manifest.json", result)
        return result

    eye_p = dump_eye_vector(ds, "CS1.TDM.Eye.Waveform.Eye_P")
    eye_n = dump_eye_vector(ds, "CS1.TDM.Eye.Waveform.Eye_N")
    log(f"Eye_P n={len(eye_p)} Eye_N n={len(eye_n)}")
    result["eye_p_n"] = int(len(eye_p))
    result["eye_n_n"] = int(len(eye_n))
    if len(eye_p) < 100:
        result["error"] = "Eye_P too short"
        write_json(run_dir / "phase1_manifest.json", result)
        return result

    t_p = eye_p[:, 0] - eye_p[0, 0]
    v_p = eye_p[:, 1]
    save_csv(run_dir / "Tx_AMI_Eye_P.csv", t_p, v_p)
    if len(eye_n) == len(eye_p) and len(eye_n) > 0:
        t_n = eye_n[:, 0] - eye_n[0, 0]
        v_n = eye_n[:, 1]
        save_csv(run_dir / "Tx_AMI_Eye_N.csv", t_n, v_n)
        v_diff = 0.5 * (v_p - v_n)
    else:
        v_diff = v_p.copy()
    v_drive = scale_diff_to_halfvolt(t_p, v_diff)
    save_csv(run_dir / "Tx_AMI_diff_scaled.csv", t_p, v_drive)
    result["tx_eye_csv"] = str(run_dir / "Tx_AMI_Eye_P.csv")
    result["drive_csv"] = str(run_dir / "Tx_AMI_diff_scaled.csv")
    result["tspan_s"] = float(t_p[-1] - t_p[0])
    result["n_ui"] = n_ui(t_p, baud_hz)
    log(f"drive n={len(t_p)} tspan={result['tspan_s']*1e9:.3f} ns n_ui={result['n_ui']:.1f}")
    fold_plot(
        run_dir / "phase1_tx_eye.png",
        t_p,
        v_p,
        ui,
        f"PHASE1 Tx AMI Eye_P @ {cfg['link']['bitrate_gbps']} Gb/s PAM4 (not FlexDCA)",
    )
    result["ok"] = True
    write_json(run_dir / "phase1_manifest.json", result)
    log("PHASE1 DONE ok=True")
    return result


def main():
    ap = argparse.ArgumentParser(description="EOE workbench PHASE1 Tx AMI")
    ap.add_argument("--config", default=None)
    ap.add_argument("--run-dir", default=None)
    args = ap.parse_args()
    cfg, run_dir, stamp, log, dirs = bootstrap(args.config, args.run_dir)
    result = run_phase1(cfg, run_dir, stamp, log, dirs)
    if not result.get("ok"):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
