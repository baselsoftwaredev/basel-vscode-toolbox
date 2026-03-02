// @ts-check
// Webview script for the Changes panel.
// Dynamic data (ICON_MAP) is injected by the HTML as window.__ICON_MAP__.

(function () {
  const vscode = acquireVsCodeApi();

  /** @type {Record<string, string>} */
  const ICON_MAP = window.__ICON_MAP__ || {};

  // ─── State ───────────────────────────────────────────────────────────────────
  let tracked = [];
  let untracked = [];

  // ─── Elements ────────────────────────────────────────────────────────────────
  const fileList = document.getElementById("fileList");
  const selectAll = document.getElementById("selectAll");
  const countBadge = document.getElementById("countBadge");
  const commitBtn = document.getElementById("commitBtn");
  const shelveBtn = document.getElementById("shelveBtn");
  const commitMsg = document.getElementById("commitMsg");
  const toast = document.getElementById("toast");
  const refreshBtn = document.getElementById("refreshBtn");

  // ─── Icon helpers ─────────────────────────────────────────────────────────────

  /** Fallback text-badge map when no icon theme SVG is available. */
  const FALLBACK_ICONS = {
    ts: ["TS", "#3178c6"],
    tsx: ["TS", "#3178c6"],
    js: ["JS", "#c8a800"],
    jsx: ["JS", "#c8a800"],
    mjs: ["JS", "#c8a800"],
    html: ["HT", "#e34c26"],
    css: ["CSS", "#563d7c"],
    scss: ["SC", "#c6538c"],
    json: ["{}", "#86a30f"],
    yaml: ["YML", "#86a30f"],
    yml: ["YML", "#86a30f"],
    md: ["MD", "#083fa1"],
    py: ["PY", "#3572a5"],
    go: ["GO", "#00add8"],
    rs: ["RS", "#dea584"],
    java: ["JV", "#b07219"],
    kt: ["KT", "#a97bff"],
    rb: ["RB", "#701516"],
    cs: ["C#", "#178600"],
    c: ["C", "#555555"],
    cpp: ["C++", "#f34b7d"],
    sh: ["SH", "#4eaa25"],
    svg: ["SVG", "#ff9800"],
  };

  /**
   * Returns an <img> from the active icon theme, or a coloured text <span> fallback.
   * @param {string} filename
   * @returns {HTMLElement}
   */
  function makeIconElement(filename) {
    const base = filename.split("/").pop();
    const ext = (base.includes(".") ? base.split(".").pop() : "").toLowerCase();
    const uri =
      ICON_MAP["name:" + base.toLowerCase()] ||
      ICON_MAP["ext:" + ext] ||
      ICON_MAP["__default__"];

    if (uri) {
      const img = document.createElement("img");
      img.className = "file-type-icon";
      img.src = uri;
      img.alt = ext;
      return img;
    }

    const [label, bg] = FALLBACK_ICONS[ext] || ["FILE", "#6e6e6e"];
    const span = document.createElement("span");
    span.className = "file-type-icon-text";
    span.textContent = label;
    span.style.background = bg;
    return span;
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  function render() {
    const allFiles = [...tracked, ...untracked];
    fileList.innerHTML = "";

    if (allFiles.length === 0) {
      fileList.innerHTML =
        '<div class="empty-state">No changes in working tree.</div>';
      selectAll.checked = false;
      selectAll.indeterminate = false;
      updateButtons();
      return;
    }

    if (tracked.length > 0) {
      const hdr = document.createElement("div");
      hdr.className = "section-header";
      hdr.textContent = "Modified";
      fileList.appendChild(hdr);
      tracked.forEach((f) => fileList.appendChild(makeRow(f, "M")));
    }

    if (untracked.length > 0) {
      const hdr = document.createElement("div");
      hdr.className = "section-header";
      hdr.textContent = "Untracked";
      fileList.appendChild(hdr);
      untracked.forEach((f) => fileList.appendChild(makeRow(f, "U")));
    }

    updateSelectAllState();
    updateButtons();
  }

  /**
   * @param {string} file
   * @param {'M'|'U'} status
   * @returns {HTMLDivElement}
   */
  function makeRow(file, status) {
    const row = document.createElement("div");
    row.className = "file-row";

    const cb = document.createElement("vscode-checkbox");
    cb.setAttribute("checked", "");
    cb.dataset.file = file;
    cb.addEventListener("vsc-change", () => {
      updateSelectAllState();
      updateButtons();
    });

    const icon = makeIconElement(file);

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file;
    name.title = file;
    name.addEventListener("click", () => {
      vscode.postMessage({ type: "openFile", file });
    });

    const badge = document.createElement("vscode-badge");
    badge.className = "file-status-badge";
    badge.textContent = status;
    badge.style.setProperty(
      "--vscode-badge-background",
      status === "M" ? "#1a7a50" : "#1760a0",
    );

    row.appendChild(cb);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(badge);
    return row;
  }

  // ─── Selection helpers ────────────────────────────────────────────────────────

  function getSelectedFiles() {
    return [
      ...document.querySelectorAll(".file-row vscode-checkbox[data-file]"),
    ]
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.file);
  }

  function updateSelectAllState() {
    const checkboxes = [
      ...document.querySelectorAll(".file-row vscode-checkbox[data-file]"),
    ];
    if (checkboxes.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      countBadge.textContent = "0";
      return;
    }
    const checkedCount = checkboxes.filter((cb) => cb.checked).length;
    countBadge.textContent = `${checkedCount} / ${checkboxes.length}`;
    if (checkedCount === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
      selectAll.checked = true;
      selectAll.indeterminate = false;
    } else {
      selectAll.checked = false;
      selectAll.indeterminate = true;
    }
  }

  function updateButtons() {
    const has = getSelectedFiles().length > 0;
    if (has) {
      commitBtn.removeAttribute("disabled");
      shelveBtn.removeAttribute("disabled");
    } else {
      commitBtn.setAttribute("disabled", "");
      shelveBtn.setAttribute("disabled", "");
    }
  }

  // ─── Events ──────────────────────────────────────────────────────────────────

  selectAll.addEventListener("vsc-change", () => {
    const isChecked = selectAll.checked;
    document
      .querySelectorAll(".file-row vscode-checkbox[data-file]")
      .forEach((cb) => {
        if (isChecked) {
          cb.setAttribute("checked", "");
          cb.checked = true;
        } else {
          cb.removeAttribute("checked");
          cb.checked = false;
        }
      });
    updateSelectAllState();
    updateButtons();
  });

  commitBtn.addEventListener("click", () => {
    vscode.postMessage({
      type: "commit",
      files: getSelectedFiles(),
      message: commitMsg.value,
    });
  });

  shelveBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "shelve", files: getSelectedFiles() });
  });

  refreshBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  // ─── Messages from extension ─────────────────────────────────────────────────

  let toastTimer = null;

  function showToast(message, kind) {
    toast.textContent = message;
    toast.className = "toast visible " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = "toast";
    }, 4000);
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "update":
        tracked = msg.tracked || [];
        untracked = msg.untracked || [];
        render();
        if (msg.error) showToast(msg.error, "error");
        break;
      case "error":
        showToast(msg.message, "error");
        break;
      case "success":
        showToast(msg.message, "info");
        commitMsg.value = "";
        break;
    }
  });

  // Request initial data
  vscode.postMessage({ type: "refresh" });
})();
