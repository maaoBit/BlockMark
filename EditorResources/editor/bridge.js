// BlockMark — JS↔原生桥（异步走 WKScriptMessage，同步走 prompt 拦截）
const handlers = {};

window.Bridge = {
  register(name, fn) { handlers[name] = fn; },
  // JS → 原生（异步；浏览器调试环境下为 no-op）
  call(name, data) {
    if (window.webkit?.messageHandlers?.bridge) {
      window.webkit.messageHandlers.bridge.postMessage({ name, data: data ?? null });
    } else {
      console.debug("[bridge:noop]", name);
    }
  },
  // JS → 原生（同步，原生端拦截 prompt("__bridge__") 返回 JSON 字符串）
  callSync(name, data) {
    const res = prompt("__bridge__", JSON.stringify({ name, data: data ?? null }));
    if (!res) return null;
    try { return JSON.parse(res); } catch { return null; }
  },
  // 原生 → JS（原生端 evaluateJavaScript 调用）
  dispatch(name, data) {
    const h = handlers[name];
    if (!h) { console.warn("BlockMark bridge: no handler for", name); return null; }
    return h(data);
  },
};

// 统一错误上报：原生 NSLog + 页面可见浮层（WebKit 里 console 不可见时的诊断通道）
window.addEventListener("error", e => {
  try {
    const d = document.createElement("div");
    d.className = "bm-toast bm-toast-show";
    d.style.opacity = "1";
    d.textContent = "JS Error: " + e.message + " @" + (e.lineno || "?");
    (document.body || document.documentElement).appendChild(d);
  } catch (_) { /* 忽略 */ }
  Bridge.call("logger.debug", { level: "error", msg: String(e.message), at: e.filename + ":" + e.lineno });
});
window.addEventListener("unhandledrejection", e => {
  Bridge.call("logger.debug", { level: "error", msg: "unhandled: " + String(e.reason) });
});
