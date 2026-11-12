# -*- coding: utf-8 -*-
"""PHASE3: TIA/optical-out CSV -> resample identical dt -> my_Ethernet Rx AMI eye (Mode=5)."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from lib.config import baud, ui as ui_of
from lib.netlists import build_phase3_net
from lib.sim import run_netlist
from lib.waveforms import load_csv, resample, save_csv, n_ui, dump_eye_vector, fold_plot, synth_pam4_from_waveform
from lib.runutil import bootstrap, write_json


def _prepare_measured(cfg, run_dir: Path, log, measured_csv: Path | None, second_csv: Path | None):
    baud_hz = baud(cfg)
    ui = ui_of(cfg)
    p3 = cfg["phase3"]
    dt = ui / float(p3.get("pts_per_ui") or cfg["phase1"]["pts_per_ui"])
    n_ui_min = int(p3["n_ui_min"])
    kind = p3.get("measured", "tia_soft")

    if measured_csv is None:
        if kind == "tx_eye":
            measured_csv = run_dir / "Tx_AMI_Eye_P.csv"
        else:
            measured_csv = run_dir / "Rx_TIA_Vout.csv"
    if not measured_csv.is_file():
        raise FileNotFoundError(f"PHASE3 measured CSV missing: {measured_csv}")

    t, v = load_csv(measured_csv)
    avail = n_ui(t, baud_hz)
    log(f"measured {measured_csv.name} n={len(t)} available_ui={avail:.1f} min={n_ui_min} dt_target={dt:.3e}")

    # Use as much as we have; resample onto ChannelSim grid
    tspan = float(t[-1] - t[0])
    tg, vg = resample(t, v, dt, tspan)
    got = n_ui(tg, baud_hz)
    meas_out = run_dir / "phase3_measured_aligned.csv"
    save_csv(meas_out, tg, vg)
    log(f"aligned measured n={len(tg)} n_ui={got:.1f}")

    sec_out = None
    if second_csv is None and p3.get("use_second_measured"):
        cand = run_dir / "Tx_AMI_Eye_P.csv"
        if cand.is_file():
            second_csv = cand
    if second_csv and Path(second_csv).is_file():
        st, sv = load_csv(Path(second_csv))
        span = min(tspan, float(st[-1] - st[0]))
        ts, vs = resample(st, sv, dt, span)
        # re-align measured to the same span/grid
        tg2, vg2 = resample(t, v, dt, span)
        meas_out = run_dir / "phase3_measured_aligned.csv"
        sec_out = run_dir / "phase3_second_aligned.csv"
        save_csv(meas_out, tg2, vg2)
        save_csv(sec_out, ts, vs)
        tg, vg, got = tg2, vg2, n_ui(tg2, baud_hz)
        log(f"aligned second+meas n={len(tg)} n_ui={got:.1f}")

    length_ok = got + 1e-6 >= n_ui_min
    if not length_ok:
        log(
            f"WARN measured n_ui={got:.1f} < {n_ui_min}: Mode=5 fine_tune_UI_by_slope "
            f"at 106G historically fails below ~4288 bits / 4352 UI"
        )
    return meas_out, sec_out, got, length_ok


def _simulate_rx(cfg, run_dir, stamp, log, dirs, meas, sec, tag):
    p3 = cfg["phase3"]
    sym = run_dir / "pam4_symbols.txt"
    if not sym.is_file():
        rng = np.random.default_rng(53)
        n_sym = max(int(p3["n_bits"]), int(p3["n_ui_min"]), 8000)
        sym.write_text("\n".join(str(int(s)) for s in rng.integers(0, 4, size=n_sym)) + "\n", encoding="ascii")
    net = build_phase3_net(cfg, symbol_file=sym, measured_csv=meas, second_csv=sec)
    net_path = run_dir / f"phase3_rx_ami_{tag}.net"
    info = run_netlist(
        net,
        cwd=dirs["eoe_sim"],
        output_dir=dirs["eoe_sim"],
        dataset_name=f"Phase3RxAMI_{stamp}_{tag}",
        net_path=net_path,
        log=log,
        run_dir=run_dir,
        log_copy_name=f"phase3_logFile_{tag}.txt",
    )
    result = {"tag": tag, "ok": False, "sim": info, "measured_csv": str(meas), "second_csv": str(sec) if sec else None}
    ds = Path(info["dataset"]) if info.get("dataset") else None
    if ds and ds.is_file() and ds.stat().st_size > 100_000:
        eye = dump_eye_vector(ds, "CS1.TDM.Eye.Waveform.Eye_Rx")
        result["eye_rx_n"] = int(len(eye))
        log(f"Eye_Rx[{tag}] n={len(eye)}")
        if len(eye) > 100:
            save_csv(run_dir / f"RxAMI_Eye_Rx_{tag}.csv", eye[:, 0], eye[:, 1])
            # also write canonical name for the first success
            save_csv(run_dir / "RxAMI_Eye_Rx.csv", eye[:, 0], eye[:, 1])
            result["eye_csv"] = str(run_dir / f"RxAMI_Eye_Rx_{tag}.csv")
            fold_plot(
                run_dir / f"phase3_rx_ami_eye_{tag}.png",
                eye[:, 0],
                eye[:, 1],
                ui_of(cfg),
                f"PHASE3 Rx AMI Eye_Rx [{tag}] @ {cfg['link']['bitrate_gbps']} Gb/s (not FlexDCA)",
            )
            result["ok"] = True
    if not result["ok"]:
        result["error"] = info.get("error") or "PHASE3 did not produce Eye_Rx"
    return result


def run_phase3(
    cfg,
    run_dir: Path,
    stamp: str,
    log,
    dirs,
    measured_csv: Path | None = None,
    second_csv: Path | None = None,
) -> dict:
    p3 = cfg["phase3"]
    if p3.get("skip"):
        result = {"phase": 3, "ok": False, "skipped": True, "reason": p3.get("skip_reason")}
        write_json(run_dir / "phase3_manifest.json", result)
        log(f"PHASE3 SKIPPED: {p3.get('skip_reason')}")
        return result

    kind = p3.get("measured", "auto")
    attempts = []
    if measured_csv is not None:
        attempts.append(("user", measured_csv, second_csv, False))
    elif kind == "tx_eye":
        attempts.append(("tx_eye", run_dir / "Tx_AMI_Eye_P.csv", second_csv, False))
    elif kind == "tia_soft":
        attempts.append(("tia_soft", run_dir / "Rx_TIA_Vout.csv", second_csv, False))
        if p3.get("fallback", True):
            attempts.append(("sharp_tia", run_dir / "Rx_TIA_Vout.csv", second_csv, True))
            attempts.append(("tx_eye", run_dir / "Tx_AMI_Eye_P.csv", None, False))
    else:  # auto
        attempts.append(("tia_soft", run_dir / "Rx_TIA_Vout.csv", second_csv, False))
        attempts.append(("sharp_tia", run_dir / "Rx_TIA_Vout.csv", second_csv, True))
        attempts.append(("tx_eye", run_dir / "Tx_AMI_Eye_P.csv", None, False))

    tried = []
    winner = None
    for tag, src, sec_src, sharpen in attempts:
        if src is None or not Path(src).is_file():
            log(f"PHASE3 skip attempt {tag}: missing {src}")
            continue
        if sharpen:
            baud_hz = baud(cfg)
            ui = ui_of(cfg)
            dt = ui / float(p3.get("pts_per_ui") or cfg["phase1"]["pts_per_ui"])
            t, v = load_csv(Path(src))
            ts, vs = synth_pam4_from_waveform(t, v, baud_hz, dt, rise_pts=1)
            src = run_dir / "phase3_measured_sharp_tia.csv"
            save_csv(src, ts, vs)
            log(f"sharp_tia n={len(ts)} n_ui={n_ui(ts, baud_hz):.1f}")
        meas, sec, got, length_ok = _prepare_measured(cfg, run_dir, log, Path(src), Path(sec_src) if sec_src else None)
        # keep a per-tag copy of the aligned meas
        tag_meas = run_dir / f"phase3_measured_{tag}.csv"
        tag_meas.write_bytes(Path(meas).read_bytes())
        r = _simulate_rx(cfg, run_dir, stamp, log, dirs, meas, sec, tag)
        r["measured_n_ui"] = got
        r["length_ok"] = length_ok
        r["n_ui_min"] = int(p3["n_ui_min"])
        tried.append(r)
        write_json(run_dir / f"phase3_manifest_{tag}.json", r)
        if r.get("ok"):
            winner = r
            log(f"PHASE3 success on attempt={tag}")
            break
        log(f"PHASE3 attempt {tag} failed; trying next fallback if any")

    result = {
        "phase": 3,
        "ok": bool(winner and winner.get("ok")),
        "winner": None if not winner else winner.get("tag"),
        "attempts": tried,
        "n_ui_min": int(p3["n_ui_min"]),
        "note": (
            "Raw Envelope TIA often fails Mode=5 fine_tune_UI_by_slope "
            "('wvfm is too short' can mean edges too soft, not just length). "
            "Workbench retries decision-directed sharp PAM4, then Tx-eye control."
        ),
    }
    if winner:
        result.update({k: winner[k] for k in ("eye_rx_n", "eye_csv", "measured_csv", "measured_n_ui", "length_ok") if k in winner})
    elif tried:
        result["error"] = tried[-1].get("error")
    else:
        result["error"] = "no PHASE3 attempts (missing CSVs)"
    write_json(run_dir / "phase3_manifest.json", result)
    log(f"PHASE3 DONE ok={result['ok']} winner={result.get('winner')}")
    return result



def main():
    ap = argparse.ArgumentParser(description="EOE workbench PHASE3 Rx AMI")
    ap.add_argument("--config", default=None)
    ap.add_argument("--run-dir", default=None)
    ap.add_argument("--measured-csv", default=None)
    ap.add_argument("--second-csv", default=None)
    args = ap.parse_args()
    cfg, run_dir, stamp, log, dirs = bootstrap(args.config, args.run_dir)
    result = run_phase3(
        cfg,
        run_dir,
        stamp,
        log,
        dirs,
        measured_csv=Path(args.measured_csv) if args.measured_csv else None,
        second_csv=Path(args.second_csv) if args.second_csv else None,
    )
    if result.get("skipped"):
        return
    if not result.get("ok"):
        raise SystemExit(4)


if __name__ == "__main__":
    main()
