// EOE Workbench — browser half (lazy-CJS client plugin).
//
// Registers the sidebar panel and the main-area page, then drives the local
// host API (/api/eoe/*) from a single instrument-style surface. Everything is
// offline: no CDN, no webfont, no icon package. React is the only external.
window.__ModuleLoader__.load({
  id: "@local/dsh-eoe-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const { useCallback, useEffect, useMemo, useRef, useState } = react;

    const PANEL_ID = "eoe-workbench";
    const STYLE_ID = "eoe-workbench-styles";
    const API = "/api/eoe";
    const POLL_RUNNING_MS = 1200;
    const POLL_IDLE_MS = 5000;
    const HEADER_LINES = 5000;

    // ---------------------------------------------------------------------
    // Tiny utilities
    // ---------------------------------------------------------------------

    function h(tag, props, ...children) {
      return react.createElement(tag, { ...(props || {}) }, ...children);
    }

    function cx(...values) {
      return values.filter(Boolean).join(" ");
    }

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function getIn(object, path) {
      return String(path)
        .split(".")
        .reduce((current, key) => (current == null ? undefined : current[key]), object);
    }

    function setIn(object, path, value) {
      const keys = String(path).split(".");
      const root = { ...(object || {}) };
      let cursor = root;
      for (let index = 0; index < keys.length - 1; index += 1) {
        const key = keys[index];
        cursor[key] = { ...(cursor[key] || {}) };
        cursor = cursor[key];
      }
      cursor[keys[keys.length - 1]] = value;
      return root;
    }

    function fmtBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n < 0) return "—";
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
      return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
    }

    function fmtDuration(ms) {
      const n = Math.max(0, Number(ms) || 0);
      if (n < 1000) return String(Math.round(n)) + " ms";
      if (n < 60000) return (n / 1000).toFixed(1) + " s";
      const m = Math.floor(n / 60000);
      const s = Math.round((n % 60000) / 1000);
      return m + "m " + String(s).padStart(2, "0") + "s";
    }

    function fmtTime(value) {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }

    function fmtNum(value, digits = 3) {
      if (value === null || value === undefined || value === "") return "—";
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(2);
      return String(Number(n.toFixed(digits)));
    }

    function fmtGbps(value) {
      if (value === null || value === undefined) return "—";
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return n.toFixed(2).replace(/\.?0+$/, "") + " Gb/s";
    }

    function fmtGHz(value) {
      if (value === null || value === undefined) return "—";
      const n = Number(value) / 1e9;
      return Number.isFinite(n) ? n.toFixed(3) + " GBd" : "—";
    }

    function fmtPs(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) + " ps" : "—";
    }

    function percent(value) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    }

    function shortPath(value, limit = 42) {
      const text = String(value || "");
      if (text.length <= limit) return text;
      const head = Math.ceil((limit - 3) / 2);
      const tail = Math.floor((limit - 3) / 2);
      return text.slice(0, head) + "…" + text.slice(text.length - tail);
    }

    function classForPhase(status) {
      return "eoe-phase-" + String(status || "idle");
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(String(text));
        return true;
      } catch {
        return false;
      }
    }

    // ---------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------

    async function api(path, options = {}) {
      const response = await fetch(API + path, {
        cache: "no-store",
        ...options,
        headers: {
          "x-eoe-workbench": "1",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {})
        }
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const error = new Error(payload && payload.error ? payload.error : "HTTP " + String(response.status));
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload || {};
    }

    function fileUrl(artifact, runDir) {
      if (!artifact || !artifact.path) return "";
      const query = ["path=" + encodeURIComponent(artifact.path)];
      if (runDir) query.push("runDir=" + encodeURIComponent(runDir));
      return API + "/file?" + query.join("&");
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    function injectStyles() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
.eoe-root{
  --eoe-bg:#071014;--eoe-bg2:#0b171c;--eoe-panel:#0c191e;--eoe-panel2:#101f25;
  --eoe-ink:#dfeae8;--eoe-ink2:#a8bdb9;--eoe-muted:#6d8582;--eoe-line:rgba(155,196,188,.16);
  --eoe-line2:rgba(155,196,188,.28);--eoe-amber:#f2b35e;--eoe-amber2:#d88b2f;
  --eoe-cyan:#4fd3c6;--eoe-cyan2:#1b8f8a;--eoe-red:#ff7368;--eoe-lime:#9ecb86;
  --eoe-shadow:0 18px 50px rgba(0,0,0,.28);
  height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;
  color:var(--eoe-ink);background:
    radial-gradient(1100px 480px at 72% -12%,rgba(79,211,198,.08),transparent 62%),
    radial-gradient(900px 520px at 8% 110%,rgba(242,179,94,.075),transparent 65%),
    repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0,rgba(255,255,255,.016) 1px,transparent 1px,transparent 36px),
    repeating-linear-gradient(90deg,rgba(255,255,255,.012) 0,rgba(255,255,255,.012) 1px,transparent 1px,transparent 36px),
    var(--eoe-bg);
  font-family:"Bahnschrift","DIN Alternate","Aptos Display","Segoe UI Variable Display","Trebuchet MS",sans-serif;
  font-size:13px;line-height:1.45;letter-spacing:.01em;
}
.eoe-root *{box-sizing:border-box}
.eoe-root button,.eoe-root input,.eoe-root select,.eoe-root textarea{font:inherit}
.eoe-root ::selection{background:rgba(242,179,94,.28)}
.eoe-root ::-webkit-scrollbar{width:10px;height:10px}
.eoe-root ::-webkit-scrollbar-thumb{background:rgba(155,196,188,.22);border:3px solid transparent;background-clip:content-box;border-radius:8px}
.eoe-root ::-webkit-scrollbar-thumb:hover{background:rgba(242,179,94,.4);border:3px solid transparent;background-clip:content-box}
.eoe-mono{font-family:"Cascadia Code","Cascadia Mono","JetBrains Mono","Consolas",monospace;font-variant-ligatures:none}
.eoe-top{
  flex:0 0 auto;display:flex;align-items:center;gap:18px;padding:15px 22px 13px;
  border-bottom:1px solid var(--eoe-line);background:linear-gradient(180deg,rgba(11,23,28,.96),rgba(7,16,20,.82));
  position:relative;z-index:5;
}
.eoe-brand{display:flex;align-items:center;gap:12px;min-width:270px}
.eoe-mark{
  width:38px;height:38px;border:1px solid rgba(242,179,94,.74);border-radius:3px;
  display:grid;place-items:center;background:linear-gradient(135deg,rgba(242,179,94,.16),rgba(79,211,198,.06));
  box-shadow:inset 0 0 18px rgba(242,179,94,.08),0 0 0 1px rgba(0,0,0,.35);
  position:relative;flex:0 0 auto;
}
.eoe-mark:after{content:"";position:absolute;right:-4px;top:-4px;width:7px;height:7px;background:var(--eoe-amber);box-shadow:0 0 12px rgba(242,179,94,.8)}
.eoe-mark svg{width:26px;height:26px;color:var(--eoe-amber)}
.eoe-brand-copy{min-width:0}
.eoe-brand-line{display:flex;align-items:baseline;gap:9px;white-space:nowrap}
.eoe-brand-name{font-size:18px;font-weight:650;letter-spacing:.13em;line-height:1.1}
.eoe-brand-name b{color:var(--eoe-amber);font-weight:650}
.eoe-brand-tag{font-size:9.5px;letter-spacing:.22em;color:var(--eoe-amber);border:1px solid rgba(242,179,94,.36);padding:2px 5px;border-radius:2px;text-transform:uppercase;transform:translateY(-1px)}
.eoe-brand-sub{font-size:10px;letter-spacing:.12em;color:var(--eoe-muted);text-transform:uppercase;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-top-mid{display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0;justify-content:center}
.eoe-top-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.eoe-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--eoe-line2);border-radius:2px;padding:5px 8px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--eoe-ink2);background:rgba(0,0,0,.18);white-space:nowrap}
.eoe-chip b{color:var(--eoe-ink);font-weight:600}
.eoe-led{width:7px;height:7px;border-radius:50%;background:var(--eoe-muted);box-shadow:0 0 0 3px rgba(109,133,130,.1);flex:0 0 auto}
.eoe-led.ok{background:var(--eoe-lime);box-shadow:0 0 0 3px rgba(158,203,134,.12),0 0 10px rgba(158,203,134,.5)}
.eoe-led.running{background:var(--eoe-amber);box-shadow:0 0 0 3px rgba(242,179,94,.12),0 0 12px rgba(242,179,94,.65);animation:eoe-pulse 1.4s ease-in-out infinite}
.eoe-led.error{background:var(--eoe-red);box-shadow:0 0 0 3px rgba(255,115,104,.12),0 0 10px rgba(255,115,104,.45)}
.eoe-status-strip{
  flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:7px 22px;border-bottom:1px solid var(--eoe-line);
  background:rgba(4,11,14,.62);font-size:10px;letter-spacing:.09em;color:var(--eoe-muted);text-transform:uppercase;
  overflow:hidden;white-space:nowrap;
}
.eoe-status-strip b{color:var(--eoe-ink2);font-weight:600}
.eoe-status-strip .eoe-sep{width:1px;height:10px;background:var(--eoe-line2);flex:0 0 auto}
.eoe-status-strip .eoe-strip-grow{flex:1 1 auto}
.eoe-work{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:236px minmax(0,1fr) 326px;gap:0}
.eoe-rail,.eoe-main,.eoe-deck{min-height:0;overflow:auto}
.eoe-rail{border-right:1px solid var(--eoe-line);padding:18px 15px 24px;background:linear-gradient(180deg,rgba(8,18,22,.65),rgba(7,15,19,.25))}
.eoe-main{padding:0 0 30px;background:rgba(7,16,20,.2)}
.eoe-deck{border-left:1px solid var(--eoe-line);padding:18px 15px 28px;background:linear-gradient(180deg,rgba(9,20,25,.78),rgba(7,15,19,.3))}
.eoe-rail-head{font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--eoe-muted);margin:0 0 12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.eoe-rail-head b{color:var(--eoe-amber);font-weight:600;font-size:9px}
.eoe-phase-list{position:relative;margin:0 0 22px}
.eoe-phase-list:before{content:"";position:absolute;left:14px;top:18px;bottom:18px;width:1px;background:linear-gradient(180deg,var(--eoe-line2),rgba(155,196,188,.05))}
.eoe-phase{position:relative;display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;padding:0 0 14px;cursor:default}
.eoe-phase:last-child{padding-bottom:0}
.eoe-phase-node{
  width:29px;height:29px;border-radius:50%;border:1px solid var(--eoe-line2);background:var(--eoe-bg);
  display:grid;place-items:center;font-family:"Cascadia Code","Consolas",monospace;font-size:10px;color:var(--eoe-muted);
  position:relative;z-index:1;transition:border-color .2s,color .2s,box-shadow .2s;
}
.eoe-phase.active .eoe-phase-node{border-color:var(--eoe-amber);color:var(--eoe-amber);box-shadow:0 0 0 4px rgba(242,179,94,.08),0 0 18px rgba(242,179,94,.18)}
.eoe-phase.done .eoe-phase-node{border-color:var(--eoe-cyan2);color:var(--eoe-cyan);background:rgba(79,211,198,.08)}
.eoe-phase.fail .eoe-phase-node{border-color:rgba(255,115,104,.7);color:var(--eoe-red);background:rgba(255,115,104,.08)}
.eoe-phase.skip .eoe-phase-node{opacity:.45}
.eoe-phase-copy{min-width:0;padding-top:1px}
.eoe-phase-kicker{font-size:8.5px;letter-spacing:.16em;color:var(--eoe-muted);text-transform:uppercase}
.eoe-phase-title{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--eoe-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-phase-meta{font-family:"Cascadia Code","Consolas",monospace;font-size:9.5px;color:var(--eoe-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-phase.active .eoe-phase-title{color:var(--eoe-amber)}
.eoe-phase.done .eoe-phase-title{color:var(--eoe-cyan)}
.eoe-phase.fail .eoe-phase-title{color:var(--eoe-red)}
.eoe-quick-label{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--eoe-muted);margin:0 0 7px;display:flex;justify-content:space-between;gap:8px}
.eoe-quick-label b{color:var(--eoe-ink2);font-weight:500}
.eoe-run-list{display:flex;flex-direction:column;gap:5px;margin-bottom:20px}
.eoe-run-item{
  display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;
  background:transparent;border:1px solid transparent;border-radius:2px;padding:6px 7px;text-align:left;color:var(--eoe-ink2);cursor:pointer;
}
.eoe-run-item:hover{background:rgba(155,196,188,.05);border-color:var(--eoe-line)}
.eoe-run-item.selected{background:rgba(242,179,94,.07);border-color:rgba(242,179,94,.26);color:var(--eoe-ink)}
.eoe-run-dot{width:6px;height:6px;border-radius:50%;background:var(--eoe-muted)}
.eoe-run-dot.ok{background:var(--eoe-lime)}
.eoe-run-dot.bad{background:var(--eoe-red)}
.eoe-run-name{font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eoe-run-time{font-family:"Cascadia Code","Consolas",monospace;font-size:8.5px;color:var(--eoe-muted);white-space:nowrap}
.eoe-mini-note{font-size:10px;color:var(--eoe-muted);line-height:1.6}
.eoe-mini-note b{color:var(--eoe-ink2);font-weight:500}
.eoe-tabs{
  position:sticky;top:0;z-index:3;display:flex;align-items:flex-end;gap:2px;padding:0 22px;
  border-bottom:1px solid var(--eoe-line);background:rgba(7,16,20,.92);backdrop-filter:blur(10px);
}
.eoe-tab{
  appearance:none;border:0;background:transparent;color:var(--eoe-muted);padding:14px 13px 11px;cursor:pointer;
  font-size:10px;letter-spacing:.16em;text-transform:uppercase;border-bottom:2px solid transparent;position:relative;display:flex;align-items:center;gap:7px;
}
.eoe-tab:hover{color:var(--eoe-ink2)}
.eoe-tab.active{color:var(--eoe-amber);border-bottom-color:var(--eoe-amber)}
.eoe-tab .eoe-tab-no{font-family:"Cascadia Code","Consolas",monospace;font-size:9px;opacity:.7}
.eoe-tab-count{font-family:"Cascadia Code","Consolas",monospace;font-size:8px;border:1px solid var(--eoe-line2);padding:1px 4px;border-radius:2px;color:var(--eoe-muted)}
.eoe-tab.active .eoe-tab-count{color:var(--eoe-amber);border-color:rgba(242,179,94,.35)}
.eoe-view{padding:20px 22px 0;animation:eoe-reveal .22s ease-out both}
.eoe-section{
  border:1px solid var(--eoe-line);border-radius:3px;background:linear-gradient(160deg,rgba(16,31,37,.72),rgba(9,20,25,.5));
  margin:0 0 14px;position:relative;
}
.eoe-section:before,.eoe-section:after{content:"";position:absolute;width:12px;height:12px;pointer-events:none;opacity:.7}
.eoe-section:before{left:-1px;top:-1px;border-left:1px solid var(--eoe-amber);border-top:1px solid var(--eoe-amber)}
.eoe-section:after{right:-1px;bottom:-1px;border-right:1px solid rgba(79,211,198,.75);border-bottom:1px solid rgba(79,211,198,.75)}
.eoe-section-head{display:flex;align-items:flex-start;gap:11px;padding:13px 15px 11px;border-bottom:1px solid var(--eoe-line)}
.eoe-section-index{font-family:"Cascadia Code","Consolas",monospace;font-size:10px;color:var(--eoe-amber);padding-top:1px;min-width:21px}
.eoe-section-title-wrap{min-width:0;flex:1 1 auto}
.eoe-section-kicker{font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--eoe-muted);margin-bottom:1px}
.eoe-section-title{font-size:13px;font-weight:600;letter-spacing:.03em;color:var(--eoe-ink)}
.eoe-section-right{flex:0 0 auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.eoe-section-body{padding:14px 15px 15px}
.eoe-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}
.eoe-field-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.eoe-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.eoe-field.wide{grid-column:1/-1}
.eoe-field-label{display:flex;align-items:baseline;gap:6px;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--eoe-muted)}
.eoe-field-label em{font-style:normal;color:var(--eoe-amber);font-family:"Cascadia Code","Consolas",monospace;font-size:8.5px;letter-spacing:0}
.eoe-input,.eoe-select{
  width:100%;height:32px;border:1px solid var(--eoe-line2);border-radius:2px;background:rgba(1,8,10,.38);
  color:var(--eoe-ink);padding:0 9px;outline:none;transition:border-color .15s,background .15s,box-shadow .15s;
}
.eoe-input:hover,.eoe-select:hover{border-color:rgba(155,196,188,.42)}
.eoe-input:focus,.eoe-select:focus{border-color:var(--eoe-amber);box-shadow:0 0 0 2px rgba(242,179,94,.12);background:rgba(1,8,10,.55)}
.eoe-input.mono{font-family:"Cascadia Code","Consolas",monospace;font-size:10.5px;letter-spacing:-.01em}
.eoe-input[disabled],.eoe-select[disabled]{opacity:.55;cursor:not-allowed}
.eoe-input::placeholder{color:rgba(109,133,130,.7)}
.eoe-hint{font-size:9.5px;color:var(--eoe-muted);line-height:1.45;letter-spacing:.01em}
.eoe-hint.warn{color:rgba(242,179,94,.82)}
.eoe-hint.bad{color:rgba(255,115,104,.85)}
.eoe-field-inline{display:flex;gap:6px;align-items:stretch}
.eoe-field-inline .eoe-input{flex:1 1 auto}
.eoe-field-suffix{display:flex;align-items:center;padding:0 8px;border:1px solid var(--eoe-line);border-left:0;border-radius:0 2px 2px 0;color:var(--eoe-muted);font-family:"Cascadia Code","Consolas",monospace;font-size:9px;background:rgba(0,0,0,.16);white-space:nowrap}
.eoe-btn{
  appearance:none;border:1px solid var(--eoe-line2);background:rgba(0,0,0,.16);color:var(--eoe-ink2);
  border-radius:2px;padding:7px 11px;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,border-color .15s,color .15s,transform .15s;white-space:nowrap;
}
.eoe-btn:hover:not([disabled]){background:rgba(155,196,188,.08);border-color:rgba(155,196,188,.5);color:var(--eoe-ink)}
.eoe-btn:active:not([disabled]){transform:translateY(1px)}
.eoe-btn:focus-visible{outline:2px solid var(--eoe-amber);outline-offset:2px}
.eoe-btn[disabled]{opacity:.42;cursor:not-allowed}
.eoe-btn.primary{
  border-color:rgba(242,179,94,.8);color:#1b1206;font-weight:650;
  background:linear-gradient(180deg,#f5c477,#d99239);box-shadow:0 4px 18px rgba(217,146,57,.16),inset 0 1px 0 rgba(255,255,255,.35);
}
.eoe-btn.primary:hover:not([disabled]){background:linear-gradient(180deg,#ffd28e,#e5a147);border-color:#ffd28e;color:#160e04}
.eoe-btn.danger{border-color:rgba(255,115,104,.55);color:#ffb0aa;background:rgba(255,115,104,.06)}
.eoe-btn.danger:hover:not([disabled]){background:rgba(255,115,104,.13);border-color:var(--eoe-red);color:#ffd4d0}
.eoe-btn.big{height:40px;font-size:10.5px;letter-spacing:.14em;width:100%}
.eoe-btn.icon{padding:6px;width:29px;height:29px;letter-spacing:0}
.eoe-btn.ghost{border-color:transparent;background:transparent;padding:5px 7px}
.eoe-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.eoe-actions.end{justify-content:flex-end}
.eoe-tag{
  display:inline-flex;align-items:center;gap:5px;border:1px solid var(--eoe-line2);border-radius:2px;padding:2px 5px;
  font-family:"Cascadia Code","Consolas",monospace;font-size:8px;letter-spacing:.08em;color:var(--eoe-muted);background:rgba(0,0,0,.16);text-transform:uppercase;white-space:nowrap;
}
.eoe-tag.amber{color:var(--eoe-amber);border-color:rgba(242,179,94,.42);background:rgba(242,179,94,.06)}
.eoe-tag.cyan{color:var(--eoe-cyan);border-color:rgba(79,211,198,.38);background:rgba(79,211,198,.05)}
.eoe-tag.red{color:var(--eoe-red);border-color:rgba(255,115,104,.4);background:rgba(255,115,104,.06)}
.eoe-tag.green{color:var(--eoe-lime);border-color:rgba(158,203,134,.36);background:rgba(158,203,134,.05)}
.eoe-toggle-row{display:flex;gap:12px;flex-wrap:wrap}
.eoe-toggle{display:flex;align-items:flex-start;gap:8px;cursor:pointer;min-width:0;flex:1 1 190px;border:1px solid var(--eoe-line);border-radius:2px;padding:9px 10px;background:rgba(0,0,0,.10)}
.eoe-toggle:hover{border-color:var(--eoe-line2);background:rgba(155,196,188,.04)}
.eoe-toggle input{position:absolute;opacity:0;pointer-events:none}
.eoe-switch{width:27px;height:15px;border-radius:10px;border:1px solid var(--eoe-line2);background:rgba(0,0,0,.4);position:relative;flex:0 0 auto;margin-top:1px;transition:background .18s,border-color .18s}
.eoe-switch:after{content:"";position:absolute;width:9px;height:9px;border-radius:50%;left:2px;top:2px;background:var(--eoe-muted);transition:transform .18s,background .18s}
.eoe-toggle input:checked + .eoe-switch{background:rgba(242,179,94,.2);border-color:rgba(242,179,94,.6)}
.eoe-toggle input:checked + .eoe-switch:after{transform:translateX(12px);background:var(--eoe-amber);box-shadow:0 0 8px rgba(242,179,94,.6)}
.eoe-toggle input:focus-visible + .eoe-switch{outline:2px solid var(--eoe-amber);outline-offset:2px}
.eoe-toggle-copy{min-width:0}
.eoe-toggle-title{font-size:10.5px;color:var(--eoe-ink2);letter-spacing:.02em}
.eoe-toggle-desc{font-size:9px;color:var(--eoe-muted);margin-top:2px;line-height:1.45}
.eoe-seg{display:inline-flex;border:1px solid var(--eoe-line2);border-radius:2px;overflow:hidden;background:rgba(0,0,0,.18)}
.eoe-seg button{appearance:none;border:0;border-right:1px solid var(--eoe-line);background:transparent;color:var(--eoe-muted);padding:6px 9px;font-size:9px;letter-spacing:.1em;cursor:pointer;text-transform:uppercase}
.eoe-seg button:last-child{border-right:0}
.eoe-seg button:hover{background:rgba(155,196,188,.07);color:var(--eoe-ink2)}
.eoe-seg button.active{background:rgba(242,179,94,.12);color:var(--eoe-amber);box-shadow:inset 0 0 0 1px rgba(242,179,94,.18)}
.eoe-seg.warn button.active{background:rgba(255,115,104,.12);color:var(--eoe-red)}
.eoe-advanced{border-top:1px dashed var(--eoe-line);margin-top:13px;padding-top:11px}
.eoe-advanced summary{cursor:pointer;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--eoe-muted);outline:none;list-style:none;display:flex;align-items:center;gap:7px}
.eoe-advanced summary::-webkit-details-marker{display:none}
.eoe-advanced summary:hover{color:var(--eoe-ink2)}
.eoe-advanced[open] summary{color:var(--eoe-amber);margin-bottom:11px}
.eoe-advanced .eoe-field-grid{margin-bottom:10px}
.eoe-launch{display:flex;flex-direction:column;gap:9px}
.eoe-launch-main{display:flex;align-items:center;gap:8px}
.eoe-launch-main .eoe-btn.big{flex:1 1 auto}
.eoe-launch-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:9px;color:var(--eoe-muted);letter-spacing:.05em}
.eoe-command{
  border:1px solid var(--eoe-line);border-radius:2px;background:rgba(0,0,0,.3);padding:8px 9px;
  font-family:"Cascadia Code","Consolas",monospace;font-size:9px;line-height:1.55;color:#9bbcaf;
  overflow-wrap:anywhere;max-height:88px;overflow:auto;
}
.eoe-command .eoe-cmd-flag{color:var(--eoe-amber)}
.eoe-preflight-list{display:flex;flex-direction:column;gap:1px}
.eoe-preflight-item{display:grid;grid-template-columns:7px minmax(0,1fr);gap:8px;padding:4px 0;border-bottom:1px solid rgba(155,196,188,.06);align-items:start}
.eoe-preflight-item:last-child{border-bottom:0}
.eoe-preflight-dot{width:5px;height:5px;border-radius:50%;margin-top:4px;background:var(--eoe-lime)}
.eoe-preflight-item.warn .eoe-preflight-dot{background:var(--eoe-amber)}
.eoe-preflight-item.error .eoe-preflight-dot{background:var(--eoe-red)}
.eoe-preflight-item.info .eoe-preflight-dot{background:var(--eoe-cyan)}
.eoe-preflight-label{font-size:9.5px;color:var(--eoe-ink2);line-height:1.35}
.eoe-preflight-detail{font-size:8.5px;color:var(--eoe-muted);font-family:"Cascadia Code","Consolas",monospace;overflow-wrap:anywhere;line-height:1.4;margin-top:1px}
.eoe-deck-card{border:1px solid var(--eoe-line);border-radius:3px;background:rgba(4,12,15,.26);padding:11px 11px 12px;margin-bottom:12px}
.eoe-deck-title{font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--eoe-muted);display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.eoe-deck-title b{color:var(--eoe-ink2);font-weight:500;font-size:8.5px}
.eoe-run-control{display:flex;align-items:center;gap:9px;padding:11px 0 14px;border-bottom:1px solid var(--eoe-line);margin-bottom:14px}
.eoe-run-orb{
  width:38px;height:38px;border-radius:50%;border:1px solid var(--eoe-line2);display:grid;place-items:center;flex:0 0 auto;
  color:var(--eoe-muted);background:radial-gradient(circle at 35% 30%,rgba(155,196,188,.12),rgba(0,0,0,.2));
}
.eoe-run-orb.running{color:var(--eoe-amber);border-color:rgba(242,179,94,.6);box-shadow:0 0 0 5px rgba(242,179,94,.06),0 0 22px rgba(242,179,94,.15);animation:eoe-breathe 2s ease-in-out infinite}
.eoe-run-orb.ok{color:var(--eoe-lime);border-color:rgba(158,203,134,.45)}
.eoe-run-orb.bad{color:var(--eoe-red);border-color:rgba(255,115,104,.45)}
.eoe-run-orb-copy{min-width:0;flex:1 1 auto}
.eoe-run-orb-title{font-size:11px;color:var(--eoe-ink);letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-run-orb-sub{font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--eoe-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-progress{height:3px;background:rgba(155,196,188,.1);border-radius:3px;overflow:hidden;margin:9px 0 6px;position:relative}
.eoe-progress-bar{height:100%;background:linear-gradient(90deg,var(--eoe-cyan2),var(--eoe-amber));width:0;transition:width .45s ease;position:relative;overflow:hidden}
.eoe-progress-bar:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-100%);animation:eoe-scan 1.8s linear infinite}
.eoe-run-meta{display:flex;flex-direction:column;gap:4px;font-size:9px;color:var(--eoe-muted)}
.eoe-kv{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.eoe-kv b{color:var(--eoe-ink2);font-weight:500;text-align:right;overflow-wrap:anywhere}
.eoe-kv span{flex:0 0 auto}
.eoe-console-toolbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px 11px;border-bottom:1px solid var(--eoe-line);background:rgba(0,0,0,.16)}
.eoe-console-toolbar .eoe-seg button{padding:4px 7px;font-size:8px}
.eoe-console-toolbar .eoe-input{height:25px;font-size:9px;width:150px;padding:0 7px}
.eoe-console-toolbar .eoe-btn{height:25px;padding:4px 7px;font-size:8px}
.eoe-console{
  margin:0;padding:10px 12px;max-height:420px;min-height:170px;overflow:auto;background:#050c0f;
  font-family:"Cascadia Code","Consolas",monospace;font-size:10px;line-height:1.65;color:#a8c4bc;white-space:pre-wrap;word-break:break-word;
}
.eoe-console .eoe-line{display:block}
.eoe-console .eoe-line-no{color:#3e5a57;user-select:none;display:inline-block;width:34px;text-align:right;margin-right:10px}
.eoe-console .eoe-line-text{white-space:pre-wrap}
.eoe-empty{
  padding:35px 22px;border:1px dashed var(--eoe-line2);border-radius:3px;text-align:center;background:rgba(255,255,255,.012);
  display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--eoe-muted);
}
.eoe-empty-icon{width:42px;height:42px;border:1px solid var(--eoe-line2);display:grid;place-items:center;color:var(--eoe-amber);border-radius:50%;margin-bottom:3px}
.eoe-empty h3{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--eoe-ink2);margin:0;font-weight:600}
.eoe-empty p{max-width:440px;margin:0;font-size:10.5px;line-height:1.7;color:var(--eoe-muted)}
.eoe-metric-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:0 0 14px}
.eoe-metric{border:1px solid var(--eoe-line);background:linear-gradient(160deg,rgba(16,31,37,.66),rgba(8,18,22,.42));padding:10px 10px 9px;border-radius:2px;min-width:0}
.eoe-metric-label{font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:var(--eoe-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-metric-value{font-family:"Cascadia Code","Consolas",monospace;font-size:15px;color:var(--eoe-ink);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-metric-value small{font-size:9px;color:var(--eoe-muted);margin-left:2px}
.eoe-metric-value.amber{color:var(--eoe-amber)}
.eoe-metric-value.cyan{color:var(--eoe-cyan)}
.eoe-metric-value.red{color:var(--eoe-red)}
.eoe-metric-sub{font-size:8.5px;color:var(--eoe-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eoe-analyze-top{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap}
.eoe-analyze-title{font-size:17px;letter-spacing:.05em;font-weight:600;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.eoe-analyze-title small{font-family:"Cascadia Code","Consolas",monospace;font-size:9px;color:var(--eoe-muted);letter-spacing:0}
.eoe-analyze-sub{font-size:10px;color:var(--eoe-muted);margin-top:3px}
.eoe-analyze-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.8fr);gap:14px;align-items:start}
.eoe-eye-card{border:1px solid var(--eoe-line);border-radius:3px;background:rgba(4,12,15,.38);overflow:hidden}
.eoe-eye-head{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;padding:11px 12px;border-bottom:1px solid var(--eoe-line);flex-wrap:wrap}
.eoe-eye-title{font-size:11px;letter-spacing:.08em;color:var(--eoe-ink2);display:flex;align-items:center;gap:7px}
.eoe-eye-title b{font-family:"Cascadia Code","Consolas",monospace;color:var(--eoe-amber);font-weight:500;font-size:9px}
.eoe-eye-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.eoe-eye-select{height:25px;max-width:210px;font-size:9px;padding:0 5px}
.eoe-eye-canvas-wrap{position:relative;height:360px;min-height:280px;background:#061014;border-bottom:1px solid var(--eoe-line)}
.eoe-eye-canvas-wrap canvas{display:block;width:100%;height:100%}
.eoe-eye-legend{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;font-size:8px;letter-spacing:.11em;color:var(--eoe-muted);text-transform:uppercase;flex-wrap:wrap}
.eoe-legend-gradient{height:5px;width:120px;background:linear-gradient(90deg,#0d2830,#1b8f8a,#51d6c9,#f2b35e,#fff7e1);border-radius:4px}
.eoe-verdict-list{display:flex;flex-direction:column;gap:7px}
.eoe-verdict{border:1px solid var(--eoe-line);border-left:2px solid var(--eoe-muted);border-radius:2px;padding:8px 9px;background:rgba(0,0,0,.12)}
.eoe-verdict.ok{border-left-color:var(--eoe-lime)}
.eoe-verdict.fail{border-left-color:var(--eoe-red)}
.eoe-verdict.skip{border-left-color:var(--eoe-muted);opacity:.7}
.eoe-verdict-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px}
.eoe-verdict-name{font-size:10px;color:var(--eoe-ink2);letter-spacing:.03em}
.eoe-verdict-detail{font-size:9px;line-height:1.55;color:var(--eoe-muted);font-family:"Cascadia Code","Consolas",monospace;overflow-wrap:anywhere}
.eoe-tdecq{border:1px solid rgba(242,179,94,.3);border-radius:2px;padding:11px;background:rgba(242,179,94,.04);margin-bottom:12px}
.eoe-tdecq-value{font-family:"Cascadia Code","Consolas",monospace;font-size:25px;color:var(--eoe-amber);line-height:1.1}
.eoe-tdecq-value small{font-size:9px;color:var(--eoe-muted);margin-left:3px}
.eoe-tdecq-note{font-size:9px;line-height:1.55;color:var(--eoe-muted);margin-top:6px}
.eoe-artifact-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.eoe-artifact-toolbar .eoe-input{height:28px;font-size:10px;max-width:220px}
.eoe-artifact-toolbar .eoe-select{height:28px;font-size:9px;width:auto}
.eoe-artifact-table{width:100%;border-collapse:collapse;font-size:10px}
.eoe-artifact-table th{font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--eoe-muted);font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid var(--eoe-line2);position:sticky;top:0;background:rgba(7,16,20,.96)}
.eoe-artifact-table td{padding:6px 8px;border-bottom:1px solid rgba(155,196,188,.07);color:var(--eoe-ink2);vertical-align:middle}
.eoe-artifact-row{cursor:pointer}
.eoe-artifact-row:hover td{background:rgba(155,196,188,.045);color:var(--eoe-ink)}
.eoe-artifact-name{font-family:"Cascadia Code","Consolas",monospace;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px}
.eoe-artifact-kind{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:var(--eoe-muted)}
.eoe-artifact-size{font-family:"Cascadia Code","Consolas",monospace;font-size:9px;color:var(--eoe-muted);white-space:nowrap}
.eoe-artifact-actions{text-align:right;white-space:nowrap}
.eoe-link-btn{appearance:none;border:0;background:transparent;color:var(--eoe-cyan);cursor:pointer;font-size:9px;padding:2px 4px;text-decoration:none}
.eoe-link-btn:hover{color:var(--eoe-amber);text-decoration:underline}
.eoe-link-btn[disabled]{color:var(--eoe-muted);cursor:not-allowed;text-decoration:none}
.eoe-note{border:1px solid rgba(242,179,94,.22);background:rgba(242,179,94,.035);padding:8px 10px;border-radius:2px;font-size:9.5px;line-height:1.6;color:var(--eoe-muted)}
.eoe-note b{color:var(--eoe-amber);font-weight:500}
.eoe-warn{border-color:rgba(255,115,104,.3);background:rgba(255,115,104,.045)}
.eoe-warn b{color:var(--eoe-red)}
.eoe-toast{
  position:fixed;right:18px;bottom:18px;z-index:2147483000;max-width:420px;border:1px solid var(--eoe-line2);
  background:#0d1c21;color:var(--eoe-ink);padding:10px 12px;border-radius:3px;box-shadow:0 18px 60px rgba(0,0,0,.5);
  font-size:10.5px;line-height:1.55;display:flex;align-items:flex-start;gap:9px;animation:eoe-toast-in .22s ease-out both;
}
.eoe-toast.error{border-color:rgba(255,115,104,.5);background:#211113}
.eoe-toast.ok{border-color:rgba(158,203,134,.45)}
.eoe-toast-dot{width:6px;height:6px;border-radius:50%;background:var(--eoe-amber);margin-top:5px;flex:0 0 auto}
.eoe-toast.ok .eoe-toast-dot{background:var(--eoe-lime)}
.eoe-toast.error .eoe-toast-dot{background:var(--eoe-red)}
.eoe-modal-overlay{
  position:fixed;inset:0;z-index:2147483000;background:rgba(2,8,10,.74);backdrop-filter:blur(5px);
  display:flex;align-items:center;justify-content:center;padding:28px;animation:eoe-fade-in .15s ease-out both;
}
.eoe-modal{
  width:min(960px,94vw);max-height:88vh;display:flex;flex-direction:column;border:1px solid var(--eoe-line2);
  background:#0a171c;box-shadow:0 30px 100px rgba(0,0,0,.65);border-radius:3px;overflow:hidden;
}
.eoe-modal-head{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-bottom:1px solid var(--eoe-line);background:rgba(0,0,0,.18)}
.eoe-modal-title{font-size:11px;color:var(--eoe-ink);letter-spacing:.05em;min-width:0;flex:1 1 auto}
.eoe-modal-path{font-family:"Cascadia Code","Consolas",monospace;font-size:8.5px;color:var(--eoe-muted);margin-top:3px;overflow-wrap:anywhere}
.eoe-modal-body{overflow:auto;padding:0;min-height:120px;background:#050c0f}
.eoe-modal-body img{display:block;max-width:100%;margin:0 auto;background:#fff}
.eoe-modal-body pre{margin:0;padding:13px;font-family:"Cascadia Code","Consolas",monospace;font-size:10px;line-height:1.55;color:#b6d0c8;white-space:pre-wrap;overflow-wrap:anywhere}
.eoe-modal-foot{padding:7px 14px;border-top:1px solid var(--eoe-line);display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:9px;color:var(--eoe-muted)}
.eoe-loading{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;color:var(--eoe-muted);letter-spacing:.12em;font-size:10px;text-transform:uppercase}
.eoe-loader{width:28px;height:28px;border:1px solid rgba(155,196,188,.2);border-top-color:var(--eoe-amber);border-radius:50%;animation:eoe-spin 1s linear infinite}
.eoe-error-screen{flex:1;display:flex;align-items:center;justify-content:center;padding:30px}
.eoe-error-card{max-width:620px;border:1px solid rgba(255,115,104,.3);background:rgba(255,115,104,.035);padding:26px;border-radius:3px}
.eoe-error-kicker{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--eoe-red);margin-bottom:8px}
.eoe-error-card h2{font-size:19px;margin:0 0 8px;font-weight:600;letter-spacing:.04em}
.eoe-error-card p{font-size:11px;line-height:1.7;color:var(--eoe-muted);margin:0 0 13px}
.eoe-error-card pre{font-family:"Cascadia Code","Consolas",monospace;font-size:9.5px;line-height:1.55;color:#d7a29d;background:rgba(0,0,0,.24);padding:9px;border:1px solid rgba(255,115,104,.16);max-height:170px;overflow:auto;white-space:pre-wrap;margin:0 0 14px}
@keyframes eoe-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}
@keyframes eoe-breathe{0%,100%{box-shadow:0 0 0 4px rgba(242,179,94,.05),0 0 16px rgba(242,179,94,.12)}50%{box-shadow:0 0 0 7px rgba(242,179,94,.08),0 0 28px rgba(242,179,94,.22)}}
@keyframes eoe-scan{to{transform:translateX(100%)}}
@keyframes eoe-spin{to{transform:rotate(360deg)}}
@keyframes eoe-reveal{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes eoe-fade-in{from{opacity:0}to{opacity:1}}
@keyframes eoe-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (max-width:1280px){
  .eoe-work{grid-template-columns:216px minmax(0,1fr)}
  .eoe-deck{display:none}
  .eoe-metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .eoe-brand{min-width:235px}
}
@media (max-width:920px){
  .eoe-top{padding:12px 14px;gap:10px;flex-wrap:wrap}
  .eoe-top-mid{order:3;width:100%;justify-content:flex-start;overflow:auto;padding-top:2px}
  .eoe-brand{min-width:0;flex:1 1 auto}
  .eoe-brand-sub{display:none}
  .eoe-work{grid-template-columns:1fr}
  .eoe-rail{display:none}
  .eoe-status-strip{padding:7px 14px;gap:8px}
  .eoe-view{padding:14px 14px 0}
  .eoe-tabs{padding:0 14px}
  .eoe-field-grid,.eoe-field-grid.three{grid-template-columns:1fr}
  .eoe-analyze-layout{grid-template-columns:1fr}
  .eoe-eye-canvas-wrap{height:300px}
  .eoe-metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:520px){
  .eoe-brand-name{font-size:15px}
  .eoe-brand-tag{display:none}
  .eoe-top-actions .eoe-btn.primary{padding:7px 9px;font-size:9px}
  .eoe-top-actions .eoe-btn:not(.primary){display:none}
  .eoe-metric-grid{grid-template-columns:1fr 1fr}
  .eoe-eye-canvas-wrap{height:240px}
}
@media (prefers-reduced-motion:reduce){
  .eoe-root *,.eoe-root *:before,.eoe-root *:after{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important}
}
`;
      document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Icons
    // ---------------------------------------------------------------------

    const ICON_PATHS = {
      play: ["M8 5.5v13l10.5-6.5z"],
      stop: ["M7 7h10v10H7z"],
      refresh: ["M20 6v5h-5", "M4 18v-5h5", "M6.1 9a7 7 0 0 1 11.4-2.6L20 11", "M4 13l2.5 4.6A7 7 0 0 0 18 15"],
      terminal: ["M4 5h16v14H4z", "m7 9 3 3-3 3", "M13 15h4"],
      chart: ["M4 19V5", "M4 19h16", "m7 15 3-4 3 2 4-6"],
      eye: ["M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z"],
      settings: ["M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z", "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-3h.1A1.7 1.7 0 0 0 4.65 9.9a1.7 1.7 0 0 0-.34-1.88L4.25 7.96l2.1-2.1.06.06A1.7 1.7 0 0 0 8.3 6.26 1.7 1.7 0 0 0 9.33 4.7V4.6h3v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 18.56 11H19v3h-.1A1.7 1.7 0 0 0 19.4 15z"],
      folder: ["M3.5 6.5h6l2 2h9v10h-17z"],
      copy: ["M8 8h11v11H8z", "M5 16H4V4h11v1"],
      download: ["M12 3v11", "m8 10 4 4 4-4", "M4 18h16v3H4z"],
      close: ["M6 6l12 12", "M18 6 6 18"],
      chevron: ["m8 10 4 4 4-4"],
      check: ["m4 12 5 5L20 6"],
      alert: ["M12 3 2.8 20h18.4z", "M12 9v5", "M12 17.2v.1"],
      clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"],
      wave: ["M2 12h3l2-5 3 10 3-12 3 9 2-4h4"],
      cpu: ["M7 7h10v10H7z", "M9 3v4", "M15 3v4", "M9 17v4", "M15 17v4", "M3 9h4", "M3 15h4", "M17 9h4", "M17 15h4"],
      database: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
      arrow: ["M5 12h14", "m14 7 5 5-5 5"]
    };

    function Icon(props) {
      const name = props.name || "wave";
      const size = props.size || 16;
      const paths = ICON_PATHS[name] || ICON_PATHS.wave;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: props.strokeWidth || 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false"
        },
        paths.map((d, index) =>
          h("path", {
            key: index,
            d,
            fill: name === "play" && index === 0 ? "currentColor" : "none"
          })
        )
      );
    }

    function BrandMark() {
      return h(
        "svg",
        { viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: 1.3, "aria-hidden": "true" },
        h("circle", { cx: 16, cy: 16, r: 12.4, opacity: 0.45 }),
        h("circle", { cx: 16, cy: 16, r: 6.7, opacity: 0.8 }),
        h("path", { d: "M2.5 16h5l2.3-5 3.5 10 3.2-13 3.1 11 2.1-3h5.8" }),
        h("circle", { cx: 27.5, cy: 16, r: 1.2, fill: "currentColor", stroke: "none" })
      );
    }

    // ---------------------------------------------------------------------
    // Small presentational primitives
    // ---------------------------------------------------------------------

    function Btn(props) {
      return h(
        "button",
        {
          type: "button",
          className: cx("eoe-btn", props.variant, props.size === "big" ? "big" : "", props.className),
          onClick: props.onClick,
          disabled: props.disabled,
          title: props.title,
          "aria-label": props.ariaLabel || props.title || undefined
        },
        props.icon ? h(Icon, { name: props.icon, size: props.iconSize || 13 }) : null,
        props.children
      );
    }

    function Tag(props) {
      return h("span", { className: cx("eoe-tag", props.tone) }, props.children);
    }

    function Field(props) {
      return h(
        "label",
        { className: cx("eoe-field", props.wide ? "wide" : "") },
        h(
          "span",
          { className: "eoe-field-label" },
          props.label,
          props.unit ? h("em", null, props.unit) : null
        ),
        props.children,
        props.hint ? h("span", { className: cx("eoe-hint", props.hintTone) }, props.hint) : null
      );
    }

    function TextInput(props) {
      return h("input", {
        className: cx("eoe-input", props.mono ? "mono" : "", props.className),
        type: props.type || "text",
        value: props.value ?? "",
        onChange: (event) => props.onChange?.(event.target.value, event),
        placeholder: props.placeholder,
        disabled: props.disabled,
        spellCheck: false,
        autoComplete: "off",
        min: props.min,
        max: props.max,
        step: props.step,
        "aria-label": props.ariaLabel
      });
    }

    function NumberInput(props) {
      return h(TextInput, {
        ...props,
        type: "number",
        mono: true,
        onChange: (value) => props.onChange?.(value === "" ? "" : Number(value))
      });
    }

    function Select(props) {
      return h(
        "select",
        {
          className: cx("eoe-select", props.className),
          value: props.value ?? "",
          onChange: (event) => props.onChange?.(event.target.value),
          disabled: props.disabled,
          "aria-label": props.ariaLabel
        },
        (props.options || []).map((option) =>
          h(
            "option",
            { key: option.value, value: option.value },
            option.label
          )
        )
      );
    }

    function Toggle(props) {
      return h(
        "label",
        { className: "eoe-toggle", title: props.title },
        h("input", {
          type: "checkbox",
          checked: Boolean(props.checked),
          onChange: (event) => props.onChange?.(event.target.checked),
          disabled: props.disabled
        }),
        h("span", { className: "eoe-switch", "aria-hidden": "true" }),
        h(
          "span",
          { className: "eoe-toggle-copy" },
          h("span", { className: "eoe-toggle-title" }, props.label),
          props.description ? h("span", { className: "eoe-toggle-desc" }, props.description) : null
        )
      );
    }

    function Segmented(props) {
      return h(
        "div",
        { className: cx("eoe-seg", props.warn ? "warn" : "") },
        (props.options || []).map((option) =>
          h(
            "button",
            {
              key: option.value,
              type: "button",
              className: props.value === option.value ? "active" : "",
              onClick: () => props.onChange?.(option.value),
              disabled: props.disabled,
              title: option.title
            },
            option.label
          )
        )
      );
    }

    function Section(props) {
      return h(
        "section",
        { className: cx("eoe-section", props.className) },
        h(
          "div",
          { className: "eoe-section-head" },
          h("span", { className: "eoe-section-index" }, props.index || "—"),
          h(
            "div",
            { className: "eoe-section-title-wrap" },
            props.kicker ? h("div", { className: "eoe-section-kicker" }, props.kicker) : null,
            h("div", { className: "eoe-section-title" }, props.title)
          ),
          props.right ? h("div", { className: "eoe-section-right" }, props.right) : null
        ),
        h("div", { className: "eoe-section-body" }, props.children)
      );
    }

    function Led(props) {
      return h("span", { className: cx("eoe-led", props.status) });
    }

    // ---------------------------------------------------------------------
    // Derived model helpers
    // ---------------------------------------------------------------------

    function phaseState(summary, runningPhase, number, fromPhase) {
      if (fromPhase > number) return "skip";
      if (runningPhase === number) return "active";
      if (summary?.phases?.[number]) {
        const phase = summary.phases[number];
        if (phase.skipped) return "skip";
        if (phase.ok === true) return "done";
        if (phase.ok === false) return "fail";
      }
      if (runningPhase > number) return "done";
      return "idle";
    }

    function phaseLabel(state) {
      return (
        {
          active: "RUNNING",
          done: "PASS",
          fail: "FAIL",
          skip: "SKIP",
          idle: "READY"
        }[state] || "READY"
      );
    }

    function overallStatus(jobState, summary, selectedRun) {
      if (jobState?.running) return { key: "running", label: "RUNNING", led: "running" };
      const job = jobState?.job;
      // When browsing an older run, the selected summary wins over a stale job
      // record left by an earlier failed attempt.
      if (summary && (!job || selectedRun !== job.runDir)) {
        return summary.ok
          ? { key: "ok", label: "PASS", led: "ok" }
          : { key: "fail", label: "FAILED", led: "error" };
      }
      if (job?.status === "succeeded") return { key: "ok", label: "COMPLETE", led: "ok" };
      if (job?.status === "failed") return { key: "fail", label: "FAILED", led: "error" };
      if (job?.status === "cancelled") return { key: "cancelled", label: "CANCELLED", led: "error" };
      if (job?.status === "lost") return { key: "lost", label: "LOST", led: "error" };
      if (summary) return summary.ok ? { key: "ok", label: "PASS", led: "ok" } : { key: "fail", label: "FAILED", led: "error" };
      return { key: "idle", label: "IDLE", led: "" };
    }

    function elapsedMs(job, now) {
      if (!job?.startedAt) return 0;
      const start = new Date(job.startedAt).getTime();
      const end = job.endedAt ? new Date(job.endedAt).getTime() : now;
      return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
    }

    function defaultRunDir(settings) {
      return settings?.runDir?.trim() || "";
    }

    // ---------------------------------------------------------------------
    // Main page
    // ---------------------------------------------------------------------

    function WorkbenchPage() {
      const [loading, setLoading] = useState(true);
      const [loadError, setLoadError] = useState(null);
      const [config, setConfig] = useState(null);
      const [initialConfig, setInitialConfig] = useState(null);
      const [configMeta, setConfigMeta] = useState(null);
      const [settings, setSettings] = useState({
        fromPhase: 1,
        short: false,
        noTdecq: false,
        runDir: ""
      });
      const [preflight, setPreflight] = useState(null);
      const [preflightError, setPreflightError] = useState(null);
      const [jobState, setJobState] = useState(null);
      const [runs, setRuns] = useState([]);
      const [selectedRun, setSelectedRun] = useState(null);
      const [summary, setSummary] = useState(null);
      const [artifacts, setArtifacts] = useState([]);
      const [historicalLog, setHistoricalLog] = useState("");
      const [selectedEye, setSelectedEye] = useState(null);
      const [eyeData, setEyeData] = useState(null);
      const [eyeLoading, setEyeLoading] = useState(false);
      const [eyeError, setEyeError] = useState(null);
      const [tab, setTab] = useState("setup");
      const [busy, setBusy] = useState(false);
      const [toast, setToast] = useState(null);
      const [cancelArmed, setCancelArmed] = useState(false);
      const [now, setNow] = useState(Date.now());
      const [logSource, setLogSource] = useState("run");
      const [logFollow, setLogFollow] = useState(true);
      const [logFilter, setLogFilter] = useState("");
      const [preview, setPreview] = useState(null);
      const [previewLoading, setPreviewLoading] = useState(false);
      const [artifactQuery, setArtifactQuery] = useState("");
      const [artifactKind, setArtifactKind] = useState("all");
      const [eyeScale, setEyeScale] = useState("log");

      const selectedRunRef = useRef(null);
      const loadRunRef = useRef(null);
      const lastRunningRef = useRef(false);

      const notify = useCallback((message, tone = "info") => {
        setToast({ message, tone });
      }, []);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 4600);
        return () => clearTimeout(timer);
      }, [toast]);

      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, []);

      useEffect(() => {
        if (!cancelArmed) return undefined;
        const timer = setTimeout(() => setCancelArmed(false), 4500);
        return () => clearTimeout(timer);
      }, [cancelArmed]);

      const loadRun = useCallback(async (runDir) => {
        if (!runDir) return;
        selectedRunRef.current = runDir;
        setSelectedRun(runDir);
        try {
          const [summaryPayload, artifactPayload, logPayload] = await Promise.all([
            api("/summary?runDir=" + encodeURIComponent(runDir)),
            api("/artifacts?runDir=" + encodeURIComponent(runDir)),
            api("/run-log?runDir=" + encodeURIComponent(runDir) + "&tail=700")
          ]);
          setSummary(summaryPayload.summary || null);
          setArtifacts(Array.isArray(artifactPayload.artifacts) ? artifactPayload.artifacts : []);
          setHistoricalLog(typeof logPayload.tail === "string" ? logPayload.tail : "");
          const firstEye = summaryPayload.summary?.eyeCsvs?.[0]?.path || null;
          setSelectedEye((current) => {
            const exists = summaryPayload.summary?.eyeCsvs?.some((eye) => eye.path === current);
            return exists ? current : firstEye;
          });
        } catch (error) {
          if (error?.status !== 404) {
            notify("读取运行结果失败: " + String(error?.message || error), "error");
          }
          setSummary(null);
          setArtifacts([]);
          setHistoricalLog("");
        }
      }, [notify]);
      loadRunRef.current = loadRun;

      const loadRuns = useCallback(async () => {
        try {
          const payload = await api("/runs?limit=12");
          const next = Array.isArray(payload.runs) ? payload.runs : [];
          setRuns(next);
          return next;
        } catch {
          return [];
        }
      }, []);

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const [configPayload, runPayload, statusPayload] = await Promise.all([
              api("/config"),
              api("/runs?limit=12"),
              api("/status")
            ]);
            if (cancelled) return;
            setConfig(configPayload.config);
            setInitialConfig(clone(configPayload.config));
            setConfigMeta({
              path: configPayload.path,
              mtime: configPayload.mtime,
              size: configPayload.size
            });
            setRuns(Array.isArray(runPayload.runs) ? runPayload.runs : []);
            setJobState(statusPayload);
            lastRunningRef.current = Boolean(statusPayload.running);
            const targetRun = statusPayload.running
              ? statusPayload.job?.runDir || null
              : statusPayload.summary?.runDir ||
                (Array.isArray(runPayload.runs) && runPayload.runs[0]?.path) ||
                statusPayload.job?.runDir ||
                null;
            if (targetRun) {
              selectedRunRef.current = targetRun;
              setSelectedRun(targetRun);
              await loadRun(targetRun);
            }
            setLoading(false);
          } catch (error) {
            if (cancelled) return;
            setLoadError(String(error?.message || error));
            setLoading(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [loadRun]);

      // A single polling loop: fast while a run is active, slow while idle.
      useEffect(() => {
        let cancelled = false;
        let timer = null;
        const tick = async () => {
          try {
            const statusPayload = await api("/status");
            if (cancelled) return;
            setJobState(statusPayload);
            const wasRunning = lastRunningRef.current;
            lastRunningRef.current = Boolean(statusPayload.running);
            if (wasRunning && !statusPayload.running) {
              const finishedDir = statusPayload.job?.runDir;
              if (finishedDir) {
                await loadRunRef.current?.(finishedDir);
                // A crash before summary.json has nothing to analyze; keep the
                // console in front of the user instead of an empty results tab.
                setTab(statusPayload.summary ? "analyze" : "run");
              }
              const outcome = statusPayload.job?.status;
              if (outcome === "succeeded") notify("运行完成，结果已载入", "ok");
              else if (outcome === "cancelled") notify("运行已取消", "info");
              else if (outcome === "failed") notify("运行失败，打开日志查看原因", "error");
              loadRuns();
            }
            timer = setTimeout(tick, statusPayload.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
          } catch (error) {
            if (cancelled) return;
            timer = setTimeout(tick, 6000);
          }
        };
        tick();
        return () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
        };
      }, [loadRuns, notify]);

      // Preflight is debounced so editing a field does not hammer the host.
      useEffect(() => {
        if (!config) return undefined;
        let cancelled = false;
        const timer = setTimeout(async () => {
          try {
            const payload = await api("/preflight", {
              method: "POST",
              body: JSON.stringify({ config, flags: settings })
            });
            if (!cancelled) {
              setPreflight(payload);
              setPreflightError(null);
            }
          } catch (error) {
            if (!cancelled) {
              setPreflight(null);
              setPreflightError(String(error?.message || error));
            }
          }
        }, 420);
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, [config, settings.fromPhase, settings.short, settings.noTdecq, settings.runDir]);

      // Eye data follows the selected CSV and the selected run.
      useEffect(() => {
        if (!selectedEye || !selectedRun) {
          setEyeData(null);
          setEyeError(null);
          setEyeLoading(false);
          return undefined;
        }
        let cancelled = false;
        setEyeLoading(true);
        setEyeError(null);
        const baud = Number(summary?.baudHz) || 0;
        api(
          "/eye?runDir=" +
            encodeURIComponent(selectedRun) +
            "&path=" +
            encodeURIComponent(selectedEye) +
            "&baud_hz=" +
            encodeURIComponent(String(baud))
        )
          .then((payload) => {
            if (!cancelled) {
              setEyeData(payload);
              setEyeLoading(false);
            }
          })
          .catch((error) => {
            if (!cancelled) {
              setEyeData(null);
              setEyeError(String(error?.message || error));
              setEyeLoading(false);
            }
          });
        return () => {
          cancelled = true;
        };
      }, [selectedEye, selectedRun, summary?.baudHz]);

      const updateConfig = useCallback((path, value) => {
        setConfig((current) => setIn(current || {}, path, value));
      }, []);

      const updateBitrate = useCallback((value) => {
        setConfig((current) => {
          if (!current) return current;
          const next = setIn(current, "link.bitrate_gbps", value);
          const oldBitrate = Number(current.link?.bitrate_gbps);
          const oldBaud = Number(current.link?.baud_hz);
          const numberValue = Number(value);
          const baudWasSynced =
            Number.isFinite(oldBitrate) &&
            Number.isFinite(oldBaud) &&
            Math.abs(oldBaud - (oldBitrate * 1e9) / 2) < 1e6;
          return baudWasSynced && Number.isFinite(numberValue)
            ? setIn(next, "link.baud_hz", numberValue * 1e9)
            : next;
        });
      }, []);

      const doPreflight = useCallback(async () => {
        if (!config) return null;
        try {
          const payload = await api("/preflight", {
            method: "POST",
            body: JSON.stringify({ config, flags: settings })
          });
          setPreflight(payload);
          setPreflightError(null);
          return payload;
        } catch (error) {
          setPreflightError(String(error?.message || error));
          return null;
        }
      }, [config, settings]);

      const startRun = useCallback(async () => {
        if (!config || busy || jobState?.running) return;
        setBusy(true);
        try {
          const payload = await api("/run", {
            method: "POST",
            body: JSON.stringify({
              config,
              flags: {
                fromPhase: settings.fromPhase,
                short: settings.short,
                noTdecq: settings.noTdecq,
                runDir: settings.runDir.trim()
              }
            })
          });
          if (payload.ok) {
            setJobState(payload);
            lastRunningRef.current = true;
            setSelectedRun(payload.job?.runDir || null);
            selectedRunRef.current = payload.job?.runDir || null;
            setSummary(null);
            setArtifacts([]);
            setTab("run");
            setLogFollow(true);
            notify(
              settings.short
                ? "短冒烟已启动（PHASE3 将跳过）"
                : "完整链路已启动 · PHASE1 → PHASE2 → PHASE3",
              "ok"
            );
          }
        } catch (error) {
          const payload = error?.payload;
          if (payload?.checks) setPreflight(payload.checks);
          if (payload?.validation) {
            notify("配置校验失败: " + String(payload.error || error.message), "error");
          } else {
            notify(String(error?.message || error), "error");
          }
          setTab("setup");
        } finally {
          setBusy(false);
        }
      }, [busy, config, jobState?.running, notify, settings]);

      const cancelRun = useCallback(async () => {
        if (!jobState?.running) return;
        if (!cancelArmed) {
          setCancelArmed(true);
          return;
        }
        setBusy(true);
        try {
          const payload = await api("/cancel", { method: "POST" });
          notify("已发送取消请求 · pid " + String(payload.pid ?? ""), "info");
          const statusPayload = await api("/status");
          setJobState(statusPayload);
          setCancelArmed(false);
        } catch (error) {
          notify("取消失败: " + String(error?.message || error), "error");
          setCancelArmed(false);
        } finally {
          setBusy(false);
        }
      }, [cancelArmed, jobState?.running, notify]);

      const saveSnapshot = useCallback(async () => {
        if (!config) return;
        setBusy(true);
        try {
          const payload = await api("/config/save", {
            method: "POST",
            body: JSON.stringify({ config, target: "snapshot" })
          });
          notify("配置快照已保存: " + shortPath(payload.path, 60), "ok");
        } catch (error) {
          notify("保存失败: " + String(error?.message || error), "error");
        } finally {
          setBusy(false);
        }
      }, [config, notify]);

      const overwriteDefault = useCallback(async () => {
        if (!config) return;
        const confirmed =
          typeof window.confirm === "function"
            ? window.confirm(
                "写回工作台默认 config.yaml？\\n\\n将先创建 .bak-eoe-<时间戳> 备份，再写入当前表单。"
              )
            : false;
        if (!confirmed) return;
        setBusy(true);
        try {
          const payload = await api("/config/save", {
            method: "POST",
            body: JSON.stringify({ config, target: "default", confirmOverwriteDefault: true })
          });
          notify(
            payload.backup
              ? "默认配置已写回，备份: " + shortPath(payload.backup, 50)
              : "默认配置已写回",
            "ok"
          );
        } catch (error) {
          notify("写回失败: " + String(error?.message || error), "error");
        } finally {
          setBusy(false);
        }
      }, [config, notify]);

      const restoreDefaults = useCallback(() => {
        if (!initialConfig) return;
        setConfig(clone(initialConfig));
        notify("已恢复为本次载入的 config.yaml 值（尚未写盘）", "info");
      }, [initialConfig, notify]);

      const copyCommand = useCallback(async () => {
        if (!preflight?.command?.preview) return;
        const copied = await copyText(preflight.command.preview);
        notify(copied ? "命令已复制" : "复制失败，请手动选择命令", copied ? "ok" : "error");
      }, [notify, preflight]);

      const openPreview = useCallback(async (artifact) => {
        if (!artifact) return;
        const url = fileUrl(artifact, selectedRun);
        const base = { artifact, url };
        if (artifact.kind === "image") {
          setPreview({ ...base, mode: "image" });
          return;
        }
        if (artifact.kind === "dataset") {
          setPreview({
            ...base,
            mode: "meta",
            text:
              "ADS dataset（.ds）是二进制结果包，不在浏览器内解析。\\n\\n文件: " +
              artifact.path +
              "\\n大小: " +
              fmtBytes(artifact.size) +
              "\\n\\n原始数据请到结果目录查看，或使用 ADS Data Display / DSDump。"
          });
          return;
        }
        if (artifact.size > 2.5 * 1024 * 1024) {
          setPreview({
            ...base,
            mode: "meta",
            text:
              "文件超过 2.5 MB 的浏览器预览上限。\\n\\n文件: " +
              artifact.path +
              "\\n大小: " +
              fmtBytes(artifact.size) +
              "\\n\\n请在结果目录中查看。"
          });
          return;
        }
        setPreviewLoading(true);
        setPreview({ ...base, mode: "text", text: "读取中…" });
        try {
          const response = await fetch(url, { cache: "no-store" });
          const text = await response.text();
          if (!response.ok) {
            let message = text;
            try {
              const parsed = JSON.parse(text);
              message = parsed.error || text;
            } catch {}
            throw new Error(message || "HTTP " + String(response.status));
          }
          setPreview({ ...base, mode: "text", text: text.slice(0, 300000) });
        } catch (error) {
          setPreview({ ...base, mode: "meta", text: "无法读取文件: " + String(error?.message || error) });
        } finally {
          setPreviewLoading(false);
        }
      }, [selectedRun]);

      useEffect(() => {
        if (!preview) return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") setPreview(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [preview]);

      const dirty = Boolean(config && initialConfig && JSON.stringify(config) !== JSON.stringify(initialConfig));
      const status = overallStatus(jobState, summary, selectedRun);
      const runningPhase = jobState?.running ? Number(jobState?.progress?.phase) || 0 : 0;
      const bootTitle = settings.short ? "运行短冒烟" : "一键运行完整链路";

      if (loading) {
        return h(
          "div",
          { className: "eoe-root" },
          h("div", { className: "eoe-loading" }, h("div", { className: "eoe-loader" }), "LINKING EOE WORKBENCH")
        );
      }

      if (loadError || !config) {
        return h(
          "div",
          { className: "eoe-root" },
          h(
            "div",
            { className: "eoe-error-screen" },
            h(
              "div",
              { className: "eoe-error-card" },
              h("div", { className: "eoe-error-kicker" }, "HOST LINK LOST"),
              h("h2", null, "控制接口不可用"),
              h(
                "p",
                null,
                "无法连接 /api/eoe。请确认 host 半边已加载且 DSH 已重启；若是刚安装本插件，重启 DSH 后再打开 EOE 工作台。"
              ),
              h("pre", null, String(loadError || "config 未返回")),
              h(
                "div",
                { className: "eoe-actions" },
                h(Btn, { variant: "primary", icon: "refresh", onClick: () => window.location.reload() }, "重新加载页面")
              )
            )
          )
        );
      }

      const logText =
        jobState?.running || jobState?.job
          ? logSource === "console"
            ? jobState?.consoleTail || ""
            : jobState?.logTail || ""
          : historicalLog;

      const preflightErrorCount = preflight?.checks?.errors ?? preflight?.errors ?? 0;
      const preflightWarnCount = preflight?.checks?.warnings ?? preflight?.warnings ?? 0;

      return h(
        "div",
        { className: "eoe-root" },
        h(
          "header",
          { className: "eoe-top" },
          h(
            "div",
            { className: "eoe-brand" },
            h("div", { className: "eoe-mark" }, h(BrandMark, null)),
            h(
              "div",
              { className: "eoe-brand-copy" },
              h(
                "div",
                { className: "eoe-brand-line" },
                h("span", { className: "eoe-brand-name" }, "E", h("b", null, "O"), "E"),
                h("span", { className: "eoe-brand-tag" }, "WORKBENCH")
              ),
              h("div", { className: "eoe-brand-sub" }, "SILICON PHOTONICS · PAM4 106.25G · HEADLESS PHASE1–3")
            )
          ),
          h(
            "div",
            { className: "eoe-top-mid" },
            h(
              "span",
              { className: "eoe-chip" },
              h(Led, { status: status.led }),
              h("b", null, status.label),
              jobState?.running ? h("span", { className: "eoe-mono" }, "· " + fmtDuration(elapsedMs(jobState.job, now))) : null
            ),
            h(
              "span",
              { className: "eoe-chip" },
              "LINK ",
              h("b", null, fmtGbps(config.link?.bitrate_gbps)),
              " / ",
              h("b", null, fmtGHz(config.link?.baud_hz))
            ),
            h(
              "span",
              { className: "eoe-chip" },
              "MODE ",
              h("b", null, settings.short ? "SHORT SMOKE" : "FULL LINK"),
              h("span", { className: "eoe-mono" }, " · P" + String(settings.fromPhase))
            )
          ),
          h(
            "div",
            { className: "eoe-top-actions" },
            h(
              Btn,
              {
                variant: jobState?.running ? "danger" : "primary",
                icon: jobState?.running ? "stop" : "play",
                onClick: jobState?.running ? cancelRun : startRun,
                disabled: busy || (!jobState?.running && !preflight?.ok),
                title: jobState?.running
                  ? "取消当前 EOE 进程树"
                  : !preflight?.ok
                    ? "预检未通过，请先修正配置"
                    : bootTitle
              },
              jobState?.running ? (cancelArmed ? "确认取消" : "取消运行") : bootTitle
            ),
            h(
              Btn,
              {
                className: "icon",
                icon: "refresh",
                onClick: async () => {
                  notify("正在刷新配置与任务状态…", "info");
                  try {
                    const payload = await api("/status");
                    setJobState(payload);
                    if (payload.job?.runDir) await loadRun(payload.job.runDir);
                    await loadRuns();
                  } catch (error) {
                    notify("刷新失败: " + String(error?.message || error), "error");
                  }
                },
                title: "刷新状态 / 最近运行"
              }
            )
          )
        ),
        h(
          "div",
          { className: "eoe-status-strip" },
          h("span", null, "CONFIG ", h("b", null, shortPath(configMeta?.path || "config.yaml", 54))),
          h("span", { className: "eoe-sep" }),
          h("span", null, "P1 ", h("b", null, String(config.phase1?.n_bits ?? "—")), " bits"),
          h("span", null, "P2 ", h("b", null, String(config.phase2?.n_ui ?? "—")), " UI"),
          h("span", null, "P3 ", h("b", null, String(config.phase3?.n_bits ?? "—")), " bits"),
          h("span", { className: "eoe-sep" }),
          h("span", null, "AMI ", h("b", null, config.ami?.tx_component || "my_Ethernet_Tx")),
          h("span", { className: "eoe-strip-grow" }),
          dirty ? h("span", { className: "eoe-tag amber" }, "UNSAVED EDITS") : h("span", { className: "eoe-tag" }, "DEFAULTS LOADED"),
          preflight ? h("span", { className: cx("eoe-tag", preflight.ok ? "green" : "red") }, preflight.ok ? "PREFLIGHT READY" : preflightErrorCount + " BLOCKERS") : null
        ),
        h(
          "div",
          { className: "eoe-work" },
          h(Rail, {
            config,
            settings,
            setSettings,
            jobState,
            summary,
            runs,
            selectedRun,
            onSelectRun: (run) => {
              loadRun(run.path);
              setTab("analyze");
            },
            configMeta,
            notify
          }),
          h(
            "main",
            { className: "eoe-main" },
            h(
              "nav",
              { className: "eoe-tabs", "aria-label": "EOE workbench views" },
              h(TabButton, {
                active: tab === "setup",
                index: "01",
                label: "配置",
                onClick: () => setTab("setup")
              }),
              h(TabButton, {
                active: tab === "run",
                index: "02",
                label: "运行",
                count: jobState?.running ? "LIVE" : null,
                onClick: () => setTab("run")
              }),
              h(TabButton, {
                active: tab === "analyze",
                index: "03",
                label: "结果 / 眼图",
                count: summary?.eyeCsvs?.length || null,
                onClick: () => setTab("analyze")
              })
            ),
            tab === "setup"
              ? h(SetupView, {
                  config,
                  updateConfig,
                  updateBitrate,
                  settings,
                  setSettings,
                  preflight,
                  preflightError,
                  configMeta,
                  dirty,
                  busy,
                  onRun: startRun,
                  onCancel: cancelRun,
                  cancelArmed,
                  jobState,
                  onSaveSnapshot: saveSnapshot,
                  onRestoreDefaults: restoreDefaults,
                  onOverwriteDefault: overwriteDefault,
                  onCopyCommand: copyCommand,
                  onPreflight: doPreflight,
                  notify
                })
              : tab === "run"
                ? h(RunView, {
                    jobState,
                    now,
                    logText,
                    logSource,
                    setLogSource,
                    logFollow,
                    setLogFollow,
                    logFilter,
                    setLogFilter,
                    summary,
                    selectedRun,
                    onOpenAnalyze: () => setTab("analyze"),
                    onCopyLog: async () => {
                      const copied = await copyText(logText);
                      notify(copied ? "日志已复制" : "复制失败", copied ? "ok" : "error");
                    },
                    onRefresh: async () => {
                      try {
                        const payload = await api("/status");
                        setJobState(payload);
                      } catch (error) {
                        notify("刷新失败: " + String(error?.message || error), "error");
                      }
                    }
                  })
                : h(AnalyzeView, {
                    summary,
                    selectedRun,
                    artifacts,
                    runs,
                    selectedEye,
                    setSelectedEye,
                    eyeData,
                    eyeLoading,
                    eyeError,
                    eyeScale,
                    setEyeScale,
                    onSelectRun: (path) => loadRun(path),
                    openPreview,
                    onGoSetup: () => setTab("setup"),
                    artifactQuery,
                    setArtifactQuery,
                    artifactKind,
                    setArtifactKind,
                    selectedRunMeta: selectedRun
                  })
          ),
          h(Deck, {
            preflight,
            preflightError,
            config,
            settings,
            setSettings,
            jobState,
            now,
            runs,
            selectedRun,
            onSelectRun: (path) => {
              loadRun(path);
              setTab("analyze");
            },
            onRun: startRun,
            onCancel: cancelRun,
            cancelArmed,
            busy,
            onCopyCommand: copyCommand,
            onPreflight: doPreflight,
            notify
          })
        ),
        preview
          ? h(PreviewModal, {
              preview,
              loading: previewLoading,
              onClose: () => setPreview(null)
            })
          : null,
        toast ? h(Toast, { toast }) : null
      );
    }

    function TabButton(props) {
      return h(
        "button",
        {
          type: "button",
          className: cx("eoe-tab", props.active ? "active" : ""),
          onClick: props.onClick,
          "aria-current": props.active ? "page" : undefined
        },
        h("span", { className: "eoe-tab-no" }, props.index),
        props.label,
        props.count ? h("span", { className: "eoe-tab-count" }, String(props.count)) : null
      );
    }

    function Rail(props) {
      const { config, settings, setSettings, jobState, summary, runs, selectedRun, onSelectRun, configMeta } = props;
      const runningPhase = jobState?.running ? Number(jobState?.progress?.phase) || 0 : 0;
      const phases = [
        { number: 1, kicker: "PHASE 01", title: "Tx AMI", meta: "n_bits " + String(config.phase1?.n_bits ?? "—") + " · Mode 1" },
        { number: 2, kicker: "PHASE 02", title: "光引擎 / Envelope", meta: "n_ui " + String(config.phase2?.n_ui ?? "—") + " · 53.125 GBd" },
        { number: 3, kicker: "PHASE 03", title: "Rx AMI", meta: "n_bits " + String(config.phase3?.n_bits ?? "—") + " · " + String(config.phase3?.measured || "auto") }
      ];
      return h(
        "aside",
        { className: "eoe-rail", "aria-label": "Phase rail" },
        h(
          "div",
          { className: "eoe-rail-head" },
          h("span", null, "SIGNAL CHAIN"),
          h("b", null, "PAM4 / EOE")
        ),
        h(
          "div",
          { className: "eoe-phase-list" },
          phases.map((phase) => {
            const state = phaseState(summary, runningPhase, phase.number, settings.fromPhase);
            return h(
              "div",
              { className: cx("eoe-phase", state), key: phase.number },
              h("div", { className: "eoe-phase-node" }, String(phase.number).padStart(2, "0")),
              h(
                "div",
                { className: "eoe-phase-copy" },
                h("div", { className: "eoe-phase-kicker" }, phase.kicker + " · " + phaseLabel(state)),
                h("div", { className: "eoe-phase-title" }, phase.title),
                h("div", { className: "eoe-phase-meta" }, phase.meta)
              )
            );
          })
        ),
        h(
          "div",
          { className: "eoe-quick-label" },
          h("span", null, "START AT"),
          h("b", null, "FROM-PHASE")
        ),
        h(
          "div",
          { style: { marginBottom: "16px" } },
          h(Segmented, {
            value: settings.fromPhase,
            onChange: (value) => setSettings((current) => ({ ...current, fromPhase: Number(value) })),
            options: [
              { value: 1, label: "01" },
              { value: 2, label: "02" },
              { value: 3, label: "03" }
            ]
          })
        ),
        h(
          "div",
          { className: "eoe-quick-label" },
          h("span", null, "RECENT RUNS"),
          h("b", null, String(runs.length))
        ),
        h(
          "div",
          { className: "eoe-run-list" },
          runs.length === 0
            ? h("div", { className: "eoe-mini-note" }, "还没有运行目录。启动一次完整链路或短冒烟。")
            : runs.slice(0, 8).map((run) =>
                h(
                  "button",
                  {
                    key: run.path,
                    type: "button",
                    className: cx("eoe-run-item", selectedRun === run.path ? "selected" : ""),
                    onClick: () => onSelectRun(run),
                    title: run.path
                  },
                  h("span", { className: cx("eoe-run-dot", run.ok ? "ok" : "bad") }),
                  h("span", { className: "eoe-run-name" }, run.name),
                  h("span", { className: "eoe-run-time" }, run.short ? "SHORT" : "FULL")
                )
              )
        ),
        h(
          "div",
          { className: "eoe-mini-note" },
          h("div", null, h("b", null, "CONFIG "), shortPath(configMeta?.path || "config.yaml", 34)),
          h("div", { style: { marginTop: "3px" } }, h("b", null, "MTIME "), fmtTime(configMeta?.mtime)),
          h("div", { style: { marginTop: "8px" } }, "设置会写入本次 run-dir 的 config.yaml；默认配置只在明确确认时备份并覆盖。")
        )
      );
    }

    function SetupView(props) {
      const {
        config,
        updateConfig,
        updateBitrate,
        settings,
        setSettings,
        preflight,
        preflightError,
        configMeta,
        dirty,
        busy,
        onRun,
        onCancel,
        cancelArmed,
        jobState,
        onSaveSnapshot,
        onRestoreDefaults,
        onOverwriteDefault,
        onCopyCommand,
        onPreflight
      } = props;

      const update = updateConfig;
      const field = (path, transform) => (value) => update(path, transform ? transform(value) : value);
      const templatePath = String(config.phase2?.envelope_template || "");
      const resultsRoot = String(config.paths?.results_root || "");
      const shortHint = settings.short
        ? "PHASE1 n_bits≤1024、PHASE2 n_ui≤512，并跳过 PHASE3。只用于确认 CLI / 许可证 / 网表能起来。"
        : "完整三相位，默认 n_ui=4608；不会偷偷加 --short。";

      return h(
        "div",
        { className: "eoe-view" },
        h(
          "div",
          { className: "eoe-analyze-top" },
          h(
            "div",
            null,
            h("div", { className: "eoe-analyze-title" }, "LINK SETUP", h("small", null, "CONFIG / RUN CONTROL")),
            h(
              "div",
              { className: "eoe-analyze-sub" },
              "可视化配置 EOE 三相位 · 默认值来自 workbench/config.yaml · 所有路径均可在运行前修正"
            )
          ),
          h(
            "div",
            { className: "eoe-actions" },
            h(
              Btn,
              { icon: "folder", onClick: onSaveSnapshot, disabled: busy, title: "保存一份配置快照到 results_root/_config_snapshots" },
              "保存配置快照"
            ),
            h(Btn, { icon: "refresh", onClick: onPreflight, disabled: busy }, "重新预检")
          )
        ),
        h(
          Section,
          {
            index: "00",
            kicker: "LAUNCH CONTROL",
            title: settings.short ? "短冒烟启动" : "完整链路启动",
            right: [
              h(Tag, { key: "mode", tone: settings.short ? "amber" : "cyan" }, settings.short ? "SHORT / SKIPS P3" : "FULL P1→P3"),
              h(Tag, { key: "phase" }, "FROM " + String(settings.fromPhase))
            ]
          },
          h(
            "div",
            { className: "eoe-toggle-row", style: { marginBottom: "12px" } },
            h(Toggle, {
              label: "短冒烟 --short",
              description: shortHint,
              checked: settings.short,
              onChange: (checked) => setSettings((current) => ({ ...current, short: checked }))
            }),
            h(Toggle, {
              label: "关闭 TDECQ 钩子 --no-tdecq",
              description: "PHASE2 成功后不计算 802.3bs 121.8.5 风格 COMPUTED TDECQ。",
              checked: settings.noTdecq,
              onChange: (checked) => setSettings((current) => ({ ...current, noTdecq: checked }))
            }),
            h(Toggle, {
              label: "保留默认 TDECQ",
              description: "默认开启；这是 COMPUTED 值，不是 FlexDCA，也不能当合规指标。",
              checked: !settings.noTdecq,
              onChange: (checked) => setSettings((current) => ({ ...current, noTdecq: !checked }))
            })
          ),
          h(
            "div",
            { className: "eoe-field-grid" },
            h(
              Field,
              {
                label: "RUN-DIR",
                hint: "留空 = results_root/run_<本地时间戳>。自定义目录必须在 results_root 或 workroot 下。"
              },
              h(TextInput, {
                value: settings.runDir,
                onChange: (value) => setSettings((current) => ({ ...current, runDir: value })),
                placeholder: resultsRoot + "\\run_YYYYMMDD_HHMMSS",
                mono: true
              })
            ),
            h(
              Field,
              {
                label: "FROM-PHASE",
                hint: "增量运行会复用同一 run-dir 里前序相位的产物；P2/P3 需要已有 CSV/.ds。"
              },
              h(Segmented, {
                value: settings.fromPhase,
                onChange: (value) => setSettings((current) => ({ ...current, fromPhase: Number(value) })),
                options: [
                  { value: 1, label: "01 · Tx AMI" },
                  { value: 2, label: "02 · Optics" },
                  { value: 3, label: "03 · Rx AMI" }
                ]
              })
            )
          ),
          h(
            "div",
            { className: "eoe-launch", style: { marginTop: "14px" } },
            h(
              "div",
              { className: "eoe-launch-main" },
              jobState?.running
                ? h(
                    Btn,
                    {
                      variant: "danger",
                      size: "big",
                      icon: "stop",
                      onClick: onCancel,
                      disabled: busy
                    },
                    cancelArmed ? "再次点击确认取消进程树" : "取消当前运行"
                  )
                : h(
                    Btn,
                    {
                      variant: "primary",
                      size: "big",
                      icon: "play",
                      onClick: onRun,
                      disabled: busy || !preflight?.ok
                    },
                    settings.short ? "启动短冒烟（跳过 PHASE3）" : "一键运行 PHASE1 → PHASE2 → PHASE3"
                  ),
              h(
                Btn,
                { icon: "copy", onClick: onCopyCommand, disabled: !preflight?.command?.preview, title: "复制 argv 预览" },
                "复制命令"
              )
            ),
            h(
              "div",
              { className: "eoe-launch-meta" },
              h("span", null, preflight?.ok ? "PREFLIGHT PASS" : preflight ? "PREFLIGHT BLOCKED" : "PREFLIGHT PENDING"),
              h("span", null, "CFG " + (dirty ? "EDITED" : "DEFAULTS"))
            ),
            h(
              "div",
              { className: "eoe-command" },
              preflight?.command?.preview || preflightError || "正在生成 argv 预览…"
            )
          )
        ),
        h(
          Section,
          {
            index: "01",
            kicker: "LINK PROFILE",
            title: "速率与链路",
            right: h(Tag, { tone: "amber" }, "PAM4 LOCKED")
          },
          h(
            "div",
            { className: "eoe-field-grid three" },
            h(
              Field,
              { label: "BITRATE", unit: "Gb/s", hint: "默认 106.25 Gb/s；修改后若 baud 仍同步，会自动按 PAM4 半速率更新。" },
              h(NumberInput, {
                value: config.link?.bitrate_gbps ?? "",
                onChange: updateBitrate,
                min: 0.1,
                step: 0.05
              })
            ),
            h(
              Field,
              { label: "BAUD", unit: "GBd", hint: "默认 53.125 GBd；PAM4 期望 baud = bitrate / 2。" },
              h(NumberInput, {
                value: Number(config.link?.baud_hz || 0) / 1e9,
                onChange: (value) => update("link.baud_hz", Number(value) * 1e9),
                min: 0.1,
                step: 0.125
              })
            ),
            h(
              Field,
              { label: "WAVELENGTH", unit: "nm", hint: "仅记录在配置中，当前 PHASE2 模板使用 1310 nm 光引擎。" },
              h(NumberInput, {
                value: config.link?.wavelength_nm ?? "",
                onChange: field("link.wavelength_nm")
              })
            )
          ),
          h(
            "div",
            { className: "eoe-note", style: { marginTop: "12px" } },
            h("b", null, "硬约束："),
            "AMI 只用 my_Ethernet PAM4（Tx/Rx），禁止 BCM / PCIe NRZ；不走 ADS GUI、Ethernet Setup 或官方 Mode=5 BatchSimSweep；不修改 PAM4_106G_EOE_Link 原理图。"
          )
        ),
        h(
          Section,
          {
            index: "02",
            kicker: "AMI ASSETS / CHANNEL",
            title: "AMI 与通道 sNp",
            right: h(Tag, { tone: "cyan" }, "my_Ethernet")
          },
          h(
            "div",
            { className: "eoe-field-grid" },
            h(
              Field,
              { label: "TX AMI DIR", wide: true, hint: "包含 my_Ethernet_Tx.ibs、模型 DLL 与 passthrough.s4p。" },
              h(TextInput, {
                value: config.ami?.tx_dir ?? "",
                onChange: field("ami.tx_dir"),
                mono: true
              })
            ),
            h(
              Field,
              { label: "RX AMI DIR", wide: true, hint: "包含 my_Ethernet_Rx.ibs、模型 DLL 与 passthrough.s4p。" },
              h(TextInput, {
                value: config.ami?.rx_dir ?? "",
                onChange: field("ami.rx_dir"),
                mono: true
              })
            ),
            h(
              Field,
              { label: "TX IBIS", hint: "相对 tx_dir 的文件名。" },
              h(TextInput, { value: config.ami?.tx_ibs ?? "", onChange: field("ami.tx_ibs"), mono: true })
            ),
            h(
              Field,
              { label: "RX IBIS", hint: "相对 rx_dir 的文件名。" },
              h(TextInput, { value: config.ami?.rx_ibs ?? "", onChange: field("ami.rx_ibs"), mono: true })
            ),
            h(
              Field,
              { label: "通道 s4p", hint: "PHASE1/3 netlist 从 Tx/Rx AMI 目录读取这个文件名（默认 passthrough.s4p）。" },
              h(TextInput, { value: config.ami?.passthrough_s4p ?? "", onChange: field("ami.passthrough_s4p"), mono: true })
            ),
            h(
              Field,
              { label: "TX COMPONENT", hint: "IBIS component 名；默认 my_Ethernet_Tx。" },
              h(TextInput, { value: config.ami?.tx_component ?? "", onChange: field("ami.tx_component"), mono: true })
            ),
            h(
              Field,
              { label: "RX COMPONENT", hint: "IBIS component 名；默认 my_Ethernet_Rx。" },
              h(TextInput, { value: config.ami?.rx_component ?? "", onChange: field("ami.rx_component"), mono: true })
            ),
            h(
              Field,
              { label: "TX MODE", hint: "硬约束：Tx AMI Mode=1 GetWave。" },
              h(TextInput, { value: "1", disabled: true, mono: true })
            )
          )
        ),
        h(
          "div",
          { className: "eoe-field-grid", style: { gap: "14px" } },
          h(
            Section,
            {
              index: "03",
              kicker: "PHASE 1",
              title: "Tx AMI"
            },
            h(
              "div",
              { className: "eoe-field-grid" },
              h(Field, { label: "N_BITS", hint: "ChannelSim NumberOfBits；默认 5120。" }, h(NumberInput, { value: config.phase1?.n_bits ?? "", onChange: field("phase1.n_bits"), min: 64, step: 64 })),
              h(Field, { label: "BLOCK_SIZE", hint: "默认 256。" }, h(NumberInput, { value: config.phase1?.block_size ?? "", onChange: field("phase1.block_size"), min: 8, step: 8 })),
              h(Field, { label: "PTS / UI", hint: "默认 10。" }, h(NumberInput, { value: config.phase1?.pts_per_ui ?? "", onChange: field("phase1.pts_per_ui"), min: 2, step: 1 })),
              h(Field, { label: "TX IGNORE BITS", hint: "AMI Ignore_Bits，默认 10。" }, h(NumberInput, { value: config.phase1?.tx_ignore_bits ?? "", onChange: field("phase1.tx_ignore_bits"), min: 0, step: 1 })),
              h(Field, { label: "RX IGNORE BITS", hint: "AMI Ignore_Bits，默认 64。" }, h(NumberInput, { value: config.phase1?.rx_ignore_bits ?? "", onChange: field("phase1.rx_ignore_bits"), min: 0, step: 1 })),
              h(Field, { label: "TX_MODE", hint: "固定 1（GetWave）。" }, h(TextInput, { value: "1", disabled: true, mono: true }))
            )
          ),
          h(
            Section,
            {
              index: "04",
              kicker: "PHASE 2",
              title: "光引擎 / Envelope"
            },
            h(
              "div",
              { className: "eoe-field-grid" },
              h(Field, { label: "N_UI", hint: "完整链路建议 ≥4352；默认 4608。" }, h(NumberInput, { value: config.phase2?.n_ui ?? "", onChange: field("phase2.n_ui"), min: 64, step: 64 })),
              h(Field, { label: "OS_FACTOR", hint: "默认 8。" }, h(NumberInput, { value: config.phase2?.os_factor ?? "", onChange: field("phase2.os_factor"), min: 1, step: 1 })),
              h(Field, { label: "PWL TARGET POINTS", hint: "默认 5000。" }, h(NumberInput, { value: config.phase2?.pwl_target_points ?? "", onChange: field("phase2.pwl_target_points"), min: 100, step: 100 })),
              h(Field, { label: "ENVELOPE TEMPLATE", wide: true, hint: "相对 workbench 的 netlist 模板。" }, h(TextInput, { value: templatePath, onChange: field("phase2.envelope_template"), mono: true }))
            ),
            h(
              "div",
              { className: "eoe-note", style: { marginTop: "12px" } },
              h("b", null, "PHASE2 桥："),
              "Tx AMI 波形 → V_PWL Tran 桥 → VtDataset → SiPho Envelope。TIA 波形与 N_pam 进入 TDECQ 钩子；默认 TDECQ 是 COMPUTED，不冒充 FlexDCA。"
            )
          )
        ),
        h(
          Section,
          {
            index: "05",
            kicker: "PHASE 3",
            title: "Rx AMI / 判决",
            right: h(Tag, { tone: "cyan" }, "MODE 5")
          },
          h(
            "div",
            { className: "eoe-field-grid three" },
            h(Field, { label: "N_BITS", hint: "ChannelSim 长度；默认 4608。" }, h(NumberInput, { value: config.phase3?.n_bits ?? "", onChange: field("phase3.n_bits"), min: 64, step: 64 })),
            h(Field, { label: "N_UI_MIN", hint: "默认 4480；discard 后需明显 >4288。" }, h(NumberInput, { value: config.phase3?.n_ui_min ?? "", onChange: field("phase3.n_ui_min"), min: 64, step: 64 })),
            h(Field, { label: "DISCARD_UI", hint: "默认 64。" }, h(NumberInput, { value: config.phase3?.discard_ui ?? "", onChange: field("phase3.discard_ui"), min: 0, step: 1 })),
            h(Field, { label: "PTS / UI", hint: "默认 10。" }, h(NumberInput, { value: config.phase3?.pts_per_ui ?? "", onChange: field("phase3.pts_per_ui"), min: 2, step: 1 })),
            h(
              Field,
              { label: "MEASURED", hint: "auto = TIA → sharp TIA → Tx 眼回退。" },
              h(Select, {
                value: config.phase3?.measured ?? "auto",
                onChange: field("phase3.measured"),
                options: [
                  { value: "auto", label: "auto (TIA → sharp → Tx eye)" },
                  { value: "tia_soft", label: "tia_soft" },
                  { value: "tx_eye", label: "tx_eye" }
                ]
              })
            ),
            h(
              Field,
              { label: "USE SECOND MEASURED", hint: "默认关闭。" },
              h(Select, {
                value: config.phase3?.use_second_measured ? "true" : "false",
                onChange: (value) => update("phase3.use_second_measured", value === "true"),
                options: [
                  { value: "false", label: "false" },
                  { value: "true", label: "true" }
                ]
              })
            )
          ),
          h(
            "div",
            { className: "eoe-toggle-row", style: { marginTop: "12px" } },
            h(Toggle, {
              label: "Fallback 重试",
              description: "软 TIA 失败后自动尝试 sharp TIA 与 Tx 眼对照；默认开启。",
              checked: Boolean(config.phase3?.fallback),
              onChange: (checked) => update("phase3.fallback", checked)
            }),
            h(Toggle, {
              label: "TDECQ 钩子",
              description: "PHASE2 成功后计算；可在启动控制里用 --no-tdecq 关闭。",
              checked: Boolean(config.tdecq?.enable),
              onChange: (checked) => update("tdecq.enable", checked)
            })
          ),
          h(
            "div",
            { className: "eoe-note", style: { marginTop: "12px" } },
            h("b", null, "PHASE3 现实："),
            "软 TIA 在 106G 可能报 fine_tune_UI_by_slope: wvfm is too short（边沿过缓，不一定是长度不足）。工作台会按 auto 回退；最终 winner=tx_eye 是 Tx 眼对照，不是软 TIA 闭环。"
          )
        ),
        h(
          Section,
          {
            index: "06",
            kicker: "OUTPUT / ENVIRONMENT",
            title: "输出目录与环境",
            right: h(Tag, { tone: dirty ? "amber" : "" }, dirty ? "EDITED" : "FROM CONFIG.YAML")
          },
          h(
            "div",
            { className: "eoe-field-grid" },
            h(
              Field,
              { label: "RESULTS ROOT", wide: true, hint: "运行目录与 _config_snapshots 都在这里；必须是可写目录。" },
              h(TextInput, {
                value: resultsRoot,
                onChange: field("paths.results_root"),
                mono: true
              })
            )
          ),
          h(
            "details",
            { className: "eoe-advanced" },
            h("summary", null, h(Icon, { name: "settings", size: 12 }), "高级：workroot / ADS / Python / 工作区路径"),
            h(
              "div",
              { className: "eoe-field-grid", style: { marginTop: "11px" } },
              h(Field, { label: "WORKROOT", wide: true }, h(TextInput, { value: config.workroot ?? "", onChange: field("workroot"), mono: true })),
              h(Field, { label: "HPEESOF_DIR", wide: true }, h(TextInput, { value: config.hpeesof_dir ?? "", onChange: field("hpeesof_dir"), mono: true })),
              h(Field, { label: "PYTHON", wide: true }, h(TextInput, { value: config.python ?? "", onChange: field("python"), mono: true })),
              h(Field, { label: "SIHIPO WRK", wide: true }, h(TextInput, { value: config.wrk ?? "", onChange: field("wrk"), mono: true })),
              h(Field, { label: "OFFICIAL EOE WRK", wide: true }, h(TextInput, { value: config.official_eoe_wrk ?? "", onChange: field("official_eoe_wrk"), mono: true }))
            ),
            h(
              "div",
              { className: "eoe-note", style: { marginTop: "12px" } },
              h("b", null, "默认配置保护："),
              "运行只写 run-dir/config.yaml。只有点「写回默认配置」并二次确认后，才会备份 config.yaml 并覆盖工作台默认文件。"
            )
          )
        ),
        h(
          "div",
          { className: "eoe-actions", style: { justifyContent: "space-between", margin: "4px 0 18px", gap: "10px" } },
          h(
            "div",
            { className: "eoe-actions" },
            h(Btn, { icon: "refresh", onClick: onRestoreDefaults, disabled: busy }, "恢复载入值"),
            h(
              Btn,
              {
                variant: "danger",
                icon: "alert",
                onClick: onOverwriteDefault,
                disabled: busy,
                title: "备份后写回 workbench/config.yaml"
              },
              "写回默认配置"
            )
          ),
          h(
            "div",
            { className: "eoe-mini-note", style: { textAlign: "right" } },
            dirty ? "有未保存编辑；运行时会写入 run-dir 副本。" : "表单与载入的 config.yaml 一致。"
          )
        )
      );
    }

    function RunView(props) {
      const { jobState, now, logText, logSource, setLogSource, logFollow, setLogFollow, logFilter, setLogFilter, summary, onOpenAnalyze, onCopyLog, onRefresh, selectedRun } = props;
      const job = jobState?.job;
      const running = Boolean(jobState?.running);
      const elapsed = elapsedMs(job, now);
      const progress = jobState?.progress || { percent: 0, label: running ? "运行中" : "空闲" };
      const lines = useMemo(() => {
        const all = String(logText || "").split(/\r?\n/);
        const filtered = logFilter.trim()
          ? all.filter((line) => line.toLowerCase().includes(logFilter.toLowerCase()))
          : all;
        return filtered.slice(-HEADER_LINES);
      }, [logText, logFilter]);
      const scrollRef = useRef(null);
      useEffect(() => {
        if (!logFollow || !scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, [logText, logFollow, logFilter]);

      return h(
        "div",
        { className: "eoe-view" },
        h(
          "div",
          { className: "eoe-analyze-top" },
          h(
            "div",
            null,
            h("div", { className: "eoe-analyze-title" }, running ? "LIVE RUN" : "RUN LOG", h("small", null, job?.runDir ? shortPath(job.runDir, 48) : selectedRun ? shortPath(selectedRun, 48) : "NO RUN SELECTED")),
            h("div", { className: "eoe-analyze-sub" }, running ? progress.label + " · 轮询 run_log.txt / stdout" : "可回看最近一次运行的日志与摘要")
          ),
          h(
            "div",
            { className: "eoe-actions" },
            h(Btn, { icon: "refresh", onClick: onRefresh, disabled: false }, "刷新"),
            summary ? h(Btn, { variant: "primary", icon: "chart", onClick: onOpenAnalyze }, "打开结果与眼图") : null
          )
        ),
        h(
          Section,
          {
            index: "RUN",
            kicker: running ? "LIVE TELEMETRY" : "ARCHIVED TELEMETRY",
            title: running ? "运行中 · " + progress.label : job?.status ? "结束 · " + String(job.status).toUpperCase() : "历史运行",
            right: [
              h(Tag, { key: "pid", tone: running ? "amber" : "" }, "PID " + String(job?.pid || "—")),
              h(Tag, { key: "elapsed" }, fmtDuration(elapsed)),
              h(Tag, { key: "exit", tone: running ? "" : job?.status === "succeeded" ? "green" : "red" }, "EXIT " + String(job?.exitCode ?? "—"))
            ]
          },
          h(
            "div",
            { className: "eoe-progress" },
            h("div", { className: "eoe-progress-bar", style: { width: percent(progress.percent) + "%" } })
          ),
          h(
            "div",
            { className: "eoe-launch-meta", style: { marginBottom: "10px" } },
            h("span", null, progress.label),
            h("span", null, String(percent(progress.percent)) + "%")
          ),
          h(
            "div",
            { className: "eoe-toggle-row", style: { marginBottom: "10px" } },
            h(
              "div",
              { className: "eoe-kv", style: { flex: "1 1 260px" } },
              h("span", null, "RUN DIR"),
              h("b", { className: "eoe-mono", style: { fontSize: "9px" } }, job?.runDir || selectedRun || "—")
            ),
            h(
              "div",
              { className: "eoe-kv", style: { flex: "1 1 220px" } },
              h("span", null, "CONFIG"),
              h("b", { className: "eoe-mono", style: { fontSize: "9px" } }, job?.configPath || "—")
            )
          ),
          h(
            "div",
            { className: "eoe-note", style: { marginBottom: "12px" } },
            h("b", null, "轮询而不是假流式："),
            "页面每 " + String(running ? "1.2" : "5") + " 秒读取 host 的 run_log.txt / stdout 尾部；实际仿真仍由 hpeesofsim 在后台跑。取消按钮会 taskkill /T 整棵进程树。"
          )
        ),
        h(
          Section,
          {
            index: "LOG",
            kicker: "BOUNDED CONSOLE",
            title: "日志 / 控制台",
            right: [
              running ? h(Tag, { key: "live", tone: "amber" }, "LIVE · " + lines.length + " LINES") : h(Tag, { key: "lines" }, lines.length + " LINES"),
              h(
                Btn,
                { key: "copy", icon: "copy", onClick: onCopyLog, disabled: !logText },
                "复制"
              )
            ]
          },
          h(
            "div",
            { className: "eoe-console-toolbar" },
            h(Segmented, {
              value: logSource,
              onChange: setLogSource,
              options: [
                { value: "run", label: "RUN_LOG" },
                { value: "console", label: "STDOUT" }
              ]
            }),
            h(
              "label",
              { style: { display: "flex", alignItems: "center", gap: "5px", color: "var(--eoe-muted)", fontSize: "9px" } },
              h("input", {
                type: "checkbox",
                checked: logFollow,
                onChange: (event) => setLogFollow(event.target.checked)
              }),
              "FOLLOW"
            ),
            h(TextInput, {
              value: logFilter,
              onChange: setLogFilter,
              placeholder: "过滤日志…",
              ariaLabel: "过滤日志"
            }),
            h("span", { style: { flex: "1 1 auto" } }),
            h("span", { className: "eoe-mono", style: { color: "var(--eoe-muted)", fontSize: "8.5px" } }, jobState?.running ? "polling" : "idle")
          ),
          h(
            "pre",
            { className: "eoe-console", ref: scrollRef, "aria-live": "polite" },
            lines.length === 0
              ? h("span", { className: "eoe-line" }, h("span", { className: "eoe-line-text" }, logText ? "(filter 无匹配)" : "暂无日志。启动运行时这里会显示 run_log.txt 的尾部。"))
              : lines.map((line, index) =>
                  h(
                    "span",
                    { className: "eoe-line", key: index },
                    h("span", { className: "eoe-line-no" }, String(index + 1).padStart(3, "0")),
                    h("span", { className: "eoe-line-text" }, line || " ")
                  )
                )
          )
        )
      );
    }

    function AnalyzeView(props) {
      const {
        summary,
        selectedRun,
        artifacts,
        runs,
        selectedEye,
        setSelectedEye,
        eyeData,
        eyeLoading,
        eyeError,
        eyeScale,
        setEyeScale,
        onSelectRun,
        openPreview,
        onGoSetup,
        artifactQuery,
        setArtifactQuery,
        artifactKind,
        setArtifactKind
      } = props;

      if (!summary) {
        return h(
          "div",
          { className: "eoe-view" },
          h(
            "div",
            { className: "eoe-empty", style: { marginTop: "34px" } },
            h("div", { className: "eoe-empty-icon" }, h(Icon, { name: "eye", size: 22 })),
            h("h3", null, "还没有可分析的结果"),
            h(
              "p",
              null,
              "运行一次完整链路或短冒烟后，这里会显示 summary、相位判定、TDECQ、产物文件与由 CSV 折回的眼图。眼图不依赖外部 CDN。"
            ),
            h(
              "div",
              { className: "eoe-actions" },
              h(Btn, { variant: "primary", icon: "play", onClick: onGoSetup }, "去配置并运行")
            )
          )
        );
      }

      const p1 = summary.phases?.[1] || {};
      const p2 = summary.phases?.[2] || {};
      const p3 = summary.phases?.[3] || {};
      const eyeCsvs = summary.eyeCsvs || [];
      const images = summary.images || [];
      const selectedEyeInfo = eyeCsvs.find((eye) => eye.path === selectedEye);
      const query = artifactQuery.trim().toLowerCase();
      const filteredArtifacts = artifacts.filter((item) => {
        if (artifactKind !== "all" && item.kind !== artifactKind) return false;
        if (query && !(item.rel + " " + item.name).toLowerCase().includes(query)) return false;
        return true;
      });
      const kinds = Array.from(new Set(artifacts.map((item) => item.kind))).sort();
      const openCsv = eyeCsvs.find((eye) => /Tx_AMI_Eye_P\.csv$/i.test(eye.name)) || eyeCsvs[0];

      return h(
        "div",
        { className: "eoe-view" },
        h(
          "div",
          { className: "eoe-analyze-top" },
          h(
            "div",
            null,
            h(
              "div",
              { className: "eoe-analyze-title" },
              summary.ok ? "LINK RESULT" : "LINK FAILED",
              h("small", null, summary.name),
              summary.short ? h(Tag, { tone: "amber" }, "SHORT / P3 SKIPPED") : h(Tag, { tone: "cyan" }, "FULL LINK"),
              h(Tag, { tone: summary.ok ? "green" : "red" }, summary.ok ? "SUMMARY OK" : "FAILED AT " + String(summary.failedAt || "?"))
            ),
            h(
              "div",
              { className: "eoe-analyze-sub" },
              shortPath(summary.runDir, 74) + " · " + fmtTime(summary.when || selectedRun) + " · " + fmtDuration(summary.durationMs)
            )
          ),
          h(
            "div",
            { className: "eoe-actions" },
            h(
              "select",
              {
                className: "eoe-select",
                style: { width: "auto", height: "29px", fontSize: "9px", maxWidth: "240px" },
                value: selectedRun || "",
                onChange: (event) => onSelectRun(event.target.value),
                "aria-label": "选择运行"
              },
              runs.map((run) =>
                h(
                  "option",
                  { key: run.path, value: run.path },
                  (run.ok ? "PASS · " : "FAIL · ") + run.name + (run.short ? " · short" : "")
                )
              )
            ),
            h(Btn, { icon: "refresh", onClick: () => onSelectRun(selectedRun), disabled: !selectedRun }, "重新读取")
          )
        ),
        h(
          "div",
          { className: "eoe-metric-grid" },
          h(Metric, { label: "BITRATE", value: fmtGbps(summary.bitrateGbps), sub: "PAM4 / " + String(summary.format || "PAM4") }),
          h(Metric, { label: "BAUD", value: fmtGHz(summary.baudHz), sub: "UI " + fmtPs(1e12 / (Number(summary.baudHz) || 1)) }),
          h(Metric, { label: "TDECQ", value: summary.tdecq?.dB != null ? fmtNum(summary.tdecq.dB, 2) : "—", unit: "dB", tone: "amber", sub: "COMPUTED · NOT FlexDCA" }),
          h(Metric, { label: "PHASE3 WINNER", value: p3.winner || (p3.skipped ? "SKIPPED" : "—"), tone: p3.winner === "tx_eye" ? "amber" : "cyan", sub: p3.skipped ? "short 模式跳过" : "auto fallback" }),
          h(Metric, { label: "RX EYE", value: p3.eyePoints ? Number(p3.eyePoints).toLocaleString() : "—", sub: "points" }),
          h(Metric, { label: "WALL TIME", value: fmtDuration(summary.durationMs), sub: summary.when || "" })
        ),
        h(
          "div",
          { className: "eoe-analyze-layout" },
          h(
            "div",
            null,
            h(
              "div",
              { className: "eoe-eye-card" },
              h(
                "div",
                { className: "eoe-eye-head" },
                h(
                  "div",
                  { className: "eoe-eye-title" },
                  h(Icon, { name: "eye", size: 14 }),
                  "DENSITY EYE",
                  h("b", null, selectedEyeInfo?.name || "NO CSV")
                ),
                h(
                  "div",
                  { className: "eoe-eye-tools" },
                  eyeCsvs.length > 0
                    ? h(
                        "select",
                        {
                          className: "eoe-select eoe-eye-select",
                          value: selectedEye || "",
                          onChange: (event) => setSelectedEye(event.target.value),
                          "aria-label": "选择眼图 CSV"
                        },
                        eyeCsvs.map((eye) => h("option", { key: eye.path, value: eye.path }, eye.name))
                      )
                    : null,
                  h(Segmented, {
                    value: eyeScale,
                    onChange: setEyeScale,
                    options: [
                      { value: "log", label: "LOG" },
                      { value: "linear", label: "LINEAR" }
                    ]
                  }),
                  selectedEyeInfo
                    ? h(
                        "a",
                        {
                          className: "eoe-link-btn",
                          href: fileUrl(selectedEyeInfo, selectedRun),
                          download: selectedEyeInfo.name,
                          style: { alignSelf: "center" }
                        },
                        "CSV"
                      )
                    : null
                )
              ),
              eyeCsvs.length === 0
                ? h(
                    "div",
                    { className: "eoe-empty", style: { border: 0, minHeight: "300px", justifyContent: "center" } },
                    h("div", { className: "eoe-empty-icon" }, h(Icon, { name: "chart", size: 22 })),
                    h("h3", null, "没有眼图 CSV"),
                    h("p", null, "短冒烟只跑 PHASE1/2；PHASE3 被跳过时可能没有 Rx 眼。已有 PNG 可在下方产物里查看。")
                  )
                : h(EyeChart, { data: eyeData, loading: eyeLoading, error: eyeError, scale: eyeScale })
            ),
            h(
              "div",
              { className: "eoe-eye-legend" },
              h("span", null, "LOW DENSITY → HIGH DENSITY"),
              h("span", { className: "eoe-legend-gradient" }),
              h("span", { className: "eoe-mono" }, eyeData ? eyeData.samples.toLocaleString() + " PTS · " + eyeData.grid.w + "×" + eyeData.grid.h : "—")
            )
          ),
          h(
            "div",
            null,
            h(
              "div",
              { className: "eoe-deck-card" },
              h("div", { className: "eoe-deck-title" }, "PHASE VERDICTS", h("b", null, "P1 / P2 / P3")),
              h(
                "div",
                { className: "eoe-verdict-list" },
                h(Verdict, {
                  name: "PHASE1 · Tx AMI",
                  state: p1.skipped ? "skip" : p1.ok ? "ok" : "fail",
                  detail: p1.skipped
                    ? "skipped by --from-phase"
                    : "n_bits " + String(p1.nBits ?? "—") + " · eye " + String(p1.eyePoints ?? "—") + " pts · n_ui " + fmtNum(p1.nUi, 1)
                }),
                h(Verdict, {
                  name: "PHASE2 · Optics",
                  state: p2.skipped ? "skip" : p2.ok ? "ok" : "fail",
                  detail:
                    "n_ui " +
                    String(p2.nUi ?? "—") +
                    " · TDECQ " +
                    (p2.tdecqDb != null ? fmtNum(p2.tdecqDb, 2) + " dB" : "—") +
                    (p2.log ? " · log 已存" : "")
                }),
                h(Verdict, {
                  name: "PHASE3 · Rx AMI",
                  state: p3.skipped ? "skip" : p3.ok ? "ok" : "fail",
                  detail: p3.skipped
                    ? "SKIPPED · " + String(summary.note || "short smoke")
                    : "winner " + String(p3.winner || "—") + " · eye " + String(p3.eyePoints ?? "—") + " pts" + (p3.attempts?.length ? " · " + String(p3.attempts.length) + " attempts" : "")
                })
              )
            ),
            summary.tdecq
              ? h(
                  "div",
                  { className: "eoe-tdecq" },
                  h("div", { className: "eoe-deck-title" }, "TDECQ · 121.8.5 STYLE", h("b", null, "COMPUTED")),
                  h("div", { className: "eoe-tdecq-value" }, fmtNum(summary.tdecq.dB, 2), h("small", null, "dB")),
                  h("div", { className: "eoe-tdecq-note" }, String(summary.tdecq.claim || "COMPUTED — NOT FlexDCA / NOT compliance")),
                  h(
                    "div",
                    { className: "eoe-tdecq-note" },
                    "OMA " + String(summary.tdecq.omaMethod || "—") + " · ER " + fmtNum(summary.tdecq.erDb, 2) + " dB · Q " + fmtNum(summary.tdecq.q, 2)
                  )
                )
              : null,
            p3.winner === "tx_eye"
              ? h(
                  "div",
                  { className: "eoe-note eoe-warn" },
                  h("b", null, "回退提示："),
                  "PHASE3 winner=tx_eye 表示软 TIA / sharp TIA 未能通过 Mode=5，最终用 Tx 眼对照完成 Rx AMI。不要把这条眼当作软 TIA 闭环或合规结论。"
                )
              : null,
            p1.skipped || p2.skipped
              ? h(
                  "div",
                  { className: "eoe-note", style: { marginTop: "10px" } },
                  h("b", null, "增量运行："),
                  "存在被 --from-phase 跳过的相位。结果来自同一 run-dir 的前序产物，必须确认这些文件仍然有效。"
                )
              : null
          )
        ),
        h(
          Section,
          {
            index: "ART",
            kicker: "RUN ARTIFACTS",
            title: "产物与证据",
            right: [
              h(Tag, { key: "count" }, String(filteredArtifacts.length) + " / " + String(artifacts.length)),
              openCsv ? h(Tag, { key: "eye", tone: "cyan" }, "EYE CSV AVAILABLE") : null
            ]
          },
          h(
            "div",
            { className: "eoe-artifact-toolbar" },
            h(TextInput, {
              value: artifactQuery,
              onChange: setArtifactQuery,
              placeholder: "过滤文件名 / 路径…",
              ariaLabel: "过滤产物"
            }),
            h(
              "select",
              {
                className: "eoe-select",
                value: artifactKind,
                onChange: (event) => setArtifactKind(event.target.value),
                "aria-label": "产物类型"
              },
              h("option", { value: "all" }, "ALL KINDS"),
              kinds.map((kind) => h("option", { key: kind, value: kind }, kind.toUpperCase()))
            ),
            h("span", { style: { flex: "1 1 auto" } }),
            h("span", { className: "eoe-mini-note" }, "点击行预览 · CSV / PNG / JSON / LOG · .ds 仅元数据")
          ),
          h(
            "div",
            { style: { maxHeight: "360px", overflow: "auto", border: "1px solid var(--eoe-line)" } },
            h(
              "table",
              { className: "eoe-artifact-table" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  h("th", null, "File"),
                  h("th", null, "Phase"),
                  h("th", null, "Kind"),
                  h("th", null, "Size"),
                  h("th", null, "Modified"),
                  h("th", { style: { textAlign: "right" } }, "Action")
                )
              ),
              h(
                "tbody",
                null,
                filteredArtifacts.length === 0
                  ? h(
                      "tr",
                      null,
                      h("td", { colSpan: 6, style: { padding: "20px", textAlign: "center", color: "var(--eoe-muted)" } }, "没有匹配的产物")
                    )
                  : filteredArtifacts.map((artifact) =>
                      h(
                        "tr",
                        { key: artifact.path, className: "eoe-artifact-row", onClick: () => openPreview(artifact), title: artifact.path },
                        h("td", { className: "eoe-artifact-name" }, artifact.rel),
                        h("td", null, h(Tag, null, artifact.phase)),
                        h("td", { className: "eoe-artifact-kind" }, artifact.kind),
                        h("td", { className: "eoe-artifact-size" }, fmtBytes(artifact.size)),
                        h("td", { className: "eoe-artifact-size" }, fmtTime(artifact.mtime)),
                        h(
                          "td",
                          { className: "eoe-artifact-actions" },
                          artifact.kind === "dataset" || artifact.size > 8 * 1024 * 1024
                            ? h("span", { className: "eoe-mini-note" }, "meta")
                            : h(
                                "a",
                                {
                                  className: "eoe-link-btn",
                                  href: fileUrl(artifact, selectedRun),
                                  download: artifact.name,
                                  onClick: (event) => event.stopPropagation()
                                },
                                "download"
                              )
                        )
                      )
                    )
              )
            )
          )
        )
      );
    }

    function Metric(props) {
      return h(
        "div",
        { className: "eoe-metric" },
        h("div", { className: "eoe-metric-label" }, props.label),
        h(
          "div",
          { className: cx("eoe-metric-value", props.tone) },
          props.value,
          props.unit ? h("small", null, props.unit) : null
        ),
        props.sub ? h("div", { className: "eoe-metric-sub", title: props.sub }, props.sub) : null
      );
    }

    function Verdict(props) {
      return h(
        "div",
        { className: cx("eoe-verdict", props.state) },
        h(
          "div",
          { className: "eoe-verdict-top" },
          h("span", { className: "eoe-verdict-name" }, props.name),
          h(Tag, { tone: props.state === "ok" ? "green" : props.state === "fail" ? "red" : "" }, props.state === "ok" ? "PASS" : props.state === "fail" ? "FAIL" : "SKIP")
        ),
        h("div", { className: "eoe-verdict-detail" }, props.detail)
      );
    }

    // ---------------------------------------------------------------------
    // Eye canvas
    // ---------------------------------------------------------------------

    function EyeChart(props) {
      const { data, loading, error, scale } = props;
      const canvasRef = useRef(null);
      const wrapRef = useRef(null);

      useEffect(() => {
        if (!data || !canvasRef.current || !wrapRef.current) return undefined;
        let raf = null;
        let dispose = () => {};
        const draw = () => {
          const canvas = canvasRef.current;
          const wrap = wrapRef.current;
          if (!canvas || !wrap) return;
          const rect = wrap.getBoundingClientRect();
          const width = Math.max(320, Math.floor(rect.width));
          const height = Math.max(240, Math.floor(rect.height));
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = "#061014";
          ctx.fillRect(0, 0, width, height);

          const pad = { left: 56, right: 92, top: 22, bottom: 38 };
          const plotW = Math.max(60, width - pad.left - pad.right);
          const plotH = Math.max(60, height - pad.top - pad.bottom);
          const grid = data.grid;
          const counts = grid.values;
          const max = Math.max(1, grid.max);
          const logMax = Math.log1p(max);
          const off = document.createElement("canvas");
          off.width = grid.w;
          off.height = grid.h;
          const offCtx = off.getContext("2d");
          if (!offCtx) return;
          const image = offCtx.createImageData(grid.w, grid.h);

          const stops = [
            [0.0, 13, 39, 46],
            [0.18, 21, 104, 112],
            [0.42, 48, 194, 186],
            [0.66, 217, 176, 89],
            [0.86, 249, 218, 153],
            [1.0, 255, 250, 235]
          ];
          const colorAt = (q) => {
            for (let i = 0; i < stops.length - 1; i += 1) {
              const a = stops[i];
              const b = stops[i + 1];
              if (q <= b[0] || i === stops.length - 2) {
                const t = Math.max(0, Math.min(1, (q - a[0]) / Math.max(1e-9, b[0] - a[0])));
                return [
                  Math.round(a[1] + (b[1] - a[1]) * t),
                  Math.round(a[2] + (b[2] - a[2]) * t),
                  Math.round(a[3] + (b[3] - a[3]) * t)
                ];
              }
            }
            return [255, 250, 235];
          };

          for (let index = 0; index < counts.length; index += 1) {
            const count = counts[index];
            if (count <= 0) continue;
            const q = scale === "log" ? Math.log1p(count) / logMax : count / max;
            const shade = Math.pow(q, 0.55);
            const color = colorAt(q);
            const offset = index * 4;
            image.data[offset] = color[0];
            image.data[offset + 1] = color[1];
            image.data[offset + 2] = color[2];
            image.data[offset + 3] = Math.max(12, Math.round(236 * shade));
          }
          offCtx.putImageData(image, 0, 0);

          ctx.save();
          ctx.beginPath();
          ctx.rect(pad.left, pad.top, plotW, plotH);
          ctx.clip();
          ctx.fillStyle = "#061014";
          ctx.fillRect(pad.left, pad.top, plotW, plotH);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(off, pad.left, pad.top, plotW, plotH);

          // Grid + axes
          ctx.strokeStyle = "rgba(155,196,188,.14)";
          ctx.lineWidth = 1;
          for (let i = 0; i <= 4; i += 1) {
            const x = pad.left + (plotW * i) / 4;
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, pad.top + plotH);
            ctx.stroke();
          }
          for (let i = 0; i <= 4; i += 1) {
            const y = pad.top + (plotH * i) / 4;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + plotW, y);
            ctx.stroke();
          }
          ctx.setLineDash([4, 5]);
          ctx.strokeStyle = "rgba(242,179,94,.35)";
          ctx.beginPath();
          ctx.moveTo(pad.left + plotW / 2, pad.top);
          ctx.lineTo(pad.left + plotW / 2, pad.top + plotH);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = "rgba(155,196,188,.5)";
          ctx.strokeRect(pad.left + 0.5, pad.top + 0.5, plotW - 1, plotH - 1);
          ctx.restore();

          ctx.fillStyle = "#6d8582";
          ctx.font = '9px "Cascadia Code", "Consolas", monospace';
          ctx.textAlign = "center";
          ctx.fillText("0 UI", pad.left, pad.top + plotH + 17);
          ctx.fillText("0.5 UI", pad.left + plotW / 2, pad.top + plotH + 17);
          ctx.fillText("1.0 UI", pad.left + plotW, pad.top + plotH + 17);
          ctx.textAlign = "right";
          const range = data.levelRange || [0, 1];
          const labels = [range[1], (range[0] + range[1]) / 2, range[0]];
          labels.forEach((value, index) => {
            const y = pad.top + (plotH * index) / 2;
            ctx.fillText(Number(value).toExponential(2), pad.left - 8, y + 3);
          });

          // Level histogram (right)
          const hist = data.histogram;
          if (hist && hist.values) {
            const hx = pad.left + plotW + 12;
            const hw = width - hx - 22;
            const hh = plotH;
            ctx.strokeStyle = "rgba(155,196,188,.22)";
            ctx.strokeRect(hx + 0.5, pad.top + 0.5, hw - 1, hh - 1);
            const hv = hist.values;
            const hmax = Math.max(1, ...hv);
            const count = hv.length;
            for (let i = 0; i < count; i += 1) {
              const value = hv[i];
              const bar = (value / hmax) * (hw - 6);
              const y = pad.top + hh - ((i + 1) / count) * hh;
              ctx.fillStyle = i > count * 0.72 ? "rgba(242,179,94,.55)" : "rgba(79,211,198,.42)";
              ctx.fillRect(hx + 3, y, Math.max(1, bar), Math.max(1, hh / count - 1));
            }
            ctx.save();
            ctx.translate(hx + hw - 2, pad.top + 12);
            ctx.rotate(Math.PI / 2);
            ctx.fillStyle = "#6d8582";
            ctx.font = '8px "Cascadia Code", "Consolas", monospace';
            ctx.textAlign = "left";
            ctx.fillText("LEVEL HISTOGRAM", 0, 0);
            ctx.restore();
          }

          // Corner marks
          ctx.strokeStyle = "rgba(242,179,94,.65)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pad.left, pad.top + 10);
          ctx.lineTo(pad.left, pad.top);
          ctx.lineTo(pad.left + 10, pad.top);
          ctx.moveTo(pad.left + plotW - 10, pad.top);
          ctx.lineTo(pad.left + plotW, pad.top);
          ctx.lineTo(pad.left + plotW, pad.top + 10);
          ctx.stroke();

          ctx.fillStyle = "#6d8582";
          ctx.font = '8px "Cascadia Code", "Consolas", monospace';
          ctx.textAlign = "left";
          ctx.fillText("FOLDED DENSITY · " + data.name, pad.left, 13);
        };

        const run = () => {
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        };
        run();
        if (typeof ResizeObserver === "function" && wrapRef.current) {
          const observer = new ResizeObserver(run);
          observer.observe(wrapRef.current);
          dispose = () => observer.disconnect();
        }
        return () => {
          if (raf) cancelAnimationFrame(raf);
          dispose();
        };
      }, [data, scale]);

      if (loading) {
        return h(
          "div",
          { className: "eoe-eye-canvas-wrap", ref: wrapRef, style: { display: "grid", placeItems: "center" } },
          h("div", { className: "eoe-loading", style: { flex: "0 0 auto" } }, h("div", { className: "eoe-loader" }), "FOLDING EYE CSV")
        );
      }
      if (error) {
        return h(
          "div",
          { className: "eoe-eye-canvas-wrap", ref: wrapRef, style: { display: "grid", placeItems: "center", padding: "20px" } },
          h("div", { className: "eoe-empty", style: { border: 0, maxWidth: "420px" } }, h(Icon, { name: "alert", size: 20 }), h("h3", null, "眼图解析失败"), h("p", null, error))
        );
      }
      if (!data) {
        return h(
          "div",
          { className: "eoe-eye-canvas-wrap", ref: wrapRef, style: { display: "grid", placeItems: "center" } },
          h("div", { className: "eoe-mini-note" }, "选择一份 Eye CSV 以绘制密度眼图。")
        );
      }
      return h(
        "div",
        { className: "eoe-eye-canvas-wrap", ref: wrapRef },
        h("canvas", { ref: canvasRef, role: "img", "aria-label": "Folded eye density diagram for " + data.name })
      );
    }

    // ---------------------------------------------------------------------
    // Deck and modal
    // ---------------------------------------------------------------------

    function Deck(props) {
      const { preflight, preflightError, config, settings, setSettings, jobState, now, runs, selectedRun, onSelectRun, onRun, onCancel, cancelArmed, busy, onCopyCommand, onPreflight } = props;
      const progress = jobState?.progress || { percent: 0, label: "空闲" };
      const running = Boolean(jobState?.running);
      const status = overallStatus(jobState, null);
      const checks = preflight?.checks?.items || [];
      const warningCount = checks.filter((item) => !item.ok && item.level === "warn").length;
      return h(
        "aside",
        { className: "eoe-deck", "aria-label": "Run deck" },
        h(
          "div",
          { className: "eoe-rail-head" },
          h("span", null, "RUN DECK"),
          h("b", null, running ? "LIVE" : "STANDBY")
        ),
        h(
          "div",
          { className: "eoe-run-control" },
          h(
            "div",
            { className: cx("eoe-run-orb", running ? "running" : jobState?.job?.status === "succeeded" ? "ok" : jobState?.job?.status ? "bad" : "") },
            h(Icon, { name: running ? "wave" : jobState?.job?.status === "succeeded" ? "check" : "terminal", size: 17 })
          ),
          h(
            "div",
            { className: "eoe-run-orb-copy" },
            h("div", { className: "eoe-run-orb-title" }, running ? progress.label : status.label),
            h("div", { className: "eoe-run-orb-sub" }, running ? fmtDuration(elapsedMs(jobState?.job, now)) + " elapsed" : settings.short ? "SHORT SMOKE ARMED" : "FULL LINK READY")
          ),
          h(
            "div",
            { className: "eoe-progress", style: { flex: "0 0 54px", margin: 0 } },
            h("div", { className: "eoe-progress-bar", style: { width: percent(progress.percent) + "%" } })
          )
        ),
        h(
          "div",
          { className: "eoe-deck-card" },
          h("div", { className: "eoe-deck-title" }, "LAUNCH", h("b", null, preflight?.ok ? "READY" : "CHECK")),
          running
            ? h(
                Btn,
                { variant: "danger", size: "big", icon: "stop", onClick: onCancel, disabled: busy },
                cancelArmed ? "再次点击确认" : "取消运行"
              )
            : h(
                Btn,
                { variant: "primary", size: "big", icon: "play", onClick: onRun, disabled: busy || !preflight?.ok },
                settings.short ? "运行短冒烟" : "运行完整链路"
              ),
          h(
            "div",
            { className: "eoe-launch-meta", style: { marginTop: "8px" } },
            h("span", null, "FROM-PHASE " + String(settings.fromPhase)),
            h("span", null, preflight?.ok ? "PASS" : "BLOCKED")
          ),
          h(
            "div",
            { className: "eoe-toggle-row", style: { marginTop: "9px" } },
            h(Toggle, {
              label: "短冒烟",
              description: "跳过 P3",
              checked: settings.short,
              onChange: (checked) => setSettings((current) => ({ ...current, short: checked }))
            }),
            h(Toggle, {
              label: "无 TDECQ",
              description: "--no-tdecq",
              checked: settings.noTdecq,
              onChange: (checked) => setSettings((current) => ({ ...current, noTdecq: checked }))
            })
          ),
          h(
            "div",
            { className: "eoe-command", style: { marginTop: "8px" } },
            preflight?.command?.preview || preflightError || "等待预检…"
          ),
          h(
            "div",
            { className: "eoe-actions", style: { marginTop: "8px" } },
            h(Btn, { className: "ghost", icon: "copy", onClick: onCopyCommand, disabled: !preflight?.command }, "复制"),
            h(Btn, { className: "ghost", icon: "refresh", onClick: onPreflight }, "重检")
          )
        ),
        h(
          "div",
          { className: "eoe-deck-card" },
          h(
            "div",
            { className: "eoe-deck-title" },
            "PREFLIGHT",
            h("b", null, preflight ? (preflight.ok ? "PASS" : "BLOCK") : "WAIT")
          ),
          checks.length === 0
            ? h("div", { className: "eoe-mini-note" }, preflightError || "正在检查路径 / ADS / AMI / 模板…")
            : h(
                "div",
                { className: "eoe-preflight-list" },
                checks.map((item, index) =>
                  h(
                    "div",
                    { className: cx("eoe-preflight-item", item.ok ? "ok" : item.level), key: index },
                    h("span", { className: "eoe-preflight-dot" }),
                    h(
                      "div",
                      null,
                      h("div", { className: "eoe-preflight-label" }, item.label),
                      h("div", { className: "eoe-preflight-detail", title: item.detail }, shortPath(item.detail, 58))
                    )
                  )
                )
              ),
          h(
            "div",
            { className: "eoe-launch-meta", style: { marginTop: "8px" } },
            h("span", null, "WARN " + String(warningCount)),
            h("span", null, "ERROR " + String(preflight?.checks?.errors ?? preflight?.errors ?? 0))
          )
        ),
        h(
          "div",
          { className: "eoe-deck-card" },
          h("div", { className: "eoe-deck-title" }, "TARGET", h("b", null, "RUN-DIR")),
          h(
            "div",
            { className: "eoe-run-meta" },
            h("div", { className: "eoe-kv" }, h("span", null, "RESULTS"), h("b", { className: "eoe-mono", style: { fontSize: "8px" } }, shortPath(config.paths?.results_root || "—", 36))),
            h("div", { className: "eoe-kv" }, h("span", null, "PHASE2"), h("b", { className: "eoe-mono" }, String(config.phase2?.n_ui ?? "—") + " UI")),
            h("div", { className: "eoe-kv" }, h("span", null, "PHASE3"), h("b", { className: "eoe-mono" }, String(config.phase3?.measured || "auto")))
          )
        ),
        h(
          "div",
          { className: "eoe-deck-card" },
          h("div", { className: "eoe-deck-title" }, "RECENT", h("b", null, String(runs.length))),
          runs.length === 0
            ? h("div", { className: "eoe-mini-note" }, "还没有 run-dir。")
            : h(
                "div",
                { className: "eoe-run-list" },
                runs.slice(0, 6).map((run) =>
                  h(
                    "button",
                    {
                      key: run.path,
                      type: "button",
                      className: cx("eoe-run-item", selectedRun === run.path ? "selected" : ""),
                      onClick: () => onSelectRun(run.path),
                      title: run.path
                    },
                    h("span", { className: cx("eoe-run-dot", run.ok ? "ok" : "bad") }),
                    h("span", { className: "eoe-run-name" }, run.name),
                    h("span", { className: "eoe-run-time" }, run.short ? "SHORT" : "FULL")
                  )
                )
              )
        )
      );
    }

    function PreviewModal(props) {
      const { preview, loading, onClose } = props;
      return h(
        "div",
        {
          className: "eoe-modal-overlay",
          role: "presentation",
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose();
          }
        },
        h(
          "div",
          { className: "eoe-modal", role: "dialog", "aria-modal": "true", "aria-label": "产物预览" },
          h(
            "div",
            { className: "eoe-modal-head" },
            h(
              "div",
              { className: "eoe-modal-title" },
              preview.artifact?.name || "Preview",
              h("div", { className: "eoe-modal-path" }, preview.artifact?.path || "")
            ),
            h(Btn, { className: "icon", icon: "close", onClick: onClose, title: "关闭" })
          ),
          h(
            "div",
            { className: "eoe-modal-body" },
            preview.mode === "image"
              ? h("img", { src: preview.url, alt: preview.artifact?.name || "artifact" })
              : h("pre", null, loading ? "读取中…" : preview.text)
          ),
          h(
            "div",
            { className: "eoe-modal-foot" },
            h("span", null, fmtBytes(preview.artifact?.size) + " · " + (preview.artifact?.kind || "")),
            preview.mode === "image" || (preview.artifact && preview.artifact.size < 8 * 1024 * 1024)
              ? h(
                  "a",
                  {
                    className: "eoe-link-btn",
                    href: preview.url,
                    download: preview.artifact?.name,
                    target: "_blank",
                    rel: "noreferrer"
                  },
                  "下载 / 新窗口"
                )
              : null
          )
        )
      );
    }

    function Toast(props) {
      return h(
        "div",
        { className: cx("eoe-toast", props.toast.tone === "error" ? "error" : props.toast.tone === "ok" ? "ok" : ""), role: "status", "aria-live": "polite" },
        h("span", { className: "eoe-toast-dot" }),
        h("span", null, props.toast.message)
      );
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function PanelIcon(props) {
      const size = props && typeof props.size === "number" ? props.size : 18;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.65,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false"
        },
        h("circle", { cx: 12, cy: 12, r: 8.3, opacity: 0.4 }),
        h("circle", { cx: 12, cy: 12, r: 4.1, opacity: 0.7 }),
        h("path", { d: "M2.5 12h3.2l1.8-4 2.7 8 2.6-10 2.4 8 1.5-2h4.8" }),
        h("circle", { cx: 21.5, cy: 12, r: 1.1, fill: "currentColor", stroke: "none" })
      );
    }

    function apply(ctx) {
      injectStyles();
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          { name: "main", key: PANEL_ID },
          WorkbenchPage
        )
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 31, label: () => "EOE 工作台" },
          PanelIcon
        )
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
