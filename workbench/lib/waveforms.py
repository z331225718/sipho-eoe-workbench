# -*- coding: utf-8 -*-
"""Eye dump / resample / scale helpers."""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from .ads_env import ds_dump


def dump_eye_vector(ds_path: Path, vec_name: str) -> np.ndarray:
    dump = ds_dump().dump_ds(str(ds_path))
    marker = f'Vectorset name: "{vec_name}"'
    idx = dump.find(marker)
    if idx < 0:
        return np.zeros((0, 2))
    block = dump[idx : idx + 3_000_000]
    m = re.search(r"Number of points:\s*(\d+)", block)
    npts = int(m.group(1)) if m else 0
    pts = []
    for mm in re.finditer(r"(?m)^(\d+):\s*([eE0-9.+\-]+)\s*\n([eE0-9.+\-]+)\s*$", block):
        pts.append((float(mm.group(2)), float(mm.group(3))))
        if npts and len(pts) >= npts:
            break
    return np.asarray(pts, dtype=float) if pts else np.zeros((0, 2))


def save_csv(path: Path, t: np.ndarray, v: np.ndarray) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savetxt(path, np.column_stack([t, v]), delimiter=",")
    return path


def load_csv(path: Path) -> tuple[np.ndarray, np.ndarray]:
    a = np.loadtxt(path, delimiter=",")
    if a.ndim == 1:
        a = a.reshape(1, -1)
    return a[:, 0].astype(float), a[:, 1].astype(float)


def zero_start(t: np.ndarray) -> np.ndarray:
    return t - t[0]


def scale_diff_to_halfvolt(t: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Scale a differential drive to about +/-0.5 V (proven PHASE2 input)."""
    sc = 0.5 / max(np.percentile(np.abs(v), 99.5), 1e-9)
    return np.clip(v * sc, -0.5, 0.5)


def scale_to_tx_swing(v: np.ndarray, peak: float = 1.0 / 6.0) -> np.ndarray:
    y = v - np.mean(v)
    sc = peak / max(np.percentile(np.abs(y), 99), 1e-9)
    return y * sc


def resample(t: np.ndarray, v: np.ndarray, dt: float, tspan: float | None = None):
    t0 = t - t[0]
    if tspan is None:
        tspan = float(t0[-1])
    tg = np.arange(0.0, tspan, dt)
    if len(tg) < 2:
        raise ValueError("resample produced <2 points")
    return tg, np.interp(tg, t0, v)


def n_ui(t: np.ndarray, baud_hz: float) -> float:
    if len(t) < 2:
        return 0.0
    return float((t[-1] - t[0]) * baud_hz)


def decimate_pwl(t: np.ndarray, v: np.ndarray, n_target: int) -> np.ndarray:
    step = max(1, len(t) // n_target)
    dec = np.column_stack([t, v])[::step]
    if dec[-1, 0] < t[-1]:
        dec = np.vstack([dec, [t[-1], v[-1]]])
    return dec


def pwl_expr(dec: np.ndarray) -> str:
    parts = ["time"]
    for tt, vv in dec:
        parts.append(f"{tt:.6e}")
        parts.append(f"{vv:.8f}")
    return "pwl(" + ", ".join(parts) + ")"


def fold_plot(path: Path, t: np.ndarray, v: np.ndarray, ui: float, title: str) -> Path | None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return None
    start = int(0.05 * len(t))
    t0 = t[start:] - t[start]
    y = v[start:]
    tf = np.mod(t0, 2 * ui)
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(tf / ui, y, ",", alpha=0.35)
    ax.set_xlim(0, 2)
    ax.set_xlabel("UI")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return path


def find_best_phase(t: np.ndarray, v: np.ndarray, baud_hz: float, n_phase: int = 20) -> float:
    ui = 1.0 / baud_hz
    best, best_score = 0.0, -1.0
    n_ui = int((t[-1] - t[0]) * baud_hz) - 4
    t0 = t - t[0]
    for k in range(n_phase):
        ph = (k / n_phase) * ui
        vals = [np.interp(ph + (i + 0.5) * ui, t0, v) for i in range(2, max(n_ui, 3)) if ph + (i + 0.5) * ui < t0[-1]]
        if not vals:
            continue
        score = float(np.std(vals))
        if score > best_score:
            best_score, best = score, ph
    return best


def synth_pam4_from_waveform(t: np.ndarray, v: np.ndarray, baud_hz: float, dt: float, rise_pts: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Decision-directed sharp PAM4 (proven Mode=5 precondition when Envelope TIA is too soft)."""
    levels = np.array([-1.0 / 6.0, -1.0 / 18.0, 1.0 / 18.0, 1.0 / 6.0])
    ui = 1.0 / baud_hz
    t0 = t - t[0]
    y = v - np.mean(v)
    # scale to Tx-like swing before slicing
    y = y * ((1.0 / 6.0) / max(np.percentile(np.abs(y), 99), 1e-9))
    phase = find_best_phase(t0, y, baud_hz)
    n_ui = int(t0[-1] * baud_hz) - 2
    syms = []
    for i in range(max(n_ui, 0)):
        ts = phase + (i + 0.5) * ui
        if ts >= t0[-1]:
            break
        x = np.interp(ts, t0, y)
        syms.append(int(np.argmin(np.abs(levels - x))))
    syms = np.asarray(syms, dtype=int)
    n_per = int(round(ui / dt))
    n = len(syms) * n_per
    out = np.zeros(n)
    for i, s in enumerate(syms):
        out[i * n_per:(i + 1) * n_per] = levels[s]
    if rise_pts > 0:
        for i in range(1, len(syms)):
            if syms[i] == syms[i - 1]:
                continue
            a, b = levels[syms[i - 1]], levels[syms[i]]
            for k in range(rise_pts):
                out[i * n_per + k] = a + (b - a) * (k + 1) / (rise_pts + 1)
    tt = np.arange(n) * dt
    return tt, out
