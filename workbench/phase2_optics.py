# -*- coding: utf-8 -*-
"""PHASE2: Tx drive CSV -> PWL/Tran/VtDataset -> SiPho Envelope @ configured baud -> TIA/optical outputs."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np

from lib.config import baud, ui as ui_of
from lib.netlists import build_bridge_net, build_phase2_net
from lib.sim import run_netlist
from lib.waveforms import load_csv, decimate_pwl, save_csv, n_ui, fold_plot, scale_to_tx_swing
from lib.tdecq_hook import run_tdecq
from lib.runutil import bootstrap, write_json


def _load_drive(run_dir: Path, drive_csv: Path | None) -> tuple[np.ndarray, np.ndarray, Path]:
    if drive_csv is None:
        drive_csv = run_dir / "Tx_AMI_diff_scaled.csv"
    if not drive_csv.is_file():
        raise FileNotFoundError(f"PHASE2 needs Tx drive CSV: {drive_csv}")
    t, v = load_csv(drive_csv)
    return t - t[0], v, drive_csv


def run_phase2(cfg, run_dir: Path, stamp: str, log, dirs, drive_csv: Path | None = None, do_tdecq: bool = True) -> dict:
    baud_hz = baud(cfg)
    ui = ui_of(cfg)
    p2 = cfg["phase2"]
    n_ui_target = int(p2["n_ui"])
    t, v, drive_csv = _load_drive(run_dir, drive_csv)
    log(f"drive {drive_csv} n={len(t)} available_ui={n_ui(t, baud_hz):.1f} target_n_ui={n_ui_target}")

    t_need = n_ui_target / baud_hz
    mask = t <= t_need + 1e-15
    seg_t, seg_v = t[mask], v[mask]
    if len(seg_t) < 100:
        seg_t, seg_v = t, v
    # If the drive is shorter than requested, use all of it and record actual n_ui
    n_ui_actual = int(round(seg_t[-1] * baud_hz))
    if n_ui_actual < n_ui_target:
        log(f"WARN drive shorter than target: using n_ui={n_ui_actual}")
    dec = decimate_pwl(seg_t, seg_v, int(p2.get("pwl_target_points", 5000)))
    t_stop = float(dec[-1, 0])
    n_ui_use = int(round(t_stop * baud_hz))
    log(f"PWL dec n={len(dec)} n_ui={n_ui_use} t_stop={t_stop*1e9:.3f} ns")

    bridge_net = build_bridge_net(dec, t_stop, ui)
    bridge_name = f"TxBridge_{stamp}"
    br = run_netlist(
        bridge_net,
        cwd=dirs["eoe_sim"],
        output_dir=dirs["eoe_sim"],
        dataset_name=bridge_name,
        net_path=run_dir / "phase2_bridge_tran.net",
        log=log,
        run_dir=run_dir,
        log_copy_name="phase2_bridge_logFile.txt",
    )
    result = {"phase": 2, "ok": False, "bridge": br, "n_ui": n_ui_use, "t_stop": t_stop, "drive_csv": str(drive_csv)}
    if not br.get("ok"):
        result["error"] = "bridge Tran failed"
        write_json(run_dir / "phase2_manifest.json", result)
        return result

    # Envelope VtDataset must see the .ds from the wrk sipho_sim folder (proven path)
    src_ds = Path(br["dataset_src"])
    sipho_ds = dirs["sipho_sim"] / src_ds.name
    shutil.copy2(src_ds, sipho_ds)

    wb = Path(cfg["_workbench_root"])
    opt_net = build_phase2_net(cfg, wb, bridge_ds=sipho_ds, t_stop=t_stop, n_ui=n_ui_use)
    sipho_name = f"Phase2Optics_{stamp}"
    opt = run_netlist(
        opt_net,
        cwd=dirs["wrk"],
        output_dir=dirs["sipho_sim"],
        dataset_name=sipho_name,
        net_path=run_dir / "phase2_sipho_envelope.net",
        log=log,
        run_dir=run_dir,
        log_copy_name="phase2_sipho_logFile.txt",
    )
    result["optics"] = opt
    if not opt.get("ok"):
        result["error"] = "SiPho Envelope failed"
        write_json(run_dir / "phase2_manifest.json", result)
        return result

    ds_path = Path(opt["dataset"])
    import keysight.ads.dataset as ads_ds

    ds = ads_ds.open(str(ds_path))
    df = ds["Env1.Env1.HB"].to_dataframe().reset_index()
    bb = df[np.isclose(df["freq"].astype(float), 0.0)].copy().sort_values("time")
    tt = bb["time"].to_numpy(dtype=float)
    vout = np.real(bb["Vout"].to_numpy(dtype=complex))
    npam = np.real(bb["N_pam"].to_numpy(dtype=complex))
    stats = {
        "n": int(len(tt)),
        "tspan_ns": float((tt[-1] - tt[0]) * 1e9) if len(tt) else 0,
        "n_ui": n_ui(tt, baud_hz),
        "Vout": [float(vout.min()), float(vout.max()), float(vout.std())],
        "N_pam": [float(npam.min()), float(npam.max()), float(npam.std())],
    }
    log(f"BB {stats}")
    result["rx_stats"] = stats
    save_csv(run_dir / "Rx_TIA_Vout_raw.csv", tt, vout)
    save_csv(run_dir / "N_pam_bb.csv", tt, npam)
    v_scaled = scale_to_tx_swing(vout, peak=1.0 / 6.0)
    save_csv(run_dir / "Rx_TIA_Vout.csv", tt - tt[0], v_scaled)
    result["tia_csv"] = str(run_dir / "Rx_TIA_Vout.csv")
    result["tia_raw_csv"] = str(run_dir / "Rx_TIA_Vout_raw.csv")
    result["npam_csv"] = str(run_dir / "N_pam_bb.csv")
    if npam.std() > 1e-4 or vout.std() > 1e-3:
        result["rx_eye_ok"] = True
    fold_plot(
        run_dir / "phase2_tia_eye.png",
        tt,
        vout,
        ui,
        f"PHASE2 TIA eye @ {baud_hz/1e9:.3f} GBd (Envelope, not FlexDCA)",
    )

    if do_tdecq and cfg.get("tdecq", {}).get("enable", True):
        result["tdecq"] = run_tdecq(ds_path, run_dir, log, baud_hz)

    result["ok"] = bool(result.get("rx_eye_ok"))
    if not result["ok"]:
        result["error"] = "optical/TIA baseband looks dead (near-zero std)"
    write_json(run_dir / "phase2_manifest.json", result)
    log(f"PHASE2 DONE ok={result['ok']}")
    return result


def main():
    ap = argparse.ArgumentParser(description="EOE workbench PHASE2 SiPho optics")
    ap.add_argument("--config", default=None)
    ap.add_argument("--run-dir", default=None)
    ap.add_argument("--drive-csv", default=None)
    ap.add_argument("--no-tdecq", action="store_true")
    args = ap.parse_args()
    cfg, run_dir, stamp, log, dirs = bootstrap(args.config, args.run_dir)
    drive = Path(args.drive_csv) if args.drive_csv else None
    result = run_phase2(cfg, run_dir, stamp, log, dirs, drive_csv=drive, do_tdecq=not args.no_tdecq)
    if not result.get("ok"):
        raise SystemExit(3)


if __name__ == "__main__":
    main()
