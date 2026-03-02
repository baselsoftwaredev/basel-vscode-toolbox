import * as vscode from 'vscode'
import { splitEditorRightLimited } from './commands/split-editor'
import { ShelfManager } from './shelves/ShelfManager'
import { ShelvesProvider } from './shelves/ShelvesProvider'
import { registerShelveCommands } from './shelves/shelveCommands'
import { ChangesPanel } from './changes/ChangesPanel'

export function activate (context: vscode.ExtensionContext) {
  // ── Split editor command ────────────────────────────────────────────────────
  const splitEditorDisposable = vscode.commands.registerCommand(
    'extension.splitEditorRightLimited',
    () => splitEditorRightLimited()
  )
  context.subscriptions.push(splitEditorDisposable)

  // ── Shelves feature ─────────────────────────────────────────────────────────
  const shelfManager = new ShelfManager(context)
  const shelvesProvider = new ShelvesProvider(shelfManager)

  vscode.window.createTreeView('toolbox.shelvesView', {
    treeDataProvider: shelvesProvider,
    showCollapseAll: true
  })

  registerShelveCommands(context, shelfManager, shelvesProvider)

  // ── Changes panel (integrated commit + shelve view) ─────────────────────────
  const changesPanel = new ChangesPanel(shelfManager, shelvesProvider, context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChangesPanel.viewId,
      changesPanel,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolbox.refreshChangesPanel', () => {
      changesPanel.refresh()
    })
  )
}

export function deactivate () {}
