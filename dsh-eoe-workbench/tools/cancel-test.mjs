// Lifecycle test for spawn -> live log -> cancel, using a fake local CLI so it
// never touches ADS, licenses or the real workbench sim directories.
//
//   node tools/cancel-test.mjs
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

const pluginDir = process.cwd();
const base = join(pluginDir, ".lifecycle-" + Date.now());
const fakeWb = join(base, "workbench");
const results = join(base, "results");
mkdirSync(join(fakeWb, "bin"), { recursive: true });
mkdirSync(join(fakeWb, "templates"), { recursive: true });
mkdirSync(results, { recursive: true });

const realConfig = readFileSync(
  "C:\\Users\\z3312\\Documents\\sipho_link\\workbench\\config.yaml",
  "utf8"
);
const realTemplate =
  "C:\\Users\\z3312\\Documents\\sipho_link\\workbench\\templates\\sipho_envelope_phase2.net";
const configText = realConfig
  .replace(/(^workroot:\s*).*$/m, "$1" + fakeWb.replace(/\\/g, "/"))
  .replace(/(^paths:\s*\r?\n\s*results_root:\s*).*$/m, "$1" + results.replace(/\\/g, "/"))
  .replace(/(^\s*envelope_template:\s*).*$/m, "$1'" + realTemplate.replace(/\\/g, "/") + "'");
const configPath = join(fakeWb, "config.yaml");
writeFileSync(configPath, configText, "utf8");
writeFileSync(
  join(fakeWb, "bin", "run_eoe.cmd"),
  [
    "@echo off",
    "echo fake-eoe-cli-start",
    "echo fake-phase1",
    "ping 127.0.0.1 -n 30 >nul",
    "echo fake-eoe-cli-end",
    "exit /b 0"
  ].join("\r\n"),
  "utf8"
);

process.env.EOE_WORKBENCH_ROOT = fakeWb;
process.env.EOE_CONFIG_PATH = configPath;
process.env.EOE_STATE_DIR = mkdtempSync(join(tmpdir(), "eoe-cancel-state-"));
const mod = await import("../index.js");
const { apply } = mod;

const routes = [];
const fakeCtx = {
  logger: { info() {}, warn: console.warn },
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
const apiBase = `http://127.0.0.1:${port}/api/eoe`;

async function api(path, options = {}, expected = 200) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: {
      "x-eoe-workbench": "1",
      ...(options.body ? { "content-type": "application/json" } : {})
    }
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  assert.equal(response.status, expected, `${path}: ${response.status} ${text.slice(0, 300)}`);
  return payload;
}

const info = await api("/config");
const config = info.config;
config.paths.results_root = results;
config.workroot = fakeWb;
config.phase2.envelope_template = realTemplate;
const started = await api("/run", {
  method: "POST",
  body: JSON.stringify({
    config,
    flags: { fromPhase: 1, short: true, noTdecq: true }
  })
});
assert.equal(started.ok, true);
assert.ok(started.job.pid > 0);
console.log("ok - spawned fake CLI pid=" + started.job.pid);

let sawLog = false;
for (let i = 0; i < 20; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const job = await api("/job");
  if (String(job.logTail || job.consoleTail || "").includes("fake-phase1")) {
    sawLog = true;
    break;
  }
}
assert.equal(sawLog, true, "live console log was not readable");
console.log("ok - live console log captured while running");

const cancelled = await api("/cancel", { method: "POST" });
assert.equal(cancelled.ok, true);
assert.equal(cancelled.status, "cancelling");
console.log("ok - cancel accepted for pid=" + cancelled.pid);

let final = null;
for (let i = 0; i < 60; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const job = await api("/job");
  if (i % 4 === 0) {
    console.log(
      "wait[" + i + "] running=" + job.running + " status=" + job.job?.status + " pidAlive=" + job.job?.pidAlive
    );
  }
  if (!job.running) {
    final = job;
    break;
  }
}
assert.ok(final, "job did not settle after cancel");
assert.equal(final.job.status, "cancelled");
assert.equal(final.job.exitCode !== undefined, true);
console.log("ok - job settled as cancelled; exit=" + final.job.exitCode);
console.log("CANCEL LIFECYCLE PASS");
server.close();
try {
  rmSync(process.env.EOE_STATE_DIR, { recursive: true, force: true });
} catch {}
