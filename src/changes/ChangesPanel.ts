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

    // Resolve icon theme extension root so the webview can load SVGs from it
    const themeExtRoot = this.getIconThemeExtensionRoot()
    const localResourceRoots: vscode.Uri[] = [
      this.context.extensionUri,
      // Allow loading @vscode-elements/elements bundled.js from node_modules
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')
    ]
    if (themeExtRoot) localResourceRoots.push(vscode.Uri.file(themeExtRoot))

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots
    }

    const bundledUri = webviewView.webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          'node_modules',
          '@vscode-elements',
          'elements',
          'dist',
          'bundled.js'
        )
      )
      .toString()

    const iconMap = this.buildIconMap(webviewView.webview)
    webviewView.webview.html = this.getHtml(iconMap, bundledUri)

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

  // ─── Icon theme resolution ────────────────────────────────────────────────────

  /** Returns the filesystem root of the extension providing the active icon theme, or undefined. */
  private getIconThemeExtensionRoot (): string | undefined {
    try {
      const themeId = vscode.workspace
        .getConfiguration('workbench')
        .get<string>('iconTheme')
      if (!themeId) return undefined
      for (const ext of vscode.extensions.all) {
        const themes = ext.packageJSON?.contributes?.iconThemes
        if (!Array.isArray(themes)) continue
        if (themes.some((t: Record<string, unknown>) => t.id === themeId)) {
          return ext.extensionPath
        }
      }
    } catch {
      /* ignore */
    }
    return undefined
  }

  /**
   * Builds a map of lowercased file extension → webview URI string for the
   * icons defined by the active VS Code file icon theme.
   * Falls back to an empty map if the theme is unavailable or uses a font.
   */
  private buildIconMap (webview: vscode.Webview): Record<string, string> {
    try {
      const themeId = vscode.workspace
        .getConfiguration('workbench')
        .get<string>('iconTheme')
      if (!themeId) return {}

      let themePath: string | undefined
      let extPath: string | undefined

      for (const ext of vscode.extensions.all) {
        const themes = ext.packageJSON?.contributes?.iconThemes
        if (!Array.isArray(themes)) continue
        const match = (themes as Array<Record<string, string>>).find(
          (t) => t.id === themeId
        )
        if (match) {
          extPath = ext.extensionPath
          themePath = path.join(ext.extensionPath, match.path)
          break
        }
      }

      if (!extPath || !themePath || !fs.existsSync(themePath)) return {}

      const themeDir = path.dirname(themePath)
      const data = JSON.parse(fs.readFileSync(themePath, 'utf8')) as {
        iconDefinitions: Record<string, { iconPath?: string }>;
        fileExtensions?: Record<string, string>;
        fileNames?: Record<string, string>;
        file?: string;
        light?: {
          fileExtensions?: Record<string, string>;
          fileNames?: Record<string, string>;
          file?: string;
        };
      }

      const isDark =
        vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light
      const defs = data.iconDefinitions

      const toUri = (defId: string): string | undefined => {
        const iconPath = defs[defId]?.iconPath
        if (!iconPath) return undefined
        const full = path.resolve(themeDir, iconPath)
        if (!fs.existsSync(full)) return undefined
        return webview.asWebviewUri(vscode.Uri.file(full)).toString()
      }

      const result: Record<string, string> = {}

      // Merge base + light/dark overrides
      const extMap: Record<string, string> = {
        ...(data.fileExtensions ?? {}),
        ...(!isDark ? (data.light?.fileExtensions ?? {}) : {})
      }
      const nameMap: Record<string, string> = {
        ...(data.fileNames ?? {}),
        ...(!isDark ? (data.light?.fileNames ?? {}) : {})
      }

      for (const [ext, defId] of Object.entries(extMap)) {
        const uri = toUri(defId)
        if (uri) result[`ext:${ext.toLowerCase()}`] = uri
      }

      for (const [name, defId] of Object.entries(nameMap)) {
        const uri = toUri(defId)
        if (uri) result[`name:${name.toLowerCase()}`] = uri
      }

      // Default file icon fallback
      const defaultDefId =
        (!isDark ? data.light?.file : undefined) ?? data.file
      if (defaultDefId) {
        const uri = toUri(defaultDefId)
        if (uri) result.__default__ = uri
      }

      return result
    } catch {
      return {}
    }
  }

  private postError (message: string): void {
    this.view?.webview.postMessage({ type: 'error', message })
  }

  private postSuccess (message: string): void {
    this.view?.webview.postMessage({ type: 'success', message })
  }

  // ─── HTML ─────────────────────────────────────────────────────────────────────

  /**
   * Loads media/changesPanel.html from disk and substitutes runtime tokens:
   *   {{CSP_SOURCE}}  – webview.cspSource
   *   {{BUNDLED_URI}} – @vscode-elements/elements dist/bundled.js webview URI
   *   {{CSS_URI}}     – media/changesPanel.css webview URI
   *   {{SCRIPT_URI}}  – media/changesPanel.js webview URI
   *   {{ICON_MAP}}    – JSON-serialised active icon-theme SVG URI map
   */
  private getHtml (
    iconMap: Record<string, string> = {},
    bundledUri = ''
  ): string {
    const mediaDir = vscode.Uri.joinPath(this.context.extensionUri, 'media')
    const webview = this.view!.webview

    const htmlPath = vscode.Uri.joinPath(mediaDir, 'changesPanel.html').fsPath
    let html = fs.readFileSync(htmlPath, 'utf8')

    const cssUri = webview
      .asWebviewUri(vscode.Uri.joinPath(mediaDir, 'changesPanel.css'))
      .toString()
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(mediaDir, 'changesPanel.js'))
      .toString()

    html = html
      .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
      .replace(/\{\{BUNDLED_URI\}\}/g, bundledUri)
      .replace(/\{\{CSS_URI\}\}/g, cssUri)
      .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri)
      .replace(/\{\{ICON_MAP\}\}/g, JSON.stringify(iconMap))

    return html
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
