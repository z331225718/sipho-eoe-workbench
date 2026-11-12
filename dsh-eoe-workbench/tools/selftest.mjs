// Black-box host API self-test. No DSH GUI and no simulation run by default.
//   node tools/selftest.mjs
//   node tools/selftest.mjs --spawn-short   (also starts a real --short CLI run)
//
// The test uses a workspace-local copy of config.yaml with a workspace-local
// results_root, so it does not write into the production results tree.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnShort = process.argv.includes("--spawn-short");
const pluginDir = process.cwd();
const testBase = join(pluginDir, ".selftest");
const testResults = join(testBase, "results");
rmSync(testBase, { recursive: true, force: true });
mkdirSync(testResults, { recursive: true });

const realConfigPath = "C:\\Users\\z3312\\Documents\\sipho_link\\workbench\\config.yaml";
const realConfig = readFileSync(realConfigPath, "utf8");
const testConfigText = realConfig.replace(
  /(^paths:\s*\r?\n\s*results_root:\s*).*$/m,
  "$1" + testResults.replace(/\\/g, "/")
);
const testConfigPath = join(testBase, "config.yaml");
writeFileSync(testConfigPath, testConfigText, "utf8");

process.env.EOE_CONFIG_PATH = testConfigPath;
process.env.EOE_STATE_DIR = mkdtempSync(join(tmpdir(), "eoe-plugin-state-"));
const mod = await import("../index.js");
const { apply, __test } = mod;

// A tiny synthetic run fixture exercises the artifact/summary/eye endpoints
// without copying the 50 MB ADS datasets.
const fixtureDir = join(testResults, "smoke_fixture");
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(
  join(fixtureDir, "summary.json"),
  JSON.stringify(
    {
      stamp: "20261112_000000",
      when: "2026-11-12 00:00:00 Asia/Shanghai (UTC+8)",
      run_dir: fixtureDir,
      bitrate_gbps: 106.25,
      baud_hz: 53125000000,
      format: "PAM4",
      short: true,
      from_phase: 1,
      phase1: { ok: true, n_bits: 1024, n_ui: 512, eye_p_n: 1024 },
      phase2: { ok: true, n_ui: 512 },
      phase3: { ok: false, skipped: true, reason: "short smoke" },
      ok: true,
      note: "short smoke skips PHASE3"
    },
    null,
    2
  )
);
writeFileSync(
  join(fixtureDir, "tdecq_12185_hook.json"),
  JSON.stringify({ ok: true, TDECQ_dB: 3.21, claim: "COMPUTED — NOT FlexDCA / NOT compliance", metrics: { ER_dB: 4.2, Q: 6.1 } }, null, 2)
);
writeFileSync(join(fixtureDir, "run_log.txt"), "fixture start\nPHASE1 DONE ok=True\nSUMMARY {'ok': True}\n");
const eyeCsv = [];
for (let i = 0; i < 1200; i += 1) {
  const t = i * 1.882352941e-12;
  const v = Math.sin((i / 10) * Math.PI * 2) * 0.5 + (i % 10) * 0.02;
  eyeCsv.push(t.toExponential(15) + "," + v.toExponential(15));
}
writeFileSync(join(fixtureDir, "RxAMI_Eye_Rx.csv"), eyeCsv.join("\n") + "\n");
writeFileSync(
  join(fixtureDir, "phase1_tx_eye.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    "base64"
  )
);

const routes = [];
const fakeCtx = {
  logger: { info() {}, warn: console.warn },
  effect(fn) {
    const dispose = fn();
    return () => dispose?.();
  },
  inject(names, callback) {
    if (names.includes("webServer")) {
      callback({
        effect(fn) {
          return fn();
        },
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          }
        }
      });
    }
  }
};

apply(fakeCtx);
assert.equal(routes.length, 1, "webServer route was not registered");

const server = createServer((req, res) => {
  const route = routes.find((item) => req.url.startsWith(item.path));
  if (!route) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  route.handler(req, res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/api/eoe`;

async function api(path, options = {}, expectStatus = 200) {
  const headers = {
    "x-eoe-workbench": "1",
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(base + path, { ...options, headers });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  assert.equal(response.status, expectStatus, `${path}: expected ${expectStatus}, got ${response.status}: ${text.slice(0, 400)}`);
  return payload;
}

const results = [];
function ok(name, detail = "") {
  results.push({ name, detail });
  console.log(`ok - ${name}${detail ? " :: " + detail : ""}`);
}

const status = await api("/status");
assert.equal(status.app, "eoe-workbench");
assert.equal(status.running, false);
ok("status", status.workbenchRoot);

const config = await api("/config");
assert.equal(config.config.link.bitrate_gbps, 106.25);
assert.equal(Number(config.config.link.baud_hz), 53125000000);
assert.equal(config.config.phase2.n_ui, 4608);
assert.equal(config.config.paths.results_root, testResults.replace(/\\/g, "/"));
ok("config defaults", config.path);

const preflight = await api("/preflight", {
  method: "POST",
  body: JSON.stringify({ config: config.config, flags: { fromPhase: 1 } })
});
assert.equal(preflight.ok, true, JSON.stringify(preflight.checks));
assert.match(preflight.command.preview, /bin\\run_eoe\.cmd/);
assert.match(preflight.command.preview, /--run-dir/);
ok("preflight", `${preflight.checks.items.length} checks; ${preflight.command.preview.slice(0, 100)}`);

const dry = await api("/run", {
  method: "POST",
  body: JSON.stringify({
    config: config.config,
    flags: { fromPhase: 1, short: true, noTdecq: true },
    dryRun: true
  })
});
assert.equal(dry.dryRun, true);
assert.match(dry.command.preview, /--short/);
assert.match(dry.command.preview, /--no-tdecq/);
assert.equal(existsSync(dry.runDir), false, "dry-run must not create the run directory");
ok("dry-run argv", dry.command.preview);

const runs = await api("/runs?limit=5");
assert.ok(Array.isArray(runs.runs));
assert.equal(runs.runs[0].name, "smoke_fixture");
ok("recent runs", `${runs.runs.length} found`);

const fixtureSummary = await api("/summary?runDir=" + encodeURIComponent(fixtureDir));
assert.ok(fixtureSummary.summary);
assert.equal(fixtureSummary.summary.short, true);
assert.ok(fixtureSummary.summary.eyeCsvs.length > 0);
ok("compact summary", `${fixtureSummary.summary.name}; eye csvs=${fixtureSummary.summary.eyeCsvs.length}`);

const artifacts = await api("/artifacts?runDir=" + encodeURIComponent(fixtureDir));
assert.ok(artifacts.artifacts.length > 0);
assert.ok(artifacts.artifacts.some((item) => item.kind === "image"));
assert.ok(artifacts.artifacts.some((item) => item.kind === "eye-csv"));
ok("artifacts", `${artifacts.artifacts.length} files`);

const eyeCsvInfo = fixtureSummary.summary.eyeCsvs[0];
const eye = await api(
  "/eye?runDir=" +
    encodeURIComponent(fixtureDir) +
    "&path=" +
    encodeURIComponent(eyeCsvInfo.path) +
    "&baud_hz=" +
    encodeURIComponent(String(fixtureSummary.summary.baudHz))
);
assert.equal(eye.grid.values.length, eye.grid.w * eye.grid.h);
assert.ok(eye.grid.max > 0);
ok("eye density", `${eye.samples} pts -> ${eye.grid.w}x${eye.grid.h}, max=${eye.grid.max}`);

const raw = await fetch(
  base +
    "/file?runDir=" +
    encodeURIComponent(fixtureDir) +
    "&path=" +
    encodeURIComponent(fixtureSummary.summary.images[0].path),
  { headers: { "x-eoe-workbench": "1" } }
);
assert.equal(raw.status, 200);
assert.match(raw.headers.get("content-type") || "", /image\/png/);
ok("image artifact", fixtureSummary.summary.images[0].name);

await api("/file?path=" + encodeURIComponent("C:\\Windows\\win.ini"), {}, 403);
ok("path traversal guard", "outside results -> 403");

const untrusted = await fetch(base + "/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ config: config.config })
});
assert.equal(untrusted.status, 403);
ok("mutation header guard", "missing header -> 403");

const saved = await api("/config/save", {
  method: "POST",
  body: JSON.stringify({
    config: { ...config.config, link: { ...config.config.link, bitrate_gbps: 106.0 } },
    target: "snapshot",
    runDir: join(testResults, "_config_snapshots", "selftest_" + Date.now())
  })
});
assert.ok(existsSync(saved.path));
const parsed = __test.parseYaml(readFileSync(saved.path, "utf8"));
assert.equal(parsed.link.bitrate_gbps, 106.0);
assert.equal(parsed.phase2.n_ui, 4608);
assert.equal(parsed.paths.results_root, testResults.replace(/\\/g, "/"));
ok("snapshot round-trip", saved.path);

// Real smoke artifacts are read directly (no copy, no write) to prove the
// summary/eye readers understand the actual ADS output shape.
const realSmoke = "C:\\Users\\z3312\\Documents\\sipho_link\\results\\eoe_workbench\\smoke_20261112";
if (existsSync(join(realSmoke, "summary.json"))) {
  const real = __test.compactSummary(realSmoke);
  assert.ok(real);
  assert.equal(real.bitrateGbps, 106.25);
  assert.equal(real.phases[3].winner, "tx_eye");
  assert.ok(real.eyeCsvs.length >= 3);
  const realEye = __test.eyePayload(real.eyeCsvs[0].path, real.baudHz);
  assert.ok(realEye.samples > 1000);
  ok("real smoke artifacts", `${real.name}; winner=${real.phases[3].winner}; eye=${realEye.samples} pts`);
}

if (spawnShort) {
  console.log("starting real --short run (this can take ~20-40s)…");
  const started = await api("/run", {
    method: "POST",
    body: JSON.stringify({
      config: {
        ...config.config,
        paths: {
          ...config.config.paths,
          results_root: join(testResults, "plugin_selftest")
        }
      },
      flags: { fromPhase: 1, short: true, noTdecq: true }
    })
  });
  assert.equal(started.ok, true);
  assert.ok(started.job.pid > 0);
  console.log("spawned pid=" + started.job.pid + " runDir=" + started.job.runDir);
  const deadline = Date.now() + 6 * 60 * 1000;
  let lastTail = "";
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const job = await api("/job");
    if (job.logTail && job.logTail !== lastTail) {
      lastTail = job.logTail;
      console.log("log lines=" + String(job.logTail.split("\n").length) + " progress=" + JSON.stringify(job.progress));
    }
    if (!job.running) {
      console.log("finished status=" + job.job.status + " exit=" + job.job.exitCode);
      console.log("log tail:\n" + String(job.logTail).slice(-3000));
      if (job.summary) {
        console.log("summary ok=" + job.summary.ok + " short=" + job.summary.short);
      }
      assert.ok(job.job.status === "succeeded" || job.job.status === "failed");
      break;
    }
  }
  ok("--short spawn", "pid " + started.job.pid);
}

console.log("\nSELFTEST PASS: " + results.length + " checks");
server.close();
try {
  rmSync(process.env.EOE_STATE_DIR, { recursive: true, force: true });
} catch {}
