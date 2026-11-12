// DOM smoke test for the browser half. Runs the real client module in jsdom
// with a mocked /api/eoe transport; catches render/hook/runtime errors without
// needing a browser (the DSH shell blocks headless Chromium's IPC pipes).
//
//   node tools/ui-dom-test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const uiDeps =
  process.env.EOE_UITEST_DEPS ||
  path.resolve(__dirname, "..", "..", ".eoe-uitest", "node_modules");
const { JSDOM } = require(path.join(uiDeps, "jsdom"));
const React = require(path.join(uiDeps, "react"));
const ReactDOMClient = require(path.join(uiDeps, "react-dom", "client"));
const { act } = require(path.join(uiDeps, "react-dom", "test-utils"));

const pluginDir = path.resolve(__dirname, "..");
const configYaml = fs.readFileSync(
  "C:\\Users\\z3312\\Documents\\sipho_link\\workbench\\config.yaml",
  "utf8"
);

// A compact parser mirroring the host for the fixture only. The values under
// test are the real defaults from config.yaml.
function parseConfig(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^ */)[0].length;
    const content = raw.replace(/\s+#.*$/, "").trim();
    const match = content.match(/^([^:]+):(?:\s+(.*))?$/);
    if (!match) continue;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    const key = match[1].trim();
    if (match[2] === undefined) {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      let value = match[2].trim();
      if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
      else if (/^-?\d+$/.test(value)) value = Number(value);
      else if (/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/.test(value)) value = Number(value);
      else if (value === "true") value = true;
      else if (value === "false") value = false;
      parent[key] = value;
    }
  }
  return root;
}

const config = parseConfig(configYaml);
config.paths = config.paths || {};
config.paths.results_root = "C:\\fake\\results\\eoe_workbench";
const fakeRun = "C:\\fake\\results\\eoe_workbench\\smoke_fixture";
const now = new Date().toISOString();
const summary = {
  ok: true,
  runDir: fakeRun,
  name: "smoke_fixture",
  stamp: "20261112_000000",
  when: "2026-11-12 00:00:00 Asia/Shanghai (UTC+8)",
  short: false,
  fromPhase: 1,
  bitrateGbps: 106.25,
  baudHz: 53125000000,
  format: "PAM4",
  failedAt: null,
  note: null,
  durationMs: 65000,
  phases: {
    1: { present: true, ok: true, skipped: false, nBits: 5120, nUi: 5375.9, eyePoints: 53760 },
    2: { present: true, ok: true, skipped: false, nUi: 4608, tdecqDb: 14.455 },
    3: {
      present: true,
      ok: true,
      skipped: false,
      winner: "tx_eye",
      eyePoints: 17920,
      attempts: [
        { tag: "tia_soft", ok: false, error: "wvfm is too short" },
        { tag: "sharp_tia", ok: false, error: "wvfm is too short" },
        { tag: "tx_eye", ok: true, error: null }
      ]
    }
  },
  tdecq: {
    ok: true,
    dB: 14.455,
    claim: "COMPUTED — NOT FlexDCA / NOT compliance",
    omaMethod: "FALLBACK_levels_L3_minus_L0",
    erDb: 4.291,
    q: 3.414
  },
  eyeCsvs: [],
  images: [],
  error: null
};

const artifacts = [
  {
    name: "summary.json",
    rel: "summary.json",
    path: fakeRun + "\\summary.json",
    size: 1234,
    mtime: now,
    ext: ".json",
    kind: "json",
    phase: "00"
  },
  {
    name: "phase1_logFile.txt",
    rel: "phase1_logFile.txt",
    path: fakeRun + "\\phase1_logFile.txt",
    size: 4321,
    mtime: now,
    ext: ".txt",
    kind: "log",
    phase: "01"
  },
  {
    name: "RxAMI_Eye_Rx_tx_eye.csv",
    rel: "RxAMI_Eye_Rx_tx_eye.csv",
    path: fakeRun + "\\RxAMI_Eye_Rx_tx_eye.csv",
    size: 2048,
    mtime: now,
    ext: ".csv",
    kind: "eye-csv",
    phase: "03"
  }
];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="eoe-test-root"></div></body></html>',
  { url: "http://127.0.0.1:3091/", pretendToBeVisual: true }
);
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.IS_REACT_ACT_ENVIRONMENT = true;

const requests = [];
dom.window.fetch = global.fetch = async (input, options = {}) => {
  const raw = String(input);
  const url = new URL(raw, "http://127.0.0.1:3091");
  requests.push({ path: url.pathname + url.search, method: options.method || "GET" });
  const p = url.pathname;
  if (p.endsWith("/config")) {
    return jsonResponse({
      ok: true,
      path: "C:\\Users\\z3312\\Documents\\sipho_link\\workbench\\config.yaml",
      mtime: now,
      size: configYaml.length,
      config,
      raw: configYaml
    });
  }
  if (p.endsWith("/status")) {
    return jsonResponse({
      ok: true,
      running: false,
      job: null,
      progress: { phase: 0, label: "空闲", percent: 0 },
      lastError: null
    });
  }
  if (p.endsWith("/preflight")) {
    return jsonResponse({
      ok: true,
      validation: { ok: true, issues: [], errors: [], warnings: [] },
      checks: {
        ok: true,
        errors: 0,
        warnings: 0,
        items: [
          { label: "工作台根目录", ok: true, level: "ok", detail: "C:\\work\\sipho_link\\workbench" },
          { label: "hpeesofsim", ok: true, level: "ok", detail: "C:\\Program Files\\Keysight\\ADS2027\\bin\\hpeesofsim.exe" },
          { label: "通道 s4p (Tx)", ok: true, level: "ok", detail: "passthrough.s4p" }
        ]
      },
      flags: { fromPhase: 1, short: false, noTdecq: false, runDir: "" },
      command: {
        preview:
          'bin\\run_eoe.cmd --config C:\\fake\\run\\config.yaml --run-dir C:\\fake\\run --from-phase 1'
      }
    });
  }
  if (p.endsWith("/runs")) {
    return jsonResponse({
      ok: true,
      runs: [
        {
          name: "smoke_fixture",
          path: fakeRun,
          mtime: now,
          ok: true,
          short: false,
          fromPhase: 1,
          failedAt: null,
          bitrateGbps: 106.25,
          phase3Winner: "tx_eye",
          tdecqDb: 14.455
        }
      ]
    });
  }
  if (p.endsWith("/summary")) {
    return jsonResponse({ ok: true, summary });
  }
  if (p.endsWith("/artifacts")) {
    return jsonResponse({ ok: true, runDir: fakeRun, artifacts });
  }
  if (p.endsWith("/run-log")) {
    return jsonResponse({
      ok: true,
      runDir: fakeRun,
      logPath: fakeRun + "\\run_log.txt",
      tail: "EOE workbench start ...\\nPHASE1 DONE ok=True\\nPHASE2 DONE ok=True\\nPHASE3 DONE ok=True winner=tx_eye\\nSUMMARY {'ok': True}"
    });
  }
  if (p.endsWith("/file")) {
    return new Response("file-bytes", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return jsonResponse({ ok: false, error: "unmocked " + p }, 404);
};

// Load the real client module through the same loader contract DSH uses.
let registeredMain = null;
let registeredPanel = null;
dom.window.__ModuleLoader__ = {
  load({ id, factory }) {
    const module = { exports: {} };
    const exports = factory((name) => {
      if (name === "react") return React;
      throw new Error("unexpected external: " + name);
    });
    if (!exports || typeof exports.apply !== "function") {
      throw new Error("client factory did not return apply for " + id);
    }
    const ctx = {
      slots: {
        inject(slot, cb) {
          cb();
        },
        register(options, component) {
          if (options.name === "main") registeredMain = component;
          if (options.name === "sidebar.panellist") registeredPanel = component;
          return { options };
        }
      }
    };
    exports.apply(ctx);
  }
};

const clientCode = fs.readFileSync(path.join(pluginDir, "client.js"), "utf8");
const sandbox = {
  window: dom.window,
  document: dom.window.document,
  console,
  setTimeout,
   clearTimeout,
  setInterval,
  clearInterval,
  fetch: global.fetch,
  URL,
  URLSearchParams,
  Response,
  navigator: dom.window.navigator
};
vm.createContext(sandbox);
vm.runInContext(clientCode, sandbox, { filename: "client.js" });
if (!registeredMain) throw new Error("main slot was not registered");
if (!registeredPanel) throw new Error("sidebar panel was not registered");

const errors = [];
const originalError = console.error;
const originalWarn = console.warn;
console.error = (...args) => {
  const text = args.map(String).join(" ");
  if (!/ReactDOMTestUtils\.act|deprecated/.test(text)) {
    errors.push("console.error: " + text);
  }
  originalError(...args);
};
console.warn = (...args) => {
  const text = args.map(String).join(" ");
  if (!/ReactDOMTestUtils\.act|deprecated/.test(text)) errors.push("console.warn: " + text);
  originalWarn(...args);
};

const container = document.getElementById("eoe-test-root");
let root;
(async () => {
  try {
    await act(async () => {
      root = ReactDOMClient.createRoot(container);
      root.render(React.createElement(registeredMain));
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 220));
      });
    }

    const text = () => container.textContent || "";
    const bodyText = text();
    if (!bodyText.includes("一键运行 PHASE1")) {
      console.log("BODY TEXT:\n" + bodyText);
    }
    assertIncludes(bodyText, "EOE", "brand");
    assertIncludes(bodyText, "一键运行 PHASE1 → PHASE2 → PHASE3", "primary boot action");
    assertIncludes(bodyText, "PREFLIGHT PASS", "preflight verdict");
    assertIncludes(bodyText, "my_Ethernet_Tx", "AMI component");
    assertIncludes(bodyText, "CONFIG", "config provenance");
    assertIncludes(bodyText, "RECENT RUNS", "recent runs");
    assertIncludes(bodyText, "smoke_fixture", "recent run name");

    // Switch to the analysis view and verify the compact summary is rendered.
    const analyzeTab = Array.from(container.querySelectorAll(".eoe-tab")).find((button) =>
      (button.textContent || "").includes("结果 / 眼图")
    );
    if (!analyzeTab) throw new Error("analysis tab not found");
    await act(async () => {
      analyzeTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const analyzeText = text();
    assertIncludes(analyzeText, "LINK RESULT", "analysis title");
    assertIncludes(analyzeText, "COMPUTED · NOT FlexDCA", "TDECQ disclaimer");
    assertIncludes(analyzeText, "PHASE VERDICTS", "phase verdicts");
    assertIncludes(analyzeText, "tx_eye", "fallback winner");
    assertIncludes(analyzeText, "14.4", "TDECQ value");
    assertIncludes(analyzeText, "产物与证据", "artifacts section");

    // Switch to the console view; the archived log should be visible.
    const runTab = Array.from(container.querySelectorAll(".eoe-tab")).find((button) =>
      (button.textContent || "").includes("运行")
    );
    await act(async () => {
      runTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    if (!text().includes("PHASE3 DONE ok=True")) {
      console.log("RUN VIEW BODY:\n" + text().slice(0, 4000));
    }
    assertIncludes(text(), "PHASE3 DONE ok=True", "archived log line");

    const buttonCount = container.querySelectorAll("button").length;
    const inputCount = container.querySelectorAll("input,select").length;
    console.log("ok - client module loaded and applied");
    console.log("ok - main page rendered, buttons=" + buttonCount + " inputs=" + inputCount);
    console.log("ok - setup view: brand, run action, preflight, AMI, recent runs");
    console.log("ok - analyze view: summary, TDECQ disclaimer, phase verdicts, artifacts");
    console.log("ok - run view: archived run_log tail");
    console.log("api requests: " + requests.length + " (config/status/preflight/runs/summary/artifacts/run-log)");
    if (errors.length) {
      throw new Error("browser console problems:\n" + errors.join("\n"));
    }
    console.log("UI DOM SELFTEST PASS");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await act(async () => {
      root?.unmount();
    });
    console.error = originalError;
    console.warn = originalWarn;
    dom.window.close();
  }
})();

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error("missing " + label + ": " + JSON.stringify(needle));
  }
}
