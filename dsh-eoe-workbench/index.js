// EOE Workbench — host half.
//
// The plugin is intentionally a thin control surface over the already-proven
// headless CLI at C:\Users\z3312\Documents\sipho_link\workbench. It does not
// reimplement PHASE1/2/3 and it never edits the PAM4 schematic.
//
//   GET  /api/eoe/status            plugin + active job + progress
//   GET  /api/eoe/config            config.yaml defaults (parsed) + raw text
//   POST /api/eoe/preflight         path/env checks + argv preview
//   POST /api/eoe/config/save       explicit default overwrite or snapshot
//   POST /api/eoe/run               write run config, spawn bin\run_eoe.cmd
//   GET  /api/eoe/job               live job, log tails, compact summary
//   POST /api/eoe/cancel            taskkill /T the process tree we started
//   GET  /api/eoe/runs              recent result directories
//   GET  /api/eoe/run-log           bounded tail of an existing run_log.txt
//   GET  /api/eoe/summary           compact summary + phase metrics
//   GET  /api/eoe/artifacts         recursive artifact list for a run
//   GET  /api/eoe/file              bounded text/image artifact preview
//   GET  /api/eoe/eye               fold an eye CSV into a density grid
//
// Mutations are loopback-only and require the x-eoe-workbench: 1 header.
// Commands are always spawned as an argv array; no user string is handed to a
// shell. The only shell use is cmd.exe /d /c bin\run_eoe.cmd <argv...> because
// Node cannot execute a .cmd file directly.
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "eoe-workbench";
export const inject = [];

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const API_PREFIX = "/api/eoe";
const MUTATION_HEADER = "x-eoe-workbench";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_LOG_TAIL = 1200;
const HEADER_LINES = 5000;

const WORKBENCH_ROOT = normaliseRoot(
  process.env.EOE_WORKBENCH_ROOT || "C:\\Users\\z3312\\Documents\\sipho_link\\workbench"
);
const STATE_DIR =
  process.env.EOE_STATE_DIR || join(homedir(), ".dsh", "eoe-workbench");

const PLUGIN_VERSION = "1.0.0";

const BUILTIN_DEFAULTS = {
  workroot: "C:\\Users\\z3312\\Documents\\sipho_link",
  hpeesof_dir: "C:\\Program Files\\Keysight\\ADS2027",
  python: "C:\\Program Files\\Keysight\\ADS2027\\tools\\python\\python.exe",
  wrk: "C:\\Users\\z3312\\Documents\\sipho_link\\SiPho_PAM4_106G_EOE_wrk",
  official_eoe_wrk:
    "C:\\Users\\z3312\\Documents\\sipho_link\\ref_examples\\End_to_End_EOE_for_Ethernet_wrk\\End_to_End_EOE_for_Ethernet_wrk",
  link: {
    format: "PAM4",
    bitrate_gbps: 106.25,
    baud_hz: 53125000000,
    wavelength_nm: 1310
  },
  ami: {
    tx_dir: "C:\\Users\\z3312\\Documents\\sipho_link\\SiPho_PAM4_106G_EOE_wrk\\data\\my_Ethernet_Tx",
    rx_dir: "C:\\Users\\z3312\\Documents\\sipho_link\\SiPho_PAM4_106G_EOE_wrk\\data\\my_Ethernet_Rx",
    tx_ibs: "my_Ethernet_Tx.ibs",
    rx_ibs: "my_Ethernet_Rx.ibs",
    tx_component: "my_Ethernet_Tx",
    rx_component: "my_Ethernet_Rx",
    passthrough_s4p: "passthrough.s4p"
  },
  phase1: {
    n_bits: 5120,
    block_size: 256,
    pts_per_ui: 10,
    tx_mode: 1,
    tx_ignore_bits: 10,
    rx_ignore_bits: 64
  },
  phase2: {
    n_ui: 4608,
    os_factor: 8,
    envelope_template: "templates/sipho_envelope_phase2.net",
    pwl_target_points: 5000
  },
  phase3: {
    n_bits: 4608,
    n_ui_min: 4480,
    discard_ui: 64,
    pts_per_ui: 10,
    measured: "auto",
    fallback: true,
    use_second_measured: false
  },
  tdecq: {
    enable: true
  },
  paths: {
    results_root: "C:\\Users\\z3312\\Documents\\sipho_link\\results\\eoe_workbench"
  }
};

const jobState = {
  job: null,
  child: null,
  stopping: false,
  lastError: null
};

function normaliseRoot(value) {
  return resolve(String(value).replace(/[\\/]+$/, ""));
}

function configPath() {
  return process.env.EOE_CONFIG_PATH || join(WORKBENCH_ROOT, "config.yaml");
}

function resultsRoot(config) {
  const value = config?.paths?.results_root;
  return normaliseRoot(value || BUILTIN_DEFAULTS.paths.results_root);
}

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    String(d.getFullYear()) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "_" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlainObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

function numberOr(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1" || value === "yes") return true;
  if (value === "false" || value === 0 || value === "0" || value === "no") return false;
  return fallback;
}

// ---------------------------------------------------------------------------
// YAML: the workbench config is a deliberately simple mapping. Keeping the
// parser here (rather than adding a private dependency to a local plugin) means
// the plugin loads offline and can still round-trip the real config.yaml.
// ---------------------------------------------------------------------------

function stripYamlComment(line) {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && double) {
      i += 1;
      continue;
    }
    if (ch === "'" && !double) single = !single;
    else if (ch === '"' && !single) double = !double;
    else if (ch === "#" && !single && !double && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteYamlString(raw) {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

function parseYamlScalar(raw) {
  const text = raw.trim();
  if (text === "") return "";
  if (text.startsWith("'") && text.endsWith("'")) return unquoteYamlString(text);
  if (text.startsWith('"') && text.endsWith('"')) return unquoteYamlString(text);
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^(null|Null|NULL|~)$/.test(text)) return null;
  if (/^[-+]?\d+$/.test(text)) {
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : text;
  }
  if (/^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (rawLine.includes("\t") && /^\t/.test(rawLine)) {
      throw new Error("YAML tab indentation is not supported at line " + String(index + 1));
    }
    const withoutComment = stripYamlComment(rawLine);
    if (withoutComment.trim() === "") continue;
    const indentMatch = withoutComment.match(/^ */);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const content = withoutComment.slice(indent).trimEnd();
    if (content === "---" || content === "...") continue;
    const match = content.match(/^([^:]+):(?:\s+(.*))?$/);
    if (!match) throw new Error("Unsupported YAML at line " + String(index + 1) + ": " + content);
    const key = unquoteYamlString(match[1].trim());
    if (key === "") throw new Error("Empty YAML key at line " + String(index + 1));
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    const rawValue = match[2];
    if (rawValue === undefined || rawValue.trim() === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseYamlScalar(rawValue);
    }
  }
  return root;
}

function yamlNeedsQuote(text) {
  if (text === "") return true;
  if (/^[\s]|[\s]$/.test(text)) return true;
  if (/[:#\[\]{},&*!|>'"%@`]/.test(text)) return true;
  if (/^(true|false|null|~)$/i.test(text)) return true;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) return true;
  return false;
}

function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (Array.isArray(value)) return "[" + value.map(yamlScalar).join(", ") + "]";
  const text = String(value);
  if (!yamlNeedsQuote(text)) return text;
  return "'" + text.replace(/'/g, "''") + "'";
}

export function serializeConfig(config) {
  const knownOrder = [
    "workroot",
    "hpeesof_dir",
    "python",
    "wrk",
    "official_eoe_wrk",
    "link",
    "ami",
    "phase1",
    "phase2",
    "phase3",
    "tdecq",
    "paths"
  ];
  const keys = [
    ...knownOrder.filter((key) => Object.prototype.hasOwnProperty.call(config, key)),
    ...Object.keys(config).filter((key) => !knownOrder.includes(key))
  ];
  const lines = [
    "# SiPho EOE Workbench — generated by DSH EOE Workbench",
    "# " + new Date().toISOString(),
    "# Full link: 106.25 Gb/s PAM4 / 53.125 GBd (default). Do not swap in PCIe NRZ AMI.",
    ""
  ];
  const emit = (obj, depth) => {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const pad = "  ".repeat(depth);
      if (isPlainObject(value)) {
        lines.push(pad + key + ":");
        emit(value, depth + 1);
      } else {
        lines.push(pad + key + ": " + yamlScalar(value));
      }
    }
  };
  for (const key of keys) {
    const value = config[key];
    if (isPlainObject(value)) {
      lines.push(key + ":");
      emit(value, 1);
      lines.push("");
    } else {
      lines.push(key + ": " + yamlScalar(value));
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Config loading / validation
// ---------------------------------------------------------------------------

function loadConfigFile() {
  const path = configPath();
  if (!existsSync(path)) throw httpError(500, "config.yaml 不存在: " + path);
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw);
  if (!isPlainObject(parsed)) throw httpError(500, "config.yaml 不是 mapping");
  const config = deepMerge(BUILTIN_DEFAULTS, parsed);
  return {
    path,
    raw,
    config,
    mtime: statSync(path).mtime.toISOString(),
    size: raw.length
  };
}

function asConfig(body, defaults) {
  const incoming = body && isPlainObject(body.config) ? body.config : body;
  if (!isPlainObject(incoming)) return deepMerge(defaults, {});
  return deepMerge(defaults, incoming);
}

function validateConfig(config, flags = {}) {
  const issues = [];
  const add = (level, field, message) => issues.push({ level, field, message });
  const link = config.link || {};
  const ami = config.ami || {};
  const p1 = config.phase1 || {};
  const p2 = config.phase2 || {};
  const p3 = config.phase3 || {};

  if (String(link.format || "") !== "PAM4") {
    add("error", "link.format", "只能是 PAM4（硬约束：my_Ethernet PAM4 AMI，禁止 BCM/PCIe NRZ）");
  }
  const bitrate = numberOr(link.bitrate_gbps, NaN);
  const baud = numberOr(link.baud_hz, NaN);
  if (!(bitrate > 0)) add("error", "link.bitrate_gbps", "码率必须大于 0");
  if (!(baud > 0)) add("error", "link.baud_hz", "波特率必须大于 0");
  if (bitrate > 0 && baud > 0) {
    const ratio = bitrate / (baud / 1e9);
    if (Math.abs(ratio - 2) > 0.02) {
      add("warn", "link.baud_hz", "PAM4 期望 baud = bitrate / 2；当前比值 " + ratio.toFixed(3));
    }
  }
  const wavelength = numberOr(link.wavelength_nm, NaN);
  if (!(wavelength > 0)) add("warn", "link.wavelength_nm", "波长建议为正值（默认 1310 nm）");

  if (!String(ami.tx_dir || "").trim()) add("error", "ami.tx_dir", "Tx AMI 目录不能为空");
  if (!String(ami.rx_dir || "").trim()) add("error", "ami.rx_dir", "Rx AMI 目录不能为空");
  if (!String(ami.tx_ibs || "").trim()) add("error", "ami.tx_ibs", "Tx IBIS 文件名不能为空");
  if (!String(ami.rx_ibs || "").trim()) add("error", "ami.rx_ibs", "Rx IBIS 文件名不能为空");
  if (!String(ami.passthrough_s4p || "").trim()) add("error", "ami.passthrough_s4p", "通道 s4p 文件名不能为空");

  const intField = (field, label, value, min, max) => {
    const n = numberOr(value, NaN);
    if (!Number.isInteger(n) || n < min || n > max) {
      add("error", field, label + " 必须是 " + String(min) + "–" + String(max) + " 的整数");
    }
  };
  intField("phase1.n_bits", "PHASE1 n_bits", p1.n_bits, 64, 200000);
  intField("phase1.block_size", "PHASE1 block_size", p1.block_size, 8, 8192);
  intField("phase1.pts_per_ui", "PHASE1 pts_per_ui", p1.pts_per_ui, 2, 64);
  intField("phase1.tx_ignore_bits", "PHASE1 tx_ignore_bits", p1.tx_ignore_bits, 0, 4096);
  intField("phase1.rx_ignore_bits", "PHASE1 rx_ignore_bits", p1.rx_ignore_bits, 0, 4096);
  if (Number(p1.tx_mode) !== 1) {
    add("error", "phase1.tx_mode", "PHASE1 必须用 Tx AMI Mode=1 GetWave");
  }
  intField("phase2.n_ui", "PHASE2 n_ui", p2.n_ui, 64, 200000);
  intField("phase2.os_factor", "PHASE2 os_factor", p2.os_factor, 1, 64);
  intField("phase3.n_bits", "PHASE3 n_bits", p3.n_bits, 64, 200000);
  intField("phase3.n_ui_min", "PHASE3 n_ui_min", p3.n_ui_min, 64, 200000);
  intField("phase3.discard_ui", "PHASE3 discard_ui", p3.discard_ui, 0, 4096);
  intField("phase3.pts_per_ui", "PHASE3 pts_per_ui", p3.pts_per_ui, 2, 64);
  if (!["auto", "tia_soft", "tx_eye"].includes(String(p3.measured || ""))) {
    add("error", "phase3.measured", "PHASE3 measured 只能是 auto / tia_soft / tx_eye");
  }
  if (Number(p2.n_ui) < 4352 && !flags.short && Number(flags.fromPhase) <= 2) {
    add("warn", "phase2.n_ui", "完整链路 n_ui < 4352 时 PHASE3 Mode=5 历史上会报 wvfm is too short");
  }
  if (Number(p3.n_bits) < Number(p3.n_ui_min)) {
    add("warn", "phase3.n_bits", "PHASE3 n_bits 小于 n_ui_min，长度可能不足");
  }
  if (flags.short && Number(flags.fromPhase) === 3) {
    add("error", "run.short", "--short 会跳过 PHASE3；不能与 --from-phase 3 同时使用");
  }
  if (!String(config.paths?.results_root || "").trim()) {
    add("error", "paths.results_root", "结果根目录不能为空");
  }
  for (const field of ["workroot", "hpeesof_dir", "python", "wrk", "official_eoe_wrk"]) {
    if (!String(config[field] || "").trim()) add("error", field, "路径不能为空");
  }

  const errors = issues.filter((item) => item.level === "error");
  const warnings = issues.filter((item) => item.level === "warn");
  return { ok: errors.length === 0, issues, errors, warnings };
}

function normaliseFlags(body) {
  const source = body && isPlainObject(body.flags) ? body.flags : body || {};
  const fromPhase = numberOr(source.fromPhase ?? source.from_phase ?? 1, 1);
  return {
    fromPhase: Number.isInteger(fromPhase) && fromPhase >= 1 && fromPhase <= 3 ? fromPhase : 1,
    short: boolOr(source.short, false),
    noTdecq: boolOr(source.noTdecq ?? source.no_tdecq, false),
    runDir: typeof source.runDir === "string" ? source.runDir.trim() : typeof source.run_dir === "string" ? source.run_dir.trim() : ""
  };
}

function isPathInside(child, root) {
  if (!child || !root) return false;
  const rel = relative(resolve(root), resolve(child));
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../");
}

function assertRunDirAllowed(candidate, config) {
  const dir = normaliseRoot(candidate);
  const root = resultsRoot(config);
  const wb = normaliseRoot(config.workroot || WORKBENCH_ROOT);
  if (!isPathInside(dir, root) && !isPathInside(dir, wb)) {
    throw httpError(400, "run-dir 必须位于 results_root 或 workroot 下: " + dir);
  }
  if (resolve(dir) === root || resolve(dir) === wb) {
    throw httpError(400, "run-dir 不能是结果根目录或 workroot 本身");
  }
  return dir;
}

function makeRunDir(config, requested) {
  if (requested) {
    const dir = assertRunDirAllowed(requested, config);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const root = resultsRoot(config);
  mkdirSync(root, { recursive: true });
  let candidate = join(root, "run_" + stampNow());
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(root, "run_" + stampNow() + "_" + String(n));
    n += 1;
  }
  mkdirSync(candidate, { recursive: true });
  return candidate;
}

function quoteForDisplay(value) {
  const text = String(value);
  if (text === "") return '""';
  if (!/[\s"&|<>^]/.test(text)) return text;
  return '"' + text.replace(/"/g, '\\"') + '"';
}

function commandSpec(config, flags, runDir, runConfigPath) {
  const args = [
    "--config",
    runConfigPath,
    "--run-dir",
    runDir,
    "--from-phase",
    String(flags.fromPhase)
  ];
  if (flags.short) args.push("--short");
  if (flags.noTdecq) args.push("--no-tdecq");
  const argv = ["bin\\run_eoe.cmd", ...args];
  return {
    args,
    argv,
    preview: argv.map(quoteForDisplay).join(" ")
  };
}

function checkPath(label, target, kind, level = "error") {
  const exists = existsSync(target);
  let ok = exists;
  let detail = target;
  if (exists && kind === "file") ok = statSync(target).isFile();
  if (exists && kind === "dir") ok = statSync(target).isDirectory();
  return {
    label,
    ok,
    level: ok ? "ok" : level,
    detail: detail + (exists ? "" : " (不存在)")
  };
}

function preflight(config, flags) {
  const p2Template = String(config.phase2?.envelope_template || "templates/sipho_envelope_phase2.net");
  const templatePath = isAbsolute(p2Template) ? p2Template : join(WORKBENCH_ROOT, p2Template);
  const ami = config.ami || {};
  const items = [
    checkPath("工作台根目录", WORKBENCH_ROOT, "dir"),
    checkPath("run_eoe.cmd", join(WORKBENCH_ROOT, "bin", "run_eoe.cmd"), "file"),
    checkPath("默认 config.yaml", configPath(), "file"),
    checkPath("ADS 根目录", config.hpeesof_dir, "dir"),
    checkPath("hpeesofsim", join(config.hpeesof_dir || "", "bin", "hpeesofsim.exe"), "file"),
    checkPath("Python", config.python, "file", "warn"),
    checkPath("Tx AMI 目录", ami.tx_dir, "dir"),
    checkPath("Rx AMI 目录", ami.rx_dir, "dir"),
    checkPath("Tx IBIS", join(ami.tx_dir || "", ami.tx_ibs || ""), "file"),
    checkPath("Rx IBIS", join(ami.rx_dir || "", ami.rx_ibs || ""), "file"),
    checkPath("通道 s4p (Tx)", join(ami.tx_dir || "", ami.passthrough_s4p || ""), "file"),
    checkPath("通道 s4p (Rx)", join(ami.rx_dir || "", ami.passthrough_s4p || ""), "file"),
    checkPath("PHASE2 Envelope 模板", templatePath, "file"),
    checkPath("结果根目录", config.paths?.results_root, "dir", "warn"),
    checkPath("PHASE2 工作区", config.wrk, "dir", "warn"),
    checkPath("官方 EOE 参考工作区", config.official_eoe_wrk, "dir", "warn")
  ];
  if (flags.fromPhase > 1) {
    items.push({
      label: "PHASE" + String(flags.fromPhase) + " 增量运行",
      ok: true,
      level: "info",
      detail: "前序相位将从已有运行目录读取产物；请确认该 run-dir 已有对应 CSV/.ds"
    });
  }
  if (flags.short) {
    items.push({
      label: "短冒烟模式",
      ok: true,
      level: "warn",
      detail: "--short 强制 PHASE1 n_bits<=1024、PHASE2 n_ui<=512，并跳过 PHASE3；不是完整链路"
    });
  }
  const errors = items.filter((item) => !item.ok && item.level === "error");
  const warnings = items.filter((item) => !item.ok && item.level === "warn");
  return {
    ok: errors.length === 0,
    items,
    errors: errors.length,
    warnings: warnings.length
  };
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLineOf(pid) {
  if (process.platform !== "win32") return "";
  const script =
    "(Get-CimInstance Win32_Process -Filter 'ProcessId=" + String(pid) + "').CommandLine";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function killTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 15000
    });
  } else {
    spawnSync("kill", ["-TERM", String(pid)], { timeout: 8000 });
  }
}

function ensureDirForFile(file) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
}

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  ensureDirForFile(file);
  const temporary = file + ".tmp-" + randomUUID();
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(temporary, file);
}

function writeTextAtomic(file, value) {
  ensureDirForFile(file);
  const temporary = file + ".tmp-" + randomUUID();
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, file);
}

function stateFile() {
  return join(STATE_DIR, "job.json");
}

function saveJobState() {
  try {
    writeJsonAtomic(stateFile(), {
      job: jobState.job,
      savedAt: new Date().toISOString(),
      pluginVersion: PLUGIN_VERSION
    });
  } catch {
    /* state is a convenience; the live job still works without it */
  }
}

function restoreJobState(logger) {
  const stored = readJson(stateFile());
  const job = stored && isPlainObject(stored.job) ? stored.job : null;
  if (!job || typeof job !== "object") return;
  const alive = pidAlive(Number(job.pid));
  if (alive) {
    jobState.job = { ...job, adopted: true, status: "running" };
    logger?.info?.("[eoe-workbench] adopted running job pid=" + String(job.pid));
    return;
  }
  if (job.status === "running" || job.status === "cancelling") {
    jobState.job = {
      ...job,
      adopted: true,
      status: "lost",
      endedAt: job.endedAt || new Date().toISOString(),
      error: "DSH 重启/插件重挂后原进程已退出；结果可能已写入 run-dir"
    };
    return;
  }
  jobState.job = job;
}

function latestSummary(runDir) {
  return readJson(join(runDir, "summary.json"));
}

function deriveJobStatus(job) {
  if (!job) return null;
  const alive = Number(job.pid) > 0 && pidAlive(Number(job.pid));
  if (alive) return "running";
  if (job.status === "cancelling") return "cancelled";
  if (["succeeded", "failed", "cancelled", "lost"].includes(job.status)) return job.status;
  const summary = latestSummary(job.runDir);
  if (summary) return summary.ok ? "succeeded" : "failed";
  return "failed";
}

function progressFromLog(logPath, flags) {
  let text = "";
  try {
    text = readTail(logPath, 220);
  } catch {
    text = "";
  }
  const short = Boolean(flags?.short);
  let phase = 0;
  let percent = 2;
  if (/SUMMARY\s+\{/.test(text)) {
    phase = 4;
    percent = 100;
  } else if (/PHASE3 (DONE|SKIPPED)/.test(text)) {
    phase = 3;
    percent = 96;
  } else if (/PHASE2 DONE/.test(text)) {
    phase = 3;
    percent = short ? 96 : 68;
  } else if (/PHASE2|SIM Phase2|Envelope/.test(text)) {
    phase = 2;
    percent = 42;
  } else if (/PHASE1 DONE/.test(text)) {
    phase = 2;
    percent = flags?.fromPhase >= 2 ? 42 : 34;
  } else if (/PHASE1|SIM Phase1/.test(text)) {
    phase = 1;
    percent = 12;
  }
  const labels = {
    0: "准备运行",
    1: "PHASE 1 · Tx AMI",
    2: "PHASE 2 · 光引擎 / Envelope",
    3: short ? "收尾 · PHASE 3 已跳过" : "PHASE 3 · Rx AMI",
    4: "已完成"
  };
  return { phase, label: labels[phase] || "运行中", percent };
}

function readTail(file, lines = 160, maxBytes = 2 * 1024 * 1024) {
  if (!file || !existsSync(file)) return "";
  try {
    const size = statSync(file).size;
    let text;
    if (size > maxBytes) {
      const fd = openSync(file, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        readSync(fd, buffer, 0, maxBytes, size - maxBytes);
        text = buffer.toString("utf8");
      } finally {
        closeSync(fd);
      }
    } else {
      text = readFileSync(file, "utf8");
    }
    const parts = text.split(/\r?\n/);
    return parts.slice(Math.max(0, parts.length - lines)).join("\n").trimEnd();
  } catch (error) {
    return "(cannot read log: " + String(error?.message || error) + ")";
  }
}

function stripAnsi(text) {
  return String(text ?? "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function selectJobLog(job) {
  if (!job) return "";
  const runLog = join(job.runDir || "", "run_log.txt");
  if (existsSync(runLog)) return runLog;
  return job.consolePath || "";
}

function jobSnapshot() {
  const job = jobState.job;
  if (!job) {
    return {
      ok: true,
      running: false,
      job: null,
      progress: { phase: 0, label: "空闲", percent: 0 },
      lastError: jobState.lastError
    };
  }
  const status = deriveJobStatus(job);
  const running = status === "running";
  const logPath = selectJobLog(job);
  const progress = running
    ? progressFromLog(logPath, job.flags)
    : {
        phase: status === "succeeded" ? 4 : 0,
        label:
          status === "succeeded"
            ? "已完成"
            : status === "cancelled"
              ? "已取消"
              : status === "lost"
                ? "进程失联"
                : "运行失败",
        percent: status === "succeeded" ? 100 : 0
      };
  return {
    ok: true,
    running,
    job: {
      ...job,
      status,
      pidAlive: Number(job.pid) > 0 ? pidAlive(Number(job.pid)) : false
    },
    progress,
    logTail: stripAnsi(readTail(logPath, 320)),
    consoleTail: stripAnsi(readTail(job.consolePath, 160)),
    summary: running ? null : compactSummary(job.runDir),
    lastError: jobState.lastError
  };
}

function startJob(config, flags, runDir, runConfigPath, spec) {
  const consolePath = join(runDir, "plugin_console.log");
  ensureDirForFile(consolePath);
  let fd = -1;
  try {
    fd = openSync(consolePath, "a");
  } catch (error) {
    throw httpError(500, "无法打开控制台日志: " + String(error?.message || error));
  }
  const environment = {
    ...process.env,
    HPEESOF_DIR: String(config.hpeesof_dir || ""),
    PYTHONIOENCODING: "utf-8"
  };
  let child;
  try {
    const comspec = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    child = spawn(comspec, ["/d", "/c", "bin\\run_eoe.cmd", ...spec.args], {
      cwd: WORKBENCH_ROOT,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", fd, fd]
    });
  } catch (error) {
    closeSync(fd);
    throw httpError(500, "无法启动 run_eoe.cmd: " + String(error?.message || error));
  }
  closeSync(fd);
  const job = {
    id: randomUUID(),
    pid: child.pid ?? null,
    runDir,
    configPath: runConfigPath,
    consolePath,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    status: "running",
    adopted: false,
    flags,
    argv: spec.argv,
    preview: spec.preview,
    error: null
  };
  jobState.job = job;
  jobState.child = child;
  jobState.stopping = false;
  jobState.lastError = null;
  saveJobState();

  child.on("error", (error) => {
    if (jobState.job?.id !== job.id) return;
    finishJob(-1, null, "spawn error: " + String(error?.message || error));
  });
  child.on("exit", (code, signal) => {
    if (jobState.job?.id !== job.id) return;
    finishJob(code, signal, null);
  });
  return jobSnapshot();
}

function finishJob(code, signal, error) {
  const job = jobState.job;
  if (!job) return;
  if (job.endedAt) return;
  const intentional = jobState.stopping || job.status === "cancelling";
  const summary = latestSummary(job.runDir);
  const logTail = readTail(selectJobLog(job), 120);
  const logFailure = /Traceback|PermissionError|ExecutionError|Error detected|ABORT at|hpeesofsim terminated/i.test(
    logTail
  );
  let status;
  if (intentional) status = "cancelled";
  else if (error) status = "failed";
  else if (summary && summary.ok === true) status = "succeeded";
  else status = "failed";
  job.endedAt = new Date().toISOString();
  job.exitCode = code ?? null;
  job.signal = signal ?? null;
  job.status = status;
  job.error = error || job.error || null;
  if (status === "failed") {
    if (summary?.failed_at) {
      job.error = "失败于 " + String(summary.failed_at) + (summary.note ? " · " + summary.note : "");
    } else if (!summary) {
      const lastLine = logTail
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-1)[0];
      job.error =
        "未生成 summary.json（run_eoe.cmd 的批处理退出码可能被 endlocal 归零）" +
        (lastLine ? " · " + truncate(lastLine, 300) : "");
    } else if (logFailure) {
      job.error = "运行日志报告错误；请打开 run_log.txt 查看";
    } else {
      job.error = "summary.json 报告 ok=false";
    }
  }
  jobState.child = null;
  jobState.stopping = false;
  jobState.lastError = job.error;
  saveJobState();
}

function cancelJob() {
  const job = jobState.job;
  if (!job) throw httpError(409, "当前没有运行中的任务");
  const status = deriveJobStatus(job);
  if (status !== "running") throw httpError(409, "任务已结束: " + status);
  const pid = Number(job.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw httpError(409, "当前任务没有可用 PID");
  if (!pidAlive(pid)) throw httpError(409, "进程已不存在: " + String(pid));
  if (!jobState.child) {
    const commandLine = commandLineOf(pid);
    if (commandLine && !/run_eoe|run_eoe\.py|hpeesofsim/i.test(commandLine)) {
      throw httpError(409, "拒绝取消：PID " + String(pid) + " 不是 EOE 工作台进程");
    }
  }
  job.status = "cancelling";
  jobState.stopping = true;
  saveJobState();
  // taskkill /T is the normal tree killer. child.kill() is a fallback for
  // environments where spawning taskkill is denied but the direct child is
  // still ours (the DSH host always owns this process).
  try {
    if (jobState.child && jobState.child.pid === pid) jobState.child.kill();
  } catch {
    /* taskkill below remains the primary path */
  }
  killTree(pid);
  return { ok: true, pid, runDir: job.runDir, status: "cancelling" };
}

// ---------------------------------------------------------------------------
// Run artifacts and compact results
// ---------------------------------------------------------------------------

function compactSummary(runDir) {
  if (!runDir || !existsSync(runDir)) return null;
  const summary = readJson(join(runDir, "summary.json"));
  const phase1 = summary?.phase1 || readJson(join(runDir, "phase1_manifest.json"));
  const phase2 = summary?.phase2 || readJson(join(runDir, "phase2_manifest.json"));
  const phase3 = summary?.phase3 || readJson(join(runDir, "phase3_manifest.json"));
  if (!summary && !phase1 && !phase2 && !phase3) return null;
  const tdecqHook = readJson(join(runDir, "tdecq_12185_hook.json")) || phase2?.tdecq || null;
  const eyeCsvCandidates = [
    "RxAMI_Eye_Rx_tx_eye.csv",
    "RxAMI_Eye_Rx.csv",
    "Tx_AMI_Eye_P.csv",
    "Tx_AMI_Eye_N.csv"
  ];
  const eyeCsvs = [];
  for (const name of eyeCsvCandidates) {
    const full = join(runDir, name);
    if (existsSync(full)) eyeCsvs.push({ name, path: full });
  }
  if (eyeCsvs.length === 0) {
    for (const file of safeReaddir(runDir)) {
      if (/\.csv$/i.test(file) && /eye/i.test(file)) {
        eyeCsvs.push({ name: file, path: join(runDir, file) });
      }
    }
  }
  const images = safeReaddir(runDir)
    .filter((file) => /\.(png|jpg|jpeg)$/i.test(file) && /eye|tia|optical/i.test(file))
    .map((file) => ({ name: file, path: join(runDir, file) }));
  const attempts = Array.isArray(phase3?.attempts)
    ? phase3.attempts.map((attempt) => ({
        tag: attempt?.tag ?? null,
        ok: Boolean(attempt?.ok),
        error: truncate(attempt?.error, 300)
      }))
    : [];
  const phaseOk = (value) =>
    value === null || value === undefined ? null : Boolean(value.ok) || Boolean(value.skipped);
  const ok =
    summary && typeof summary.ok === "boolean"
      ? summary.ok
      : Boolean(phaseOk(phase3) ?? phaseOk(phase2) ?? phaseOk(phase1));
  const stamp = summary?.stamp || basename(runDir).replace(/^run_/, "");
  const configPathInRun = join(runDir, "config.yaml");
  const startedMtime = existsSync(configPathInRun)
    ? statSync(configPathInRun).mtimeMs
    : statSync(runDir).mtimeMs;
  const endMtime = existsSync(join(runDir, "summary.json"))
    ? statSync(join(runDir, "summary.json")).mtimeMs
    : statSync(runDir).mtimeMs;
  return {
    ok,
    runDir,
    name: basename(runDir),
    stamp,
    when: summary?.when || null,
    short: Boolean(summary?.short),
    fromPhase: Number(summary?.from_phase ?? 1),
    bitrateGbps: numberOr(summary?.bitrate_gbps ?? phase1?.bitrate_gbps, null),
    baudHz: numberOr(summary?.baud_hz ?? phase1?.baud_hz, null),
    format: summary?.format || "PAM4",
    failedAt: summary?.failed_at || null,
    note: summary?.note || phase3?.note || null,
    durationMs: Math.max(0, endMtime - startedMtime),
    phases: {
      1: {
        present: Boolean(phase1),
        ok: phaseOk(phase1),
        skipped: false,
        nBits: phase1?.n_bits ?? null,
        nUi: phase1?.n_ui ?? null,
        eyePoints: phase1?.eye_p_n ?? null,
        log: phase1?.sim?.logfile ?? null
      },
      2: {
        present: Boolean(phase2),
        ok: phaseOk(phase2),
        skipped: false,
        nUi: phase2?.n_ui ?? null,
        tdecqDb: numberOr(tdecqHook?.TDECQ_dB, null),
        log: phase2?.optics?.logfile ?? null
      },
      3: {
        present: Boolean(phase3),
        ok: phaseOk(phase3),
        skipped: Boolean(phase3?.skipped),
        winner: phase3?.winner ?? null,
        eyePoints: phase3?.eye_rx_n ?? null,
        attempts,
        log: phase3?.attempts?.find((item) => item?.ok)?.sim?.logfile ?? null
      }
    },
    tdecq: tdecqHook
      ? {
          ok: Boolean(tdecqHook.ok),
          dB: numberOr(tdecqHook.TDECQ_dB, null),
          claim: tdecqHook.claim || "COMPUTED — NOT FlexDCA / NOT compliance",
          omaMethod: tdecqHook.metrics?.OMA_method || null,
          erDb: numberOr(tdecqHook.metrics?.ER_dB, null),
          q: numberOr(tdecqHook.metrics?.Q, null)
        }
      : null,
    eyeCsvs,
    images,
    error: summary?.failed_at ? "失败于 " + String(summary.failed_at) : null
  };
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function truncate(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}

function listArtifacts(runDir, config) {
  if (!runDir || !existsSync(runDir)) return [];
  const root = resolve(runDir);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || out.length >= 500) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= 500) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(root, full).replace(/\\/g, "/");
      const ext = extname(entry.name).toLowerCase();
      out.push({
        name: entry.name,
        rel,
        path: full,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        ext,
        kind: artifactKind(ext, entry.name),
        phase: artifactPhase(rel)
      });
    }
  };
  walk(root, 0);
  return out.sort((a, b) => {
    if (a.phase !== b.phase) return String(a.phase).localeCompare(String(b.phase));
    return a.rel.localeCompare(b.rel);
  });
}

function artifactKind(ext, name) {
  if ([".png", ".jpg", ".jpeg", ".svg"].includes(ext)) return "image";
  if (ext === ".csv") return /eye/i.test(name) ? "eye-csv" : "csv";
  if (ext === ".json") return "json";
  if (ext === ".ds") return "dataset";
  if (ext === ".net") return "netlist";
  if (ext === ".log" || ext === ".txt") return "log";
  if (ext === ".yaml" || ext === ".yml") return "config";
  if (ext === ".html") return "html";
  return "file";
}

function artifactPhase(rel) {
  if (/^phase1|Tx_AMI|Phase1/i.test(rel)) return "01";
  if (/^phase2|Rx_TIA|N_pam|Phase2|tdecq/i.test(rel)) return "02";
  if (/^phase3|RxAMI|Phase3/i.test(rel)) return "03";
  if (/summary|run_log|config|plugin_console|SMOKE/i.test(rel)) return "00";
  return "09";
}

function listRuns(config, limit = 12) {
  const root = resultsRoot(config);
  if (!existsSync(root)) return [];
  let dirs = [];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
  const runs = [];
  for (const dir of dirs) {
    let mtime = 0;
    try {
      mtime = statSync(dir).mtimeMs;
    } catch {
      continue;
    }
    const hasSummary = existsSync(join(dir, "summary.json"));
    const hasLog = existsSync(join(dir, "run_log.txt"));
    if (!hasSummary && !hasLog && !existsSync(join(dir, "phase1_manifest.json"))) continue;
    const compact = compactSummary(dir);
    if (!compact) continue;
    runs.push({
      name: basename(dir),
      path: dir,
      mtime: new Date(mtime).toISOString(),
      ok: compact.ok,
      short: compact.short,
      fromPhase: compact.fromPhase,
      failedAt: compact.failedAt,
      bitrateGbps: compact.bitrateGbps,
      phase3Winner: compact.phases?.[3]?.winner || null,
      tdecqDb: compact.tdecq?.dB ?? null
    });
  }
  runs.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
  return runs.slice(0, Math.max(1, Math.min(Number(limit) || 12, 30)));
}

function resolveExistingRunDir(body, config, require = false) {
  const requested =
    (typeof body?.runDir === "string" && body.runDir) ||
    (typeof body?.run_dir === "string" && body.run_dir) ||
    jobState.job?.runDir ||
    "";
  if (!requested) {
    if (require) throw httpError(400, "缺少 runDir");
    return null;
  }
  const dir = normaliseRoot(requested);
  if (!existsSync(dir)) throw httpError(404, "run-dir 不存在: " + dir);
  if (
    !isPathInside(dir, resultsRoot(config)) &&
    !isPathInside(dir, normaliseRoot(config.workroot || WORKBENCH_ROOT)) &&
    dir !== jobState.job?.runDir
  ) {
    throw httpError(403, "run-dir 不在允许的结果范围内");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Eye CSV folding
// ---------------------------------------------------------------------------

function parseCsvPairs(file, limit = 300000) {
  let text;
  try {
    const size = statSync(file).size;
    if (size > 40 * 1024 * 1024) throw new Error("CSV 超过 40 MB，拒绝解析");
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw httpError(400, "无法读取 CSV: " + String(error?.message || error));
  }
  const points = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (points.length >= limit) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/[,\s]+/);
    if (parts.length < 2) continue;
    const t = Number(parts[0]);
    const v = Number(parts[1]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    points.push([t, v]);
  }
  return points;
}

function eyePayload(file, baudHz) {
  if (!existsSync(file)) throw httpError(404, "眼图 CSV 不存在: " + file);
  const pairs = parseCsvPairs(file);
  if (pairs.length < 10) throw httpError(422, "CSV 有效点太少，无法绘眼");
  if (!(baudHz > 0)) throw httpError(400, "baud_hz 必须大于 0");
  const ui = 1 / baudHz;
  const t0 = pairs[0][0];
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const [, v] of pairs) {
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  if (!(vMax > vMin)) {
    vMax = vMin + 1;
  }
  const pad = (vMax - vMin) * 0.06;
  const low = vMin - pad;
  const high = vMax + pad;
  const width = 240;
  const height = 160;
  const counts = new Uint32Array(width * height);
  const hist = new Uint32Array(96);
  for (const [t, v] of pairs) {
    let phase = ((t - t0) / ui) % 1;
    if (phase < 0) phase += 1;
    const x = Math.max(0, Math.min(width - 1, Math.floor(phase * width)));
    let y = Math.floor(((high - v) / (high - low)) * height);
    if (y < 0) y = 0;
    if (y >= height) y = height - 1;
    counts[y * width + x] += 1;
    const h = Math.max(0, Math.min(hist.length - 1, Math.floor(((v - low) / (high - low)) * hist.length)));
    hist[h] += 1;
  }
  let max = 0;
  for (const count of counts) if (count > max) max = count;
  return {
    ok: true,
    path: file,
    name: basename(file),
    samples: pairs.length,
    t0,
    tSpanNs: ((pairs[pairs.length - 1][0] - t0) * 1e9) || 0,
    uiPeriodPs: ui * 1e12,
    baudHz,
    levelRange: [vMin, vMax],
    grid: {
      w: width,
      h: height,
      max,
      values: Array.from(counts)
    },
    histogram: {
      bins: hist.length,
      min: low,
      max: high,
      values: Array.from(hist)
    }
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function httpError(status, message, extra) {
  const error = new Error(message);
  error.status = status;
  if (extra && typeof extra === "object") error.extra = extra;
  return error;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolvePromise, reject) => {
    if (!req || typeof req.on !== "function") {
      resolvePromise({});
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        fail(httpError(413, "请求体超过 " + String(limit) + " 字节"));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolvePromise({});
        return;
      }
      try {
        const value = JSON.parse(text);
        if (!isPlainObject(value)) throw new Error("body must be a JSON object");
        resolvePromise(value);
      } catch (error) {
        reject(httpError(400, "请求体不是有效 JSON 对象: " + String(error?.message || error)));
      }
    });
    req.on("error", (error) => fail(error));
    req.on("aborted", () => fail(httpError(400, "请求体被中断")));
  });
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    /^127\./.test(address)
  );
}

function isTrustedMutation(req) {
  if (req.headers[MUTATION_HEADER] !== "1") return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function contentType(file) {
  const ext = extname(file).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".csv": "text/csv; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".log": "text/plain; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".yaml": "text/yaml; charset=utf-8",
      ".yml": "text/yaml; charset=utf-8",
      ".net": "text/plain; charset=utf-8",
      ".html": "text/html; charset=utf-8"
    }[ext] || "application/octet-stream"
  );
}

async function handleRequest(req, res, ctx) {
  if (!isLoopback(req)) {
    sendJson(res, 403, { ok: false, error: "EOE control API 仅监听 loopback" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const action = url.pathname.slice(API_PREFIX.length).replace(/\/$/, "") || "/status";
  const method = req.method ?? "GET";

  if (action === "/status" || action === "/health") {
    if (method !== "GET" && method !== "HEAD") throw httpError(405, "status 是 GET");
    const configInfo = loadConfigFile();
    sendJson(res, 200, {
      ok: true,
      app: "eoe-workbench",
      version: PLUGIN_VERSION,
      workbenchRoot: WORKBENCH_ROOT,
      configPath: configInfo.path,
      configMtime: configInfo.mtime,
      pluginDir: MODULE_DIR,
      ...jobSnapshot()
    });
    return;
  }

  if (action === "/config") {
    if (method !== "GET") throw httpError(405, "config 是 GET");
    const info = loadConfigFile();
    sendJson(res, 200, {
      ok: true,
      path: info.path,
      mtime: info.mtime,
      size: info.size,
      config: info.config,
      raw: info.raw
    });
    return;
  }

  if (action === "/preflight") {
    if (method !== "POST") throw httpError(405, "preflight 是 POST");
    if (!isTrustedMutation(req)) throw httpError(403, "preflight 需要 " + MUTATION_HEADER + " 请求头");
    const body = await readJsonBody(req);
    const info = loadConfigFile();
    const config = asConfig(body, info.config);
    const flags = normaliseFlags(body);
    const validation = validateConfig(config, flags);
    const checks = preflight(config, flags);
    const runDir = flags.runDir
      ? assertRunDirAllowed(flags.runDir, config)
      : join(resultsRoot(config), "run_" + stampNow());
    const runConfigPath = join(runDir, "config.yaml");
    sendJson(res, 200, {
      ok: validation.ok && checks.ok,
      validation,
      checks,
      flags,
      command: commandSpec(config, flags, runDir, runConfigPath)
    });
    return;
  }

  if (action === "/config/save") {
    if (method !== "POST") throw httpError(405, "config/save 是 POST");
    if (!isTrustedMutation(req)) throw httpError(403, "config/save 需要 " + MUTATION_HEADER + " 请求头");
    const body = await readJsonBody(req);
    const defaults = loadConfigFile();
    const config = asConfig(body, defaults.config);
    const validation = validateConfig(config, normaliseFlags(body));
    if (!validation.ok) throw httpError(422, "配置校验失败", { validation });
    const target = body.target === "default" ? "default" : "snapshot";
    let path;
    let backup = null;
    if (target === "default") {
      if (body.confirmOverwriteDefault !== true) {
        throw httpError(400, "覆盖默认配置必须显式 confirmOverwriteDefault=true");
      }
      path = configPath();
      if (existsSync(path)) {
        backup = path + ".bak-eoe-" + stampNow();
        writeFileSync(backup, readFileSync(path));
      }
    } else {
      const requested =
        typeof body.runDir === "string" && body.runDir.trim() !== ""
          ? body.runDir.trim()
          : join(resultsRoot(config), "_config_snapshots", "snapshot_" + stampNow());
      path = join(assertRunDirAllowed(requested, config), "config.yaml");
    }
    writeTextAtomic(path, serializeConfig(config));
    sendJson(res, 200, { ok: true, path, backup, target });
    return;
  }

  if (action === "/run") {
    if (method !== "POST") throw httpError(405, "run 是 POST");
    if (!isTrustedMutation(req)) throw httpError(403, "run 需要 " + MUTATION_HEADER + " 请求头");
    if (deriveJobStatus(jobState.job) === "running") {
      throw httpError(409, "已有 EOE 任务在运行；先取消或等待结束", { job: jobSnapshot() });
    }
    const body = await readJsonBody(req);
    const defaults = loadConfigFile();
    const config = asConfig(body, defaults.config);
    const flags = normaliseFlags(body);
    const validation = validateConfig(config, flags);
    if (!validation.ok) throw httpError(422, "配置校验失败", { validation });
    const checks = preflight(config, flags);
    if (!checks.ok) throw httpError(422, "预检失败，未启动 CLI", { validation, checks });
    const runDir =
      body.dryRun === true
        ? flags.runDir
          ? assertRunDirAllowed(flags.runDir, config)
          : join(resultsRoot(config), "run_" + stampNow())
        : makeRunDir(config, flags.runDir);
    const runConfigPath = join(runDir, "config.yaml");
    const spec = commandSpec(config, flags, runDir, runConfigPath);
    if (body.dryRun === true) {
      sendJson(res, 200, {
        ok: true,
        dryRun: true,
        runDir,
        configPath: runConfigPath,
        command: spec,
        checks,
        validation
      });
      return;
    }
    if (existsSync(runConfigPath)) {
      const backup = runConfigPath + ".bak-" + stampNow();
      writeFileSync(backup, readFileSync(runConfigPath));
    }
    writeTextAtomic(runConfigPath, serializeConfig(config));
    writeJsonAtomic(join(runDir, "run_request.json"), {
      requestedAt: new Date().toISOString(),
      pluginVersion: PLUGIN_VERSION,
      flags,
      argv: spec.argv,
      preview: spec.preview,
      checks
    });
    const snapshot = startJob(config, flags, runDir, runConfigPath, spec);
    sendJson(res, 200, { ok: true, dryRun: false, ...snapshot });
    return;
  }

  if (action === "/job") {
    if (method !== "GET") throw httpError(405, "job 是 GET");
    sendJson(res, 200, jobSnapshot());
    return;
  }

  if (action === "/cancel") {
    if (method !== "POST") throw httpError(405, "cancel 是 POST");
    if (!isTrustedMutation(req)) throw httpError(403, "cancel 需要 " + MUTATION_HEADER + " 请求头");
    if (!jobState.job) throw httpError(409, "当前没有运行中的任务");
    const result = cancelJob();
    sendJson(res, 200, { ok: true, ...result, snapshot: jobSnapshot() });
    return;
  }

  if (action === "/runs") {
    if (method !== "GET") throw httpError(405, "runs 是 GET");
    const config = loadConfigFile().config;
    sendJson(res, 200, { ok: true, runs: listRuns(config, url.searchParams.get("limit")) });
    return;
  }

  if (action === "/summary" || action === "/artifacts" || action === "/run-log") {
    if (method !== "GET") throw httpError(405, action.slice(1) + " 是 GET");
    const config = loadConfigFile().config;
    const runDir = resolveExistingRunDir(
      { runDir: url.searchParams.get("runDir") },
      config,
      true
    );
    if (action === "/summary") {
      sendJson(res, 200, { ok: true, summary: compactSummary(runDir) });
      return;
    }
    if (action === "/artifacts") {
      sendJson(res, 200, { ok: true, runDir, artifacts: listArtifacts(runDir, config) });
      return;
    }
    const lines = Math.min(Math.max(Number(url.searchParams.get("tail") ?? 700) || 700, 1), MAX_LOG_TAIL);
    const logPath = join(runDir, "run_log.txt");
    sendJson(res, 200, {
      ok: true,
      runDir,
      logPath,
      tail: stripAnsi(readTail(logPath, lines))
    });
    return;
  }

  if (action === "/file") {
    if (method !== "GET" && method !== "HEAD") throw httpError(405, "file 是 GET");
    const config = loadConfigFile().config;
    const requestedPath = url.searchParams.get("path");
    if (!requestedPath) throw httpError(400, "缺少 path");
    const runDir = resolveExistingRunDir(
      { runDir: url.searchParams.get("runDir") },
      config,
      false
    );
    const resolved = isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(runDir || resultsRoot(config), requestedPath);
    const allowed =
      (runDir && isPathInside(resolved, runDir)) ||
      isPathInside(resolved, resultsRoot(config)) ||
      (jobState.job?.runDir && isPathInside(resolved, jobState.job.runDir));
    if (!allowed) throw httpError(403, "文件不在当前结果目录内");
    if (!existsSync(resolved)) throw httpError(404, "文件不存在");
    const stat = statSync(resolved);
    if (!stat.isFile()) throw httpError(400, "不是文件");
    if (stat.size > MAX_PREVIEW_BYTES) {
      throw httpError(413, "文件 " + String(stat.size) + " 字节，超过预览上限；请在结果目录中查看");
    }
    res.writeHead(200, {
      "content-type": contentType(resolved),
      "content-length": stat.size,
      "cache-control": "no-store",
      "content-disposition": "inline; filename=\"" + basename(resolved).replace(/"/g, "") + "\""
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(readFileSync(resolved));
    return;
  }

  if (action === "/eye") {
    if (method !== "GET") throw httpError(405, "eye 是 GET");
    const config = loadConfigFile().config;
    const requestedPath = url.searchParams.get("path");
    if (!requestedPath) throw httpError(400, "缺少 path");
    const runDir = resolveExistingRunDir(
      { runDir: url.searchParams.get("runDir") },
      config,
      false
    );
    const resolved = isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(runDir || resultsRoot(config), requestedPath);
    const allowed =
      (runDir && isPathInside(resolved, runDir)) ||
      isPathInside(resolved, resultsRoot(config)) ||
      (jobState.job?.runDir && isPathInside(resolved, jobState.job.runDir));
    if (!allowed) throw httpError(403, "眼图 CSV 不在当前结果目录内");
    const baudHz = numberOr(
      url.searchParams.get("baud_hz"),
      numberOr(config.link?.baud_hz, 0)
    );
    sendJson(res, 200, eyePayload(resolved, baudHz));
    return;
  }

  throw httpError(404, "未知 EOE API: " + action);
}

export function apply(ctx) {
  try {
    restoreJobState(ctx?.logger);
  } catch (error) {
    if (ctx?.logger?.warn) ctx.logger.warn("[eoe-workbench] restore job state failed", error);
  }
  ctx.inject(["webServer"], (webCtx) => {
    if (!webCtx?.webServer?.register) return;
    const effect =
      typeof webCtx.effect === "function"
        ? webCtx.effect.bind(webCtx)
        : typeof ctx.effect === "function"
          ? ctx.effect.bind(ctx)
          : (fn) => fn();
    effect(() => {
      const dispose = webCtx.webServer.register({
        kind: "prefix",
        path: API_PREFIX,
        handler: (req, res) => {
          handleRequest(req, res, ctx).catch((error) => {
            const status = Number(error?.status) || 500;
            if (ctx?.logger?.warn && status >= 500) {
              ctx.logger.warn("[eoe-workbench] API error", error);
            }
            if (!res.headersSent) {
              sendJson(res, status, {
                ok: false,
                error: String(error?.message || error),
                ...(error?.extra || {})
              });
            } else {
              res.destroy();
            }
          });
        }
      });
      return () => {
        try {
          if (typeof dispose === "function") dispose();
        } catch {
          /* server is going away */
        }
      };
    }, "eoe-workbench: local control API");
  });
}

export const __test = {
  parseYaml,
  serializeConfig,
  validateConfig,
  preflight,
  compactSummary,
  eyePayload,
  listArtifacts
};
