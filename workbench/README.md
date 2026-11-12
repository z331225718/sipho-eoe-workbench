# SiPho EOE 无头工作台（PHASE1–3）

绕开 ADS GUI / Ethernet Setup / 官方 Mode=5 `BatchSimSweep`。把已验证的「配对链」拆成网表 + Python 脚本，直接调 `hpeesofsim`（经 Keysight `CircuitSimulator.run_netlist`）。

本目录是镜像。本机权威副本：

`C:\Users\z3312\Documents\sipho_link\workbench\`

**不修改** 现有原理图 `sipho_link_lib:PAM4_106G_EOE_Link:schematic`。

---

## 架构

```
PHASE1  ChannelSim + my_Ethernet Tx AMI (Mode=1 GetWave)
        → Tx_AMI_Eye_P/N.csv , Tx_AMI_diff_scaled.csv , Phase1TxAMI_*.ds

PHASE2  电波形 → V_PWL Tran 桥 → VtDataset 注入 SiPho Envelope（53.125 GBd）
        → 光/TIA 基带 CSV + Phase2Optics_*.ds
        → 可选 121.8.5 风格 TDECQ 钩子（COMPUTED，不是 FlexDCA）

PHASE3  TIA（或对照 Tx 眼）重采样到同一 dt（UI/10），n_ui ≥ 4352
        → Mode=5 ChannelSim + my_Ethernet Rx AMI
        → RxAMI_Eye_Rx.csv , Phase3RxAMI_*.ds
```

官方三阶段无头 `BatchSim`（Photonics 在环时 PHASE1 `GetWave` 全零、PHASE3 `ami_ramp_up` / `wvfm is too short`）仍是硬阻塞，本工作台不走那条路。

AMI **只用** `wrk\data\my_Ethernet_{Tx,Rx}` 的 PAM4 样本模型。禁止 PCIe NRZ（本机 CTS Gen5 AMI 对不上 106G PAM4）。

---

## 相位契约

| 相位 | 输入 | 输出 | 仿真器 / cwd |
|------|------|------|----------------|
| 1 Tx AMI | `config.yaml` 里的 AMI 目录、码率、`n_bits` | `phase1_tx_ami.net`，`.ds`，`Tx_AMI_*.csv`，`pam4_symbols.txt`，`phase1_manifest.json` | ChannelSim，cwd=`workbench\sim\eoe` |
| 2 光引擎 | PHASE1 的 `Tx_AMI_diff_scaled.csv`（或 `--drive-csv`） | 桥 `.ds`，`phase2_sipho_envelope.net`，`Rx_TIA_Vout.csv`（已缩放到 Tx 摆幅），`N_pam_bb.csv`，可选 `tdecq_12185_hook.json` | Tran + Envelope HB，cwd=`SiPho_PAM4_106G_EOE_wrk`，输出在 `wrk\data\sipho_sim` |
| 3 Rx AMI | `Rx_TIA_Vout.csv`（默认）或 `Tx_AMI_Eye_P.csv`；与 Tx 同一 `dt=UI/10`；**n_ui ≥ 4480**（默认光学 4608 UI） | `phase3_rx_ami.net`，`.ds`，`RxAMI_Eye_Rx.csv` | ChannelSim Mode=5，cwd=`workbench\sim\eoe` |

106G 下 Mode=5 的 `fine_tune_UI_by_slope`：Measured 在 `discard=64` 之后需要 **严格大于约 4288 bit**。4352 UI 减 64 正好等于 4288，本次冒烟仍报 `wvfm is too short`。4096 UI 必挂。默认 `phase2.n_ui: 4608`。

---

## 怎么跑

在本机打开 **cmd**（不要依赖 GUI）：

```bat
cd /d C:\Users\z3312\Documents\sipho_link\workbench
bin\run_eoe.cmd
```

等价：

```bat
set HPEESOF_DIR=C:\Program Files\Keysight\ADS2027
set PYTHONPATH=C:\Program Files\Keysight\ADS2027\tools\python\Lib\site-packages
"C:\Program Files\Keysight\ADS2027\tools\python\python.exe" run_eoe.py --config config.yaml
```

常用开关：

```bat
bin\run_eoe.cmd --short
bin\run_eoe.cmd --no-tdecq
bin\run_eoe.cmd --from-phase 2 --run-dir C:\Users\z3312\Documents\sipho_link\results\eoe_workbench\run_YYYYMMDD_HHMMSS
```

也可以单相位：

```bat
"%HPEESOF_DIR%\tools\python\python.exe" phase1_tx_ami.py --config config.yaml --run-dir <dir>
"%HPEESOF_DIR%\tools\python\python.exe" phase2_optics.py --config config.yaml --run-dir <dir>
"%HPEESOF_DIR%\tools\python\python.exe" phase3_rx_ami.py --config config.yaml --run-dir <dir>
```

`--short`：PHASE1 `n_bits=1024`，PHASE2 `n_ui=512`，**跳过 PHASE3**（长度不够 Mode=5 fine_tune）。只用来确认 CLI / 许可证 / 网表能起来。完整闭环不要加 `--short`。

结果目录：`C:\Users\z3312\Documents\sipho_link\results\eoe_workbench\run_<时间戳>\`

里面有 `run_log.txt`、`summary.json`、各相位 manifest、网表、CSV、`.ds` 副本和仿真 log。

---

## ADS 二进制与环境变量

| 项 | 路径 |
|----|------|
| 推荐 Python | `C:\Program Files\Keysight\ADS2027\tools\python\python.exe`（3.14，已带 numpy / scipy / pandas / matplotlib / PyYAML / `keysight.edatoolbox.ads` / `keysight.ads.dataset`） |
| 备选 Python | `C:\Users\z3312\AppData\Local\Python\bin\python.exe`，需设 `PYTHONPATH` 到上面的 `site-packages` |
| 仿真器 | `C:\Program Files\Keysight\ADS2027\bin\hpeesofsim.exe` |
| 工作区 | `C:\Users\z3312\Documents\sipho_link\SiPho_PAM4_106G_EOE_wrk` |
| 官方金标（只引用 AMI / cfg，不跑 Mode=5 BatchSim） | `...\sipho_link\ref_examples\End_to_End_EOE_for_Ethernet_wrk\End_to_End_EOE_for_Ethernet_wrk` |

脚本启动时设置：

- `HPEESOF_DIR`
- `DESIGN_KIT_SIM_FILE_PATH`（Photonics PDK `circuit\data` + `circuit\models`）
- `DESIGN_KIT_MODEL_PATH`（`pdk\bin\win32_64`）
- `DESIGN_KIT_VERILOGA_PATH`（`pdk\veriloga`）
- `PYTHONIOENCODING=utf-8`

工作台会把 `hpeesofsim.cfg`、`ADSlibconfig` 和 `my_Ethernet_*` 拷到 `workbench\sim\eoe\`，避免依赖 Ethernet Setup 的 `ParametersData` 回调。

默认码率在 `config.yaml`：`106.25 Gbps` / `53.125e9` baud（任务目标）。早期配对冒烟用过 `106.0 / 53e9`；样本 AMI 无硬编码 DataRate，两者都可。

---

## TDECQ

PHASE2 成功后默认调用 `scripts\compute_tdecq_12185_to_ds.py` 里的算法，把结果写到运行目录的 `tdecq_12185_hook.json`。

这是 **802.3bs Clause 121.8.5 风格的 COMPUTED 值**，不是 FlexDCA，不能当合规指标。Envelope `|N_fiber_out|^2` 无噪声，`sigma_S` 默认 0，整体仍偏乐观。本机没有 FlexDCA。

`--no-tdecq` 可关掉。

---

## 仍存在的阻塞 / 限制

1. **官方 Mode=5 BatchSimSweep 无头不可用**：Photonics 在环时 PHASE1 拿不到真实 GetWave。本工作台用配对链绕开，不宣称已修复官方 BatchSim。
2. **PHASE3 软 TIA**：Envelope TIA 边沿过缓时，Mode=5 `fine_tune_UI_by_slope` 会报 `wvfm is too short`（不一定是真长度不够）。默认 `measured: auto`：先试软 TIA，失败则决策锐化 PAM4，再失败用 Tx 眼对照。
3. **PHASE3 长度**：`discard` 之后需要明显大于约 4288 bit；默认光学 `n_ui=4608`。`--short` 会跳过 PHASE3。
4. **样本 AMI**：`my_Ethernet_*` 不是 BCM85364 / Marvell 硅模型；盘上仍没有 BCM AMI。
5. **TDECQ**：非 FlexDCA；OMA 在无 6×0 / 7×3 图案时回退 L3−L0。
6. **电通道**：Thru 用的是 AMI 目录里的 `passthrough.s4p`，不是业务板级 Touchstone。
7. **Marvell CTLE / Zt=5500**：行为级假定，与先前光引擎网表一致。
8. 需要本机 ADS 2027 许可证；Envelope 4608 UI 在本机约十几秒，整链通常一分钟内。

---

## 目录

```
workbench/
  README.md
  config.yaml
  run_eoe.py
  phase1_tx_ami.py
  phase2_optics.py
  phase3_rx_ami.py
  bin/run_eoe.cmd
  lib/          # env, config, netlist, sim, waveforms, tdecq hook
  templates/sipho_envelope_phase2.net
  sim/eoe/      # 运行时生成：cfg + AMI 拷贝
```

镜像：`/workspace/deliverables/sipho_eoe_workbench/`（box）。
