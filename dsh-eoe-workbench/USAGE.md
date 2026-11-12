# EOE 工作台 · 安装与使用

## 0. 当前安装状态（重要，不美化）

| 项目 | 状态 |
|---|---|
| 源码目录 | `C:\Users\z3312\.dsh\local-plugins\dsh-eoe-workbench` |
| 工作区测试 profile | 已装入 `C:\Users\z3312\.dsh\local-plugins\.dsh-test\profiles\eoe`，真实 DSH Web 已加载 host + client |
| **真实 desktop profile** | **未写入**。`C:\Users\z3312\.dsh\profiles\desktop` 在本次会话的 workspace-write 沙箱之外，`pwsh` 与文件工具都被拒绝；本会话没有可用的 approval channel，`danger-full-access` 升级失败，因此没有伪造“已安装”。 |
| desktop package.json 引用 | **尚未引用**；需在普通终端执行第 1 节命令后才会写入。 |
| 截图 | 未截。沙箱内 headless Chromium 因 mojo/命名管道被拒绝而无法启动；没有可用 GUI 控制通道。没有伪造截图。 |

如果你在正常桌面终端里执行下面的一行安装命令，并重启 DSH，入口就会出现：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\Users\z3312\.dsh\local-plugins\dsh-eoe-workbench\tools\install.ps1" -Profile desktop
```

> 安装脚本会创建一个 junction：
> `...\profiles\desktop\node_modules\@local\dsh-eoe-workbench` →
> `C:\Users\z3312\.dsh\local-plugins\dsh-eoe-workbench`，
> 备份 `package.json`，然后加入 `dependencies` 和 `dsh.profile.bundles`。
> 它不会重启 DSH，也不会改动 workbench 的仿真文件。

---

## 1. 安装 / 打开

### 1.1 安装到 desktop

在**普通 PowerShell**（对 `.dsh\profiles\desktop` 有写权限）中：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\Users\z3312\.dsh\local-plugins\dsh-eoe-workbench\tools\install.ps1" -Profile desktop
```

期望输出：

```text
Installed @local/dsh-eoe-workbench into profile 'desktop'.
  link    : ...\profiles\desktop\node_modules\@local\dsh-eoe-workbench -> C:\Users\z3312\.dsh\local-plugins\dsh-eoe-workbench
  package : ...\profiles\desktop\package.json
  backup  : ...\package.json.bak-eoe-<时间戳>
Restart DSH to load the host + client halves.
```

### 1.2 手动安装（脚本不可用时）

1. 建 junction（目标已存在则跳过）：

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\dsh-eoe-workbench" `
  -Target "$env:USERPROFILE\.dsh\local-plugins\dsh-eoe-workbench"
```

2. 在 `C:\Users\z3312\.dsh\profiles\desktop\package.json` 中：
   - `dependencies` 加 `"@local/dsh-eoe-workbench": "file:../../local-plugins/dsh-eoe-workbench"`
   - `dsh.profile.bundles` 末尾加 `"@local/dsh-eoe-workbench"`
3. 重启 DSH 桌面/Web。

### 1.3 打开

完整退出并重启 DSH：

- 桌面：托盘退出 / 关闭所有窗口后重新启动 `DeepSeek Harness`。
- 左侧栏底部会多出 **“EOE 工作台”**（光环形 + 波形图标）。
- 点击后主区域打开 EOE 页面。也可以从“插件”管理页确认
  `@local/dsh-eoe-workbench` 已启用。
- 没有入口时：
  - 确认 `package.json` 的 `dsh.profile.bundles` 含该包名；
  - 运行 `dsh --profile desktop --dump-config`，应能看到：
    `- id: eoe-workbench` / `name: '@local/dsh-eoe-workbench'`；
  - 检查 DSH 日志中的插件加载错误；
  - 确认不是只重启了 Web 页面而没有重启 DSH 进程。

### 1.4 本机已验证的测试入口

工作区里有一个**测试 profile**，用于在不改 desktop 的情况下验证：

```powershell
$env:DSH_HOME="C:\Users\z3312\.dsh\local-plugins\.dsh-test"
dsh --profile eoe --port 3092 --no-open
```

打开终端打印的 `http://127.0.0.1:3092/?token=...`。该 profile 已包含
`@local/dsh-eoe-workbench`，并已被验证：
- `/api/eoe/*` host API 正常；
- DSH HTML 预加载 `/plugins/??@local/dsh-eoe-workbench/client.js...`；
- 真实 smoke 结果、TDECQ 和眼图 CSV 可在页面中读取。

测试 profile 不是 desktop profile，不能替代第 1.1 步。

---

## 2. 页面结构

| 区域 | 作用 |
|---|---|
| 顶部状态 | IDLE / RUNNING / PASS / FAILED；速率、模式、FROM-PHASE；一键运行/取消 |
| 左侧 Phase Rail | PHASE 01 Tx AMI / 02 光引擎 / 03 Rx AMI 的信号链状态、最近运行、from-phase |
| `配置` 标签 | 可视化表单 + 运行控制 + 预检 + 命令预览 |
| `运行` 标签 | 运行进度、pid、日志/控制台、FOLLOW/过滤/复制 |
| `结果 / 眼图` 标签 | compact summary、相位判定、TDECQ、artifact 表、CSV 密度眼图 |
| 右侧 RUN DECK（宽屏） | 启动/取消、短冒烟开关、预检列表、最近 run |

没有外网依赖：React 由 DSH 平台提供，图标为内联 SVG，字体使用本机
Bahnschrift / Cascadia 系列，无 CDN / webfont / 图标包。

---

## 3. 字段说明

### 3.1 LINK PROFILE

| 字段 | 默认 | 说明 |
|---|---|---|
| BITRATE (Gb/s) | `106.25` | PAM4 总码率；修改时若 baud 仍处于半速率同步状态，会自动更新 baud |
| BAUD (GBd) | `53.125`（`5.3125e10` Hz） | 符号率；PAM4 期望 baud = bitrate / 2 |
| WAVELENGTH (nm) | `1310` | 仅写入配置；实际 1310 nm 光引擎由 PHASE2 模板决定 |
| Format | `PAM4`（锁定） | 硬约束：my_Ethernet PAM4，不允许改成 BCM / PCIe NRZ |

### 3.2 AMI ASSETS / CHANNEL

| 字段 | 默认 | 说明 |
|---|---|---|
| TX AMI DIR | `...\data\my_Ethernet_Tx` | 包含 `.ibs`、模型 DLL、`passthrough.s4p` |
| RX AMI DIR | `...\data\my_Ethernet_Rx` | 同上 |
| TX IBIS / RX IBIS | `my_Ethernet_Tx.ibs` / `my_Ethernet_Rx.ibs` | 相对各自目录的文件名 |
| 通道 s4p | `passthrough.s4p` | PHASE1/3 netlist 从 Tx/Rx AMI 目录读取的通道文件 |
| TX/RX COMPONENT | `my_Ethernet_Tx/Rx` | IBIS component 名 |
| TX MODE | `1`（锁定） | 只用 Tx AMI Mode=1 GetWave |

### 3.3 PHASE 1 — Tx AMI

| 字段 | 默认 | 说明 |
|---|---|---|
| N_BITS | `5120` | ChannelSim NumberOfBits |
| BLOCK_SIZE | `256` | ChannelSim BlockSize |
| PTS / UI | `10` | NumberTimePtPerUI |
| TX IGNORE BITS | `10` | Tx AMI Ignore_Bits |
| RX IGNORE BITS | `64` | Rx AMI Ignore_Bits |

### 3.4 PHASE 2 — 光引擎 / Envelope

| 字段 | 默认 | 说明 |
|---|---|---|
| N_UI | `4608` | 完整链路建议 ≥4352；`--short` 会强制压到 ≤512 |
| OS_FACTOR | `8` | Envelope 过采样因子 |
| PWL TARGET POINTS | `5000` | Tran 桥 PWL 目标点数 |
| ENVELOPE TEMPLATE | `templates/sipho_envelope_phase2.net` | 相对 workbench 的模板 |

### 3.5 PHASE 3 — Rx AMI / 判决

| 字段 | 默认 | 说明 |
|---|---|---|
| N_BITS | `4608` | ChannelSim 长度 |
| N_UI_MIN | `4480` | 需明显 >4288 bit；`--short` 会跳过 PHASE3 |
| DISCARD_UI | `64` | 丢弃的 UI 数 |
| PTS / UI | `10` | 重采样到同一 dt |
| MEASURED | `auto` | `auto` → 软 TIA → sharp TIA → Tx 眼对照；也可强制 `tia_soft` / `tx_eye` |
| USE SECOND MEASURED | `false` | 是否把第二测量波形交给 CHANNEL |
| Fallback 重试 | 开 | 失败后继续尝试后续 measured 候选 |
| TDECQ 钩子 | 开 | PHASE2 成功后计算 COMPUTED TDECQ；可被 `--no-tdecq` 关闭 |

### 3.6 运行控制

| 字段/开关 | 说明 |
|---|---|
| RUN-DIR | 留空 = `results_root\run_<本地时间戳>`；填了就必须在 `results_root` 或 `workroot` 下 |
| FROM-PHASE | 1/2/3；增量运行复用同一 run-dir 的前序产物 |
| 短冒烟 `--short` | PHASE1 `n_bits≤1024`、PHASE2 `n_ui≤512`，并跳过 PHASE3；只用于 CLI/许可证/网表冒烟 |
| 关闭 TDECQ `--no-tdecq` | 不再生成 `tdecq_12185_hook.json` |
| 保留默认 TDECQ | 与上一个开关互补，避免两个开关状态矛盾 |
| 保存配置快照 | 写到 `results_root\_config_snapshots\snapshot_<时间戳>\config.yaml` |
| 恢复载入值 | 把表单恢复为打开页面时读取的 config.yaml（不写盘） |
| 写回默认配置 | 先询问确认；备份 `config.yaml.bak-eoe-<时间戳>` 后再覆盖工作台默认文件 |

### 3.7 路径与环境（高级折叠区）

`workroot`、`hpeesof_dir`、`python`、`wrk`、`official_eoe_wrk` 均可编辑。
运行时会设置 `HPEESOF_DIR` 并调用 `bin\run_eoe.cmd`；脚本自身再设置
`PYTHONPATH` / PDK 变量。

---

## 4. 保存行为（不覆盖默认配置）

1. 打开页面：只**读取** `workbench\config.yaml`，不写回。
2. 点击运行：把当前表单序列化到
   `<run-dir>\config.yaml`，并以显式 argv 传给 CLI：
   ```text
   bin\run_eoe.cmd --config <run-dir>\config.yaml --run-dir <run-dir> --from-phase 1
   ```
3. 点击“保存配置快照”：写到 results_root 下的独立快照目录。
4. 只有点击“写回默认配置”并确认，才会：
   - 备份 `config.yaml` 为 `config.yaml.bak-eoe-<时间戳>`；
   - 写入表单内容。
5. 已有 run-dir 的 `config.yaml` 被复用时会先创建
   `config.yaml.bak-<时间戳>`。

---

## 5. 跑一次 `--short` 冒烟

### 5.1 从界面

1. 打开 `EOE 工作台` → `配置`。
2. 打开 **短冒烟 --short** 开关；右侧/顶部出现
   “SHORT / SKIPS P3”、“运行短冒烟”。
3. 确认预检为 `PREFLIGHT PASS`。
4. 点击 **启动短冒烟（跳过 PHASE3）**。
5. 自动切到 `运行` 标签，观察 pid、耗时、`run_log.txt` / stdout。
6. 结束后看 `结果 / 眼图` 或“最近运行”。

短冒烟不会产出完整 PHASE3 结果，**不要把它当作完整链路验收**。

### 5.2 等价 CLI

```powershell
cd C:\Users\z3312\Documents\sipho_link\workbench
bin\run_eoe.cmd --config <run-dir>\config.yaml --run-dir <run-dir> --from-phase 1 --short --no-tdecq
```

插件只调用 `bin\run_eoe.cmd`，不重写 `run_eoe.py` / phase 脚本。

---

## 6. 结果在哪

默认结果根：

```text
C:\Users\z3312\Documents\sipho_link\results\eoe_workbench\
```

一次运行（`run_<时间戳>` 或自定义目录）通常包含：

- `config.yaml`：本次实际使用的配置（插件写入）
- `run_log.txt`：工作台逐行日志
- `plugin_console.log`：插件捕获的 stdout/stderr（run_log 尚未建立时的崩溃也在这里）
- `summary.json`：总结果 / 失败阶段
- `phase1_manifest.json`、`phase2_manifest.json`、`phase3_manifest.json`
- `phase1_logFile.txt`、`phase2_sipho_logFile.txt`、`phase3_logFile_*.txt`
- `Tx_AMI_Eye_P/N.csv`、`Tx_AMI_diff_scaled.csv`
- `Rx_TIA_Vout.csv`、`N_pam_bb.csv`
- `RxAMI_Eye_Rx*.csv`（CSV 眼图数据）
- `phase1_tx_eye.png`、`phase2_tia_eye.png`、`phase3_rx_ami_eye*.png`（已有图）
- `*.ds`（ADS dataset，二进制；浏览器只展示元数据）
- `tdecq_12185_hook.json`（若未 `--no-tdecq`）

页面里的“眼图”优先读取 `RxAMI_Eye_Rx*.csv` / `Tx_AMI_Eye_P.csv`，
按 `baud_hz` 折回成密度网格；不依赖外网图像服务。

---

## 7. 自检证据与本会话的边界

详见 `docs/SELFTEST.md` 和 `docs/selftest/*.log`。

- host API：13 项检查通过（配置解析、预检、argv、dry-run 不建目录、
  runs/summary/artifacts/file、真实 smoke 读取、眼图折叠、路径穿越拒绝、
  缺少 mutation header 拒绝、配置快照 round-trip）。
- UI：React DOM 真机渲染（mock API 8 请求）通过；真实 host API + 真实
  `smoke_20261112` 结果 + 眼图 CSV 集成渲染通过。
- spawn/cancel：fake CLI 生命周期测试通过（spawn → 读日志 → cancel →
  cancelled）。
- 真实 `--short`：pid 6796 已 spawn，捕获到日志头；随后因沙箱禁止写
  `workbench\sim\eoe\hpeesofsim.cfg` 而 `PermissionError`。未伪装完整仿真。
- 未跑完整 4608 UI；未声称跑过。
- 未截图；没有伪造截图。

---

## 8. 常见问题

**页面显示“控制接口不可用”**
host 半边没有加载或 DSH 未重启。确认 desktop `package.json` 已引用包，
重启 DSH。必要时看 `dsh --profile desktop --dump-config` 是否含
`eoe-workbench`。

**`PREFLIGHT BLOCKED`**
按红点逐项修路径：`run_eoe.cmd`、`hpeesofsim`、AMI 目录/IBIS/s4p、
Envelope 模板。`结果根目录` 不存在只是 warning，运行时会创建。

**运行按钮一直灰色**
预检有 error，或已有任务在跑。看右侧 PREFLIGHT 列表；任务结束/取消后
按钮恢复。

**短冒烟后没有 PHASE3 眼**
正常：`--short` 跳过 PHASE3。把短冒烟关掉，跑完整链路。

**PHASE3 winner=tx_eye**
是工作台在软 TIA / sharp TIA 失败后的 Tx 眼对照回退，不是软 TIA 闭环。
页面会显示橙色回退提示。

**TDECQ 能不能当合规？**
不能。它是 `COMPUTED 802.3bs 121.8.5-style`，不是 FlexDCA，也不是
compliance 结论。
