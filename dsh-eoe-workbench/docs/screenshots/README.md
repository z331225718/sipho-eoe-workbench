# Screenshots

No screenshot was captured in this session.

Reasons:

- The DSH sandbox blocks headless Chromium / Edge from starting their mojo
  named-pipe transport (`FATAL: platform_channel.cc: Check failed: ... 拒绝访问`).
- Playwright cannot spawn its browser subprocess with piped stdio under the
  same sandbox (`PermissionError: [WinError 5]`).
- No Orca runtime / visible GUI control channel was available to drive an
  already-running desktop window.

The page itself was verified by real React DOM rendering against the live
`/api/eoe` host and the real `smoke_20261112` artifacts; see
`docs/SELFTEST.md`.

Do not add a synthetic or mock screenshot here and call it a real capture.
