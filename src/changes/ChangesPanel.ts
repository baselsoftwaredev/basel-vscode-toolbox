import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { ShelfManager } from '../shelves/ShelfManager'
import { ShelvesProvider } from '../shelves/ShelvesProvider'

// Messages sent from webview → extension
type WebviewMessage =
  | { type: 'commit'; files: string[]; message: string }
  | { type: 'shelve'; files: string[] }
  | { type: 'refresh' }
  | { type: 'openFile'; file: string };

export class ChangesPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'toolbox.changesView'

  private view?: vscode.WebviewView
  private watchers: vscode.Disposable[] = []

  // eslint-disable-next-line no-useless-constructor
  constructor (
    private readonly shelfManager: ShelfManager,
    private readonly shelvesProvider: ShelvesProvider,
    private readonly context: vscode.ExtensionContext
  ) {}

  resolveWebviewView (
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    }

    webviewView.webview.html = this.getHtml()

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'refresh':
          this.refresh()
          break

        case 'openFile':
          this.openFile(msg.file)
          break

        case 'commit':
          await this.handleCommit(msg.files, msg.message)
          break

        case 'shelve':
          await this.handleShelve(msg.files)
          break
      }
    })

    // Send initial data and watch for git changes
    this.refresh()
    this.startWatching()

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.refresh()
    })
  }

  // ─── Public ──────────────────────────────────────────────────────────────────

  refresh (): void {
    if (!this.view) return
    try {
      const { tracked, untracked } = this.shelfManager.getChangedFiles()
      this.view.webview.postMessage({ type: 'update', tracked, untracked })
    } catch (err) {
      this.view.webview.postMessage({
        type: 'update',
        tracked: [],
        untracked: [],
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  dispose (): void {
    this.watchers.forEach((w) => w.dispose())
    this.watchers = []
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private startWatching (): void {
    const root = this.shelfManager.getWorkspaceRoot()
    if (!root) return

    // Watch git index and HEAD so panel refreshes on external changes
    const gitDir = path.join(root, '.git')
    const watchTargets = [
      path.join(gitDir, 'index'),
      path.join(gitDir, 'HEAD')
    ]

    const fsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '{**/*,!.git/**}'),
      false,
      false,
      false
    )

    const debounced = debounce(() => this.refresh(), 500)
    this.watchers.push(
      fsWatcher.onDidChange(debounced),
      fsWatcher.onDidCreate(debounced),
      fsWatcher.onDidDelete(debounced),
      fsWatcher
    )

    // Also poll the git index for staged/unstaged changes every 2s
    if (watchTargets.every((t) => fs.existsSync(t))) {
      const stats: Record<string, number> = {}
      for (const t of watchTargets) {
        stats[t] = fs.statSync(t).mtimeMs
      }
      const interval = setInterval(() => {
        for (const target of watchTargets) {
          if (!fs.existsSync(target)) continue
          const mtime = fs.statSync(target).mtimeMs
          if (mtime !== stats[target]) {
            stats[target] = mtime
            this.refresh()
            break
          }
        }
      }, 2000)
      this.watchers.push({ dispose: () => clearInterval(interval) })
    }
  }

  private openFile (file: string): void {
    const root = this.shelfManager.getWorkspaceRoot()
    if (!root) return
    const fullPath = path.join(root, file)
    if (fs.existsSync(fullPath)) {
      vscode.workspace.openTextDocument(fullPath).then((doc) => {
        vscode.window.showTextDocument(doc, { preview: true })
      })
    }
  }

  private async handleCommit (files: string[], message: string): Promise<void> {
    if (!message.trim()) {
      this.postError('Commit message cannot be empty.')
      return
    }
    if (files.length === 0) {
      this.postError('No files selected to commit.')
      return
    }
    try {
      this.shelfManager.commitFiles(files, message)
      this.postSuccess(
        `Committed ${files.length} file${files.length === 1 ? '' : 's'}.`
      )
      this.refresh()
    } catch (err) {
      this.postError(err instanceof Error ? err.message : String(err))
    }
  }

  private async handleShelve (files: string[]): Promise<void> {
    if (files.length === 0) {
      this.postError('No files selected to shelve.')
      return
    }

    const name = await vscode.window.showInputBox({
      title: 'Shelve Changes',
      prompt: 'Enter a name for this shelf',
      placeHolder: 'e.g. WIP: refactor auth',
      validateInput: (v) =>
        v.trim().length === 0 ? 'Name cannot be empty.' : undefined
    })
    if (name === undefined) return

    const description = await vscode.window.showInputBox({
      title: 'Shelf Description (optional)',
      placeHolder: 'Leave blank to skip'
    })

    try {
      const shelf = await this.shelfManager.shelveChanges(
        name.trim(),
        description?.trim() || undefined,
        files
      )
      this.shelvesProvider.refresh()
      this.postSuccess(
        `Shelved "${shelf.name}" — ${shelf.files.length} file${shelf.files.length === 1 ? '' : 's'}.`
      )
      this.refresh()
    } catch (err) {
      this.postError(err instanceof Error ? err.message : String(err))
    }
  }

  private postError (message: string): void {
    this.view?.webview.postMessage({ type: 'error', message })
  }

  private postSuccess (message: string): void {
    this.view?.webview.postMessage({ type: 'success', message })
  }

  // ─── HTML ─────────────────────────────────────────────────────────────────────

  private getHtml (): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    padding: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    background: var(--vscode-sideBarSectionHeader-background);
    flex-shrink: 0;
  }
  .toolbar-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-sideBarTitle-foreground);
  }
  .toolbar-actions { display: flex; gap: 4px; }
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vscode-icon-foreground);
    padding: 2px 4px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    font-size: 14px;
    line-height: 1;
    opacity: 0.8;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }

  /* ── Select bar ── */
  .select-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }
  .select-bar label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    user-select: none;
  }
  .select-bar input[type=checkbox] { accent-color: var(--vscode-focusBorder); }
  .count-badge {
    margin-left: auto;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 10px;
    padding: 1px 6px;
  }

  /* ── File list ── */
  .file-list-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .section-header {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    padding: 6px 10px 2px;
    user-select: none;
  }
  .file-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    cursor: default;
    border-radius: 0;
  }
  .file-row:hover { background: var(--vscode-list-hoverBackground); }
  .file-row input[type=checkbox] {
    flex-shrink: 0;
    accent-color: var(--vscode-focusBorder);
    cursor: pointer;
  }
  .file-name {
    flex: 1;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .file-name:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
  .file-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 0px 4px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .badge-M { background: #1a7; color: #fff; }
  .badge-U { background: #17a; color: #fff; }

  .empty-state {
    padding: 20px 10px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }

  /* ── Bottom panel ── */
  .bottom-panel {
    flex-shrink: 0;
    border-top: 1px solid var(--vscode-panel-border);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  textarea {
    width: 100%;
    min-height: 52px;
    max-height: 120px;
    resize: vertical;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 5px 7px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    outline: none;
  }
  textarea:focus { border-color: var(--vscode-focusBorder); }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

  .action-row { display: flex; gap: 6px; }

  button.primary, button.secondary {
    flex: 1;
    padding: 5px 10px;
    border: none;
    border-radius: 2px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    cursor: pointer;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.primary:disabled { opacity: 0.4; cursor: not-allowed; }

  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.secondary:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Toast ── */
  .toast {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 2px;
    display: none;
  }
  .toast.visible { display: block; }
  .toast.error {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
  }
  .toast.info {
    background: var(--vscode-inputValidation-infoBackground);
    border: 1px solid var(--vscode-inputValidation-infoBorder);
    color: var(--vscode-inputValidation-infoForeground, var(--vscode-foreground));
  }
</style>
</head>
<body>

<div class="toolbar">
  <span class="toolbar-title">Changes</span>
  <div class="toolbar-actions">
    <button class="icon-btn" id="refreshBtn" title="Refresh">↻</button>
  </div>
</div>

<div class="select-bar">
  <label>
    <input type="checkbox" id="selectAll" title="Select / deselect all" />
    All
  </label>
  <span class="count-badge" id="countBadge">0</span>
</div>

<div class="file-list-wrap" id="fileList">
  <div class="empty-state">Loading…</div>
</div>

<div class="bottom-panel">
  <textarea id="commitMsg" placeholder="Commit message…" rows="3"></textarea>
  <div class="action-row">
    <button class="primary" id="commitBtn" disabled>Commit</button>
    <button class="secondary" id="shelveBtn" disabled>Shelve…</button>
  </div>
  <div class="toast" id="toast"></div>
</div>

<script>
  const vscode = acquireVsCodeApi();

  // ─── State ───────────────────────────────────────────────────────────────────
  let tracked = [];
  let untracked = [];

  // ─── Elements ────────────────────────────────────────────────────────────────
  const fileList   = document.getElementById('fileList');
  const selectAll  = document.getElementById('selectAll');
  const countBadge = document.getElementById('countBadge');
  const commitBtn  = document.getElementById('commitBtn');
  const shelveBtn  = document.getElementById('shelveBtn');
  const commitMsg  = document.getElementById('commitMsg');
  const toast      = document.getElementById('toast');
  const refreshBtn = document.getElementById('refreshBtn');

  // ─── Render ──────────────────────────────────────────────────────────────────
  function render() {
    const allFiles = [...tracked, ...untracked];
    fileList.innerHTML = '';

    if (allFiles.length === 0) {
      fileList.innerHTML = '<div class="empty-state">No changes in working tree.</div>';
      selectAll.checked = false;
      selectAll.indeterminate = false;
      updateButtons();
      return;
    }

    if (tracked.length > 0) {
      const hdr = document.createElement('div');
      hdr.className = 'section-header';
      hdr.textContent = 'Modified';
      fileList.appendChild(hdr);
      tracked.forEach(f => fileList.appendChild(makeRow(f, 'M')));
    }

    if (untracked.length > 0) {
      const hdr = document.createElement('div');
      hdr.className = 'section-header';
      hdr.textContent = 'Untracked';
      fileList.appendChild(hdr);
      untracked.forEach(f => fileList.appendChild(makeRow(f, 'U')));
    }

    updateSelectAllState();
    updateButtons();
  }

  function makeRow(file, status) {
    const row = document.createElement('div');
    row.className = 'file-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.file = file;
    cb.addEventListener('change', () => {
      updateSelectAllState();
      updateButtons();
    });

    const badge = document.createElement('span');
    badge.className = 'file-badge badge-' + status;
    badge.textContent = status;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file;
    name.title = file;
    name.addEventListener('click', () => {
      vscode.postMessage({ type: 'openFile', file });
    });

    row.appendChild(cb);
    row.appendChild(badge);
    row.appendChild(name);
    return row;
  }

  function getSelectedFiles() {
    return [...document.querySelectorAll('.file-row input[type=checkbox]:checked')]
      .map(cb => cb.dataset.file);
  }

  function updateSelectAllState() {
    const checkboxes = [...document.querySelectorAll('.file-row input[type=checkbox]')];
    if (checkboxes.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      countBadge.textContent = '0';
      return;
    }
    const checkedCount = checkboxes.filter(cb => cb.checked).length;
    countBadge.textContent = String(checkedCount) + ' / ' + checkboxes.length;
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
    const selected = getSelectedFiles();
    const hasSelection = selected.length > 0;
    commitBtn.disabled = !hasSelection;
    shelveBtn.disabled = !hasSelection;
  }

  // ─── Events ──────────────────────────────────────────────────────────────────
  selectAll.addEventListener('change', () => {
    const checkboxes = document.querySelectorAll('.file-row input[type=checkbox]');
    checkboxes.forEach(cb => { cb.checked = selectAll.checked; });
    updateSelectAllState();
    updateButtons();
  });

  commitBtn.addEventListener('click', () => {
    const files = getSelectedFiles();
    const message = commitMsg.value;
    vscode.postMessage({ type: 'commit', files, message });
  });

  shelveBtn.addEventListener('click', () => {
    const files = getSelectedFiles();
    vscode.postMessage({ type: 'shelve', files });
  });

  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });

  // ─── Messages from extension ─────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(message, kind) {
    toast.textContent = message;
    toast.className = 'toast visible ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4000);
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'update':
        tracked = msg.tracked || [];
        untracked = msg.untracked || [];
        render();
        if (msg.error) showToast(msg.error, 'error');
        break;
      case 'error':
        showToast(msg.message, 'error');
        break;
      case 'success':
        showToast(msg.message, 'info');
        commitMsg.value = '';
        break;
    }
  });

  // Request initial load
  vscode.postMessage({ type: 'refresh' });
</script>
</body>
</html>`
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function debounce (fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>
  return () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}
