# sipho-eoe-workbench

Headless SiPho PAM4 EOE workbench (netlists + scripts calling Keysight ADS `hpeesofsim`) and a DSH plugin UI to configure and run it. No ADS Ethernet Setup GUI.

## Layout

- `workbench/` — CLI: PHASE1 Tx AMI → PHASE2 SiPho Envelope optics → PHASE3 Rx AMI
- `dsh-eoe-workbench/` — DSH plugin; after install, open **EOE 工作台** in the DSH sidebar

## Quick start (CLI)

1. Copy `workbench/config.example.yaml` to `workbench/config.yaml` and edit paths.
2. Place Keysight sample `my_Ethernet_Tx` / `my_Ethernet_Rx` AMI (PAM4, not PCIe NRZ) in the directories named in the config. Those vendor binaries are **not** in this repository; copy them from your ADS Ethernet EOE example or `SiPho_PAM4_106G_EOE_wrk\data`.
3. Run:

```bat
cd workbench
bin\run_eoe.cmd
```

Requires ADS 2027 (`HPEESOF_DIR`). See `workbench/README.md`.

## DSH plugin

See `dsh-eoe-workbench/USAGE.md`. Install into the desktop profile:

```bat
pwsh -NoProfile -ExecutionPolicy Bypass -File dsh-eoe-workbench\tools\install.ps1 -Profile desktop
```

Then fully quit and restart DSH.

## What is not included

- Simulation outputs (`.ds`, logs, `workbench/sim/`)
- Keysight `my_Ethernet` AMI `.dll` / `.so` / IBIS models
- ADS workspace / schematics

TDECQ numbers from the hook are COMPUTED (IEEE 802.3bs 121.8.5-style post-process), not FlexDCA, and are not compliance results.
