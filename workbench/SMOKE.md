# 冒烟记录 — 2026-11-12 23:16–23:22 Asia/Shanghai (UTC+8)

运行目录：`C:\Users\z3312\Documents\sipho_link\results\eoe_workbench\smoke_20261112`

配置：106.25 Gb/s PAM4 / 53.125 GBd；`my_Ethernet` PAM4 AMI；不走官方 Mode=5 BatchSim。

## 结果

| 相位 | 状态 | 要点 |
|------|------|------|
| PHASE1 Tx AMI Mode=1 | 通过 | `Eye_P/N` 各 53760 pts，约 5376 UI，`Phase1TxAMI_20261112_231659.ds` 5.2 MB，ChannelSim CPU ≈ 1.0 s |
| PHASE2 Envelope | 通过 | n_ui=4608，tspan 86.74 ns，`Phase2Optics_20261112_231920.ds` 53.6 MB，Envelope CPU ≈ 14 s。TIA/N_pam 基带有开眼 |
| TDECQ 钩子 | 已算 | **14.455 dB COMPUTED**，OMA 走 L3−L0 回退。不是 FlexDCA，不能当合规。也不可与先前 PAM4_source 网的 2.087 dB 直接比 |
| PHASE3 Rx AMI | 通过（回退） | 软 TIA、锐化 TIA 仍报 `fine_tune_UI_by_slope: wvfm is too short`（4544 bit，长度已够）。**Tx 眼对照通过**，`Eye_Rx` 17920 pts，winner=`tx_eye` |

控制台：`results\eoe_workbench\smoke_console.txt`（PHASE1）、`smoke_console_resume2.txt`（PHASE2）、`smoke_console_resume3.txt`（PHASE3 回退）、`phase3_iso_console.txt`（码率对照）。

对照：Tx 眼在 106.0 与 106.25 都能出 Rx 眼；软 TIA 在两种码率下都失败。问题是 Envelope TIA 边沿形态，不是 106.25 本身。

## 调用

```bat
cd /d C:\Users\z3312\Documents\sipho_link\workbench
bin\run_eoe.cmd
```
