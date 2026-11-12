# -*- coding: utf-8 -*-
"""Optional 121.8.5-style TDECQ hook. COMPUTED, not FlexDCA, not compliance."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Callable


def run_tdecq(ds_path: Path, out_dir: Path, log: Callable[[str], None], baud_hz: float) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    info: dict = {
        "ok": False,
        "source_ds": str(ds_path),
        "claim": "COMPUTED 802.3bs 121.8.5-style — NOT FlexDCA, NOT compliance",
    }
    scripts = Path(r"C:\Users\z3312\Documents\sipho_link\scripts")
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    try:
        import numpy as np
        import compute_tdecq_12185_to_ds as tdecq
        import keysight.ads.dataset as dataset
    except Exception as e:
        info["error"] = f"import failed: {e!r}"
        log(f"TDECQ hook skipped: {e!r}")
        return info

    # Point the module's baud at this run (BT4 is 0.75*BAUD inside the module).
    tdecq.BAUD = float(baud_hz)
    tdecq.UI = 1.0 / tdecq.BAUD
    tdecq.BT_BW = 0.75 * tdecq.BAUD

    try:
        ds = dataset.open(str(ds_path))
        hb = ds["Env1.Env1.HB"].to_dataframe().reset_index()
        freqs = sorted(hb["freq"].astype(float).unique())
        fopt = max(freqs)
        op = hb[np.isclose(hb["freq"].astype(float), fopt)].sort_values("time")
        t = op["time"].to_numpy(float)
        E = np.asarray(op["N_fiber_out"], dtype=complex)
        P = np.abs(E) ** 2
        dt = float(np.median(np.diff(t)))
        fs = 1.0 / dt
        P_bt = tdecq.bessel_thomson_lpf_causal(P, fs, tdecq.BT_BW, order=4)
        _t_rs, P_rs, _ = tdecq.resample_to_os(t, P_bt, tdecq.OS)
        best = tdecq.optimize_tdecq_12185(P_rs, tdecq.OS)
        if best is None:
            raise RuntimeError("optimize_tdecq_12185 returned None")
        for k in ("_eq_waveform", "_samples", "_hists"):
            best.pop(k, None)
        # numpy types -> json
        def conv(x):
            if hasattr(x, "tolist"):
                return x.tolist()
            if isinstance(x, (np.floating,)):
                return float(x)
            if isinstance(x, (np.integer,)):
                return int(x)
            return x

        metrics = {k: conv(v) for k, v in best.items()}
        info["ok"] = True
        info["TDECQ_dB"] = float(best["TDECQ_dB"])
        info["metrics"] = metrics
        info["n_opt"] = int(len(t))
        info["fopt"] = float(fopt)
        dest = out_dir / "tdecq_12185_hook.json"
        dest.write_text(json.dumps(info, indent=2), encoding="utf-8")
        info["json"] = str(dest)
        log(
            f"TDECQ COMPUTED {info['TDECQ_dB']:.3f} dB "
            f"(NOT FlexDCA / NOT compliance) json={dest}"
        )
    except Exception as e:
        info["error"] = repr(e)
        log(f"TDECQ hook failed: {e!r}")
    return info
