// Live integration test: real browser half + real host API + real smoke
// artifacts. Headless Chromium is unavailable inside the DSH sandbox (mojo
// named pipes), so jsdom + a canvas stub is used as the DOM renderer.
//
// Requires the workspace-local test DSH web instance on port 3092:
//   $env:DSH_HOME=...\.dsh-test
//   dsh --profile eoe --port 3092 --no-open
//
//   node tools/ui-live-dom-test.cjs [port]
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

const port = process.argv[2] || "3092";
const origin = "http://127.0.0.1:" + port;
const pluginDir = path.resolve(__dirname, "..");
const nativeFetch = global.fetch;

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="eoe-live-root"></div></body></html>',
  { url: origin + "/", pretendToBeVisual: true }
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

// jsdom has no canvas. The chart effect only needs 2D drawing calls to run;
// every visual call is a no-op, while createImageData returns real storage.
const canvasContext = {
  canvas: null,
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  },
  putImageData() {},
  drawImage() {},
  save() {},
  restore() {},
  beginPath() {},
  rect() {},
  clip() {},
  fillRect() {},
  clearRect() {},
  strokeRect() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  setLineDash() {},
  fillText() {},
  translate() {},
  rotate() {},
  setTransform() {},
  measureText() {
    return { width: 10 };
  }
};
dom.window.HTMLCanvasElement.prototype.getContext = () => canvasContext;

const requests = [];
dom.window.fetch = global.fetch = async (input, options = {}) => {
  const url = new URL(String(input), origin).toString();
  requests.push((options.method || "GET") + " " + url.replace(origin, ""));
  return nativeFetch(url, options);
};

let registeredMain = null;
dom.window.__ModuleLoader__ = {
  load({ id, factory }) {
    const exports = factory((name) => {
      if (name === "react") return React;
      throw new Error("unexpected external: " + name);
    });
    if (!exports || typeof exports.apply !== "function") throw new Error("no apply " + id);
    exports.apply({
      slots: {
        inject(slot, cb) {
          cb();
        },
        register(options, component) {
          if (options.name === "main") registeredMain = component;
          return { options };
        }
      }
    });
  }
};

// The DSH host validates same-origin mutations by headers; this page only does
// GETs, but the client sends x-eoe-workbench anyway.
const clientCode = fs.readFileSync(path.join(pluginDir, "client.js"), "utf8");
const sandbox = {
  window: dom.window,
  document: dom.window.document,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: global.requestAnimationFrame,
  cancelAnimationFrame: global.cancelAnimationFrame,
  fetch: global.fetch,
  URL,
  URLSearchParams,
  Response,
  navigator: dom.window.navigator
};
vm.createContext(sandbox);
vm.runInContext(clientCode, sandbox, { filename: "client.js" });
if (!registeredMain) throw new Error("main slot was not registered");

const errors = [];
const originalError = console.error;
const originalWarn = console.warn;
console.error = (...args) => {
  const text = args.map(String).join(" ");
  if (!/ReactDOMTestUtils\.act|deprecated/.test(text)) {
    errors.push("console.error: " + text);
    originalError(...args);
  }
};
console.warn = (...args) => {
  const text = args.map(String).join(" ");
  if (!/ReactDOMTestUtils\.act|deprecated/.test(text)) {
    errors.push("console.warn: " + text);
    originalWarn(...args);
  }
};

const container = document.getElementById("eoe-live-root");
let root;
(async () => {
  try {
    await act(async () => {
      root = ReactDOMClient.createRoot(container);
      root.render(React.createElement(registeredMain));
    });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
    }

    const text = () => container.textContent || "";
    const setupText = text();
    if (!setupText.includes("EOE") || !setupText.includes("hpeesofsim")) {
      throw new Error("setup view did not load live host data:\n" + setupText.slice(0, 2000));
    }
    if (!setupText.includes("PREFLIGHT")) {
      throw new Error("preflight did not render");
    }

    const analyzeTab = Array.from(container.querySelectorAll(".eoe-tab")).find((button) =>
      (button.textContent || "").includes("结果 / 眼图")
    );
    if (!analyzeTab) throw new Error("analysis tab not found");
    await act(async () => {
      analyzeTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
    }
    const analyzeText = text();
    if (!analyzeText.includes("smoke_20261112")) {
      throw new Error("real smoke run was not selected:\n" + analyzeText.slice(0, 3000));
    }
    if (!analyzeText.includes("tx_eye")) {
      throw new Error("phase3 winner tx_eye not rendered:\n" + analyzeText.slice(0, 5000));
    }
    if (!analyzeText.includes("14.4")) {
      throw new Error("TDECQ value not rendered");
    }
    if (!analyzeText.includes("DENSITY EYE")) {
      throw new Error("eye card not rendered");
    }
    if (!/17,?920/.test(analyzeText)) {
      throw new Error("real eye sample count not rendered:\n" + analyzeText.slice(0, 4000));
    }
    if (!analyzeText.includes("产物与证据")) {
      throw new Error("artifacts section missing");
    }
    if (errors.length) {
      throw new Error("browser console problems:\n" + errors.join("\n"));
    }

    const eyeRequests = requests.filter((request) => request.includes("/eye?"));
    if (eyeRequests.length === 0) throw new Error("no /eye request was issued");
    console.log("ok - live setup view loaded config/preflight from host");
    console.log("ok - live smoke_20261112 selected with tx_eye winner and TDECQ");
    console.log("ok - live eye CSV folded: " + eyeRequests.length + " eye request(s)");
    console.log("ok - artifacts and console rendered; requests=" + requests.length);
    console.log("LIVE UI INTEGRATION PASS");
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
