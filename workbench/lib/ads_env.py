# -*- coding: utf-8 -*-
"""ADS / Photonics PDK environment and simulator-dir prep (no GUI)."""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

DEFAULT_HPEESOF = Path(r"C:\Program Files\Keysight\ADS2027")
DEFAULT_PYTHON = DEFAULT_HPEESOF / "tools" / "python" / "python.exe"


def hpeesof_dir(cfg: dict | None = None) -> Path:
    if cfg and cfg.get("hpeesof_dir"):
        return Path(cfg["hpeesof_dir"])
    env = os.environ.get("HPEESOF_DIR")
    if env:
        return Path(env)
    return DEFAULT_HPEESOF


def apply_env(cfg: dict | None = None) -> Path:
    """Set HPEESOF_DIR + Photonics PDK paths used by proven Envelope runs."""
    hp = hpeesof_dir(cfg)
    pdk = hp / "design_kit" / "Keysight_Photonics_pdk"
    os.environ["HPEESOF_DIR"] = str(hp)
    os.environ["DESIGN_KIT_SIM_FILE_PATH"] = (
        str(pdk / "circuit" / "data") + ";" + str(pdk / "circuit" / "models")
    )
    os.environ["DESIGN_KIT_MODEL_PATH"] = str(pdk / "bin" / "win32_64")
    os.environ["DESIGN_KIT_VERILOGA_PATH"] = str(pdk / "veriloga")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    site = hp / "tools" / "python" / "Lib" / "site-packages"
    if site.is_dir():
        sp = os.environ.get("PYTHONPATH", "")
        if str(site) not in sp.split(os.pathsep):
            os.environ["PYTHONPATH"] = str(site) if not sp else str(site) + os.pathsep + sp
    return hp


def hpeesofsim(cfg: dict | None = None) -> Path:
    exe = hpeesof_dir(cfg) / "bin" / "hpeesofsim.exe"
    if not exe.is_file():
        raise FileNotFoundError(f"hpeesofsim not found: {exe}")
    return exe


def preferred_python(cfg: dict | None = None) -> Path:
    if cfg and cfg.get("python"):
        p = Path(cfg["python"])
        if p.is_file():
            return p
    if DEFAULT_PYTHON.is_file():
        return DEFAULT_PYTHON
    return Path(os.environ.get("PYTHON", "python"))


def circuit_simulator():
    from keysight.edatoolbox.ads import CircuitSimulator

    return CircuitSimulator()


def ds_dump():
    from keysight.edatoolbox.ads import DSDump

    return DSDump()


def prepare_sim_dirs(cfg: dict, workbench_root: Path) -> dict[str, Path]:
    """Copy cfg + AMI trees into isolated sim dirs. Does not touch schematics."""
    wrk = Path(cfg["wrk"])
    official = Path(cfg["official_eoe_wrk"])
    eoe_sim = workbench_root / "sim" / "eoe"
    sipho_sim = wrk / "data" / "sipho_sim"
    eoe_sim.mkdir(parents=True, exist_ok=True)
    sipho_sim.mkdir(parents=True, exist_ok=True)

    ami = cfg["ami"]
    for name, src in (("my_Ethernet_Tx", Path(ami["tx_dir"])), ("my_Ethernet_Rx", Path(ami["rx_dir"]))):
        dst = eoe_sim / "data" / name
        if src.is_dir() and not dst.exists():
            shutil.copytree(src, dst)

    for cfgname in ("hpeesofsim.cfg", "ADSlibconfig"):
        for src_dir in (official, wrk, official.parent if official.name.endswith("_wrk") else official):
            src = Path(src_dir) / cfgname
            if src.is_file():
                shutil.copy2(src, eoe_sim / cfgname)
                if sipho_sim.is_dir():
                    shutil.copy2(src, sipho_sim / cfgname)
                break
        # wrk-level copies for Envelope cwd=wrk
        src_wrk = wrk / cfgname
        if src_wrk.is_file():
            shutil.copy2(src_wrk, sipho_sim / cfgname)

    return {"eoe_sim": eoe_sim, "sipho_sim": sipho_sim, "wrk": wrk, "official": official}
