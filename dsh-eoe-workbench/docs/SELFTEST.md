# EOE Workbench · Self-test evidence

This file records exactly what ran, what passed, and what is still blocked.
No result below is synthetic "pretend it worked".

## Environment

- Host: `C:\Users\z3312\.dsh\local-plugins\.dsh-test\profiles\eoe`
  (workspace-local DSH Web profile with `@deepseek-ai/dsh-base`,
  `@deepseek-ai/dsh-web-app`, `@local/dsh-eoe-workbench`)
- DSH Web port used for live tests: `3092` (test instance only)
- Workbench: `C:\Users\z3312\Documents\sipho_link\workbench`
- Real smoke artifacts: `...\results\eoe_workbench\smoke_20261112`

## Host API

Command: `node tools/selftest.mjs`

Log: `docs/selftest/host-api.log`

Result: **13/13 passed**

- config.yaml parsed; bitrate `106.25`, baud `53125000000`, phase2 `n_ui=4608`
- preflight 16 checks; argv preview uses `bin\run_eoe.cmd` with `--run-dir`
- dry-run with `--short --no-tdecq` returns argv and does not create the run dir
- `/runs`, `/summary`, `/artifacts`, `/file`, `/eye` work
- real `smoke_20261112` summary parsed: winner `tx_eye`, eye CSV 17,920 points
- path traversal from `C:\Windows\win.ini` rejected 403
- mutation without `x-eoe-workbench: 1` rejected 403
- config snapshot round-trips through the YAML serializer
- no write to real workbench sim dirs

## UI DOM (mocked API)

Command: `node tools/ui-dom-test.cjs`

Log: `docs/selftest/ui-dom.log`

Result: **PASS**

- real client module loaded through the same `__ModuleLoader__.load` contract
- sidebar `main` and `sidebar.panellist` slots registered
- setup rendered: brand, one-click full-link action, preflight pass, AMI,
  recent runs
- analysis rendered: summary, TDECQ disclaimer, phase verdicts, artifacts
- run view rendered archived run_log tail
- no React runtime/key warnings after the `h()` helper fix

## UI against real host API + real smoke artifacts

Command: `node tools/ui-live-dom-test.cjs 3092` (test DSH web instance)

Log: `docs/selftest/ui-live.log`

Result: **PASS**

- loaded live config/preflight from `/api/eoe/*`
- selected `smoke_20261112`
- rendered `tx_eye` winner and TDECQ
- fetched `RxAMI_Eye_Rx_tx_eye.csv` through `/eye` and rendered the folded
  density eye sample count
- rendered artifact table and console
- 9 API requests; 1 eye request

Note: jsdom is used as the DOM renderer because headless Chromium cannot start
its mojo named-pipe transport inside the DSH sandbox. The UI code is the real
`client.js`, not a reimplementation.

## Spawn / live log / cancel

Command: `node tools/cancel-test.mjs`

Log: `docs/selftest/cancel.log`

Result: **PASS**

- fake local `bin\run_eoe.cmd` spawned via argv
- `plugin_console.log` polled while running
- `POST /cancel` accepted
- job settled as `cancelled`

The test uses a fake workbench root in the workspace; it never touches ADS.

## Real `--short` spawn (not the full 4608 UI run)

Command path: plugin API `POST /api/eoe/run` on the test DSH instance,
`fromPhase=1`, `short=true`, `noTdecq=true`, results root in the plugin
workspace.

Evidence: `docs/selftest/short-spawn.log`

Result: **spawn succeeded, simulation blocked by sandbox**

- pid `6796`
- argv:
  `bin\run_eoe.cmd --config ...\.run-test\run_20261112_234928\config.yaml
  --run-dir ...\.run-test\run_20261112_234928 --from-phase 1 --short --no-tdecq`
- live console captured a Python traceback:
  `PermissionError: [Errno 13] Permission denied:
  C:\Users\z3312\Documents\sipho_link\workbench\sim\eoe\hpeesofsim.cfg`
- `run_eoe.cmd`'s `endlocal` returns 0 even on the Python failure, so the plugin
  does **not** trust exit code alone: no `summary.json` means failed, with the
  captured log line attached. `GET /job` correctly returned
  `status=failed`, `progress.label=运行失败`.

This proves the plugin spawn + log capture + failure classification. It does
not prove hpeesofsim/license execution because the sandbox disallows writing
the workbench's own `sim\eoe` directory.

## Desktop installation

Not installed. `C:\Users\z3312\.dsh\profiles\desktop` is outside the
workspace-write sandbox; both `pwsh` and the file tool were denied, and the
danger-full-access escalation reported:
`requires approval, but no approval channel is available`.

Therefore:

- desktop `package.json` is **not** modified
- desktop package does **not** yet reference the plugin
- the plugin is fully installed and verified in the workspace-local test
  profile instead

Exact completion command (normal terminal with write access):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\Users\z3312\.dsh\local-plugins\dsh-eoe-workbench\tools\install.ps1" -Profile desktop
```

Then fully restart DSH and open the sidebar entry **“EOE 工作台”**.

## Screenshot

Not captured. See `docs/screenshots/README.md`; no image was fabricated.
