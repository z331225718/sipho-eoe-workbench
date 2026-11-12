# @local/dsh-eoe-workbench

EOE Workbench for the DSH desktop/Web GUI. It is a thin, local control surface
over the existing headless SiPho link CLI:

```
C:\Users\z3312\Documents\sipho_link\workbench\
  bin\run_eoe.cmd
  run_eoe.py
  config.yaml
  phase1_tx_ami.py -> phase2_optics.py -> phase3_rx_ami.py
```

The plugin does **not** reimplement the simulation kernel, does not touch the
PAM4_106G_EOE_Link schematic, and does not drive the ADS GUI / Ethernet Setup /
Mode=5 BatchSimSweep.

## What the page does

- Visual editor for the real `config.yaml` shape: link rate, AMI/IBIS dirs,
  channel s4p, PHASE1/2/3 lengths and knobs, TDECQ switch, paths, run flags.
- Defaults are parsed from the authoritative `workbench\config.yaml`; a run
  writes a copy to the run directory. The default file is only overwritten by
  the explicit, confirmed "写回默认配置" action after a `.bak-eoe-*` backup.
- One-click full link (`PHASE1 -> PHASE2 -> PHASE3`) or a deliberate
  `--short` smoke that skips PHASE3. `--from-phase`, `--no-tdecq`, and a
  custom `run-dir` are also exposed.
- Live status: pid, elapsed time, phase, progress, bounded `run_log.txt` /
  stdout tail, cancel with `taskkill /T` plus a direct-child fallback.
- Results: compact `summary.json`, phase verdicts, TDECQ (clearly labelled
  COMPUTED, not FlexDCA/compliance), artifact browser, CSV/PNG/JSON/LOG
  previews, and a density eye diagram folded from a real eye CSV.
- Loopback-only control API; mutating calls require the `x-eoe-workbench: 1`
  header and same-origin intent. Commands are argv arrays; no user string is
  concatenated into a shell.

## Files

| File | Role |
|---|---|
| `package.json` | DSH bundle + client declaration (`dsh.client`, `./client` export) |
| `cordis.patch.yml` | Inserts the host loader row |
| `index.js` | Host API: config, preflight, spawn, job, cancel, runs, summary, artifacts, file, eye |
| `client.js` | Browser half: sidebar panel + main page, instrument-style UI |
| `tools/install.ps1` | Junction + profile `dependencies` + `dsh.profile.bundles` |
| `tools/selftest.mjs` | Host API black-box tests (13 checks) |
| `tools/cancel-test.mjs` | Fake CLI spawn -> live log -> cancel lifecycle test |
| `tools/ui-dom-test.cjs` | React DOM test with mocked host API |
| `tools/ui-live-dom-test.cjs` | React DOM against the real host API + smoke artifacts |
| `USAGE.md` | Install/open/fields/results instructions |
| `docs/SELFTEST.md` | Evidence and exact limits of what was run |

## API

Prefix `/api/eoe`, registered through `webServer.register({kind:"prefix"})`:

```
GET  /status
GET  /config
POST /preflight
POST /config/save          target=snapshot|default
POST /run                  dryRun=true is supported
GET  /job
POST /cancel
GET  /runs
GET  /run-log?runDir=...
GET  /summary?runDir=...
GET  /artifacts?runDir=...
GET  /file?path=...&runDir=...
GET  /eye?path=...&runDir=...&baud_hz=...
```

## Development checks

From the plugin directory:

```powershell
node tools/selftest.mjs
node tools/cancel-test.mjs
node tools/ui-dom-test.cjs
# with a workspace-local DSH web profile on :3092
node tools/ui-live-dom-test.cjs 3092
```

The `.eoe-uitest` directory next to this plugin is only a local test dependency
(React/jsdom). It is not imported by the plugin and is not required at runtime.
The test scripts also accept `EOE_UITEST_DEPS` pointing at a node_modules path.

## Honest limits

- The plugin has been loaded by a real DSH Web runtime from a workspace-local
  test profile. Installing into the real `desktop` profile requires write
  access to `C:\Users\z3312\.dsh\profiles\desktop`; the session sandbox denied
  it and no approval channel was available. Use `tools/install.ps1 -Profile
  desktop` from a normal terminal, then restart DSH.
- A real `--short` CLI was spawned and its live console was captured. The
  workbench then hit `PermissionError` while writing its own
  `workbench\sim\eoe\hpeesofsim.cfg`, because this session's sandbox only
  permits the plugin workspace. The sandbox block is not a plugin/CLI syntax
  failure; run in a normal DSH desktop session to reach hpeesofsim.
- No GUI screenshot was captured. Headless Chromium cannot start its IPC in
  this sandbox, and no visible GUI control channel was available. See
  `docs/screenshots/README.md`; no image was fabricated.
- `--short` intentionally skips PHASE3. A full 4608-UI run was not claimed or
  attempted.
- PHASE3 may fall back to `tx_eye` because the soft TIA hits Mode=5
  `fine_tune_UI_by_slope: wvfm is too short`. The UI calls this out; it is not
  a soft-TIA closed loop.
- TDECQ is the workbench's `COMPUTED` 802.3bs 121.8.5-style hook, not FlexDCA
  and not a compliance measurement.
