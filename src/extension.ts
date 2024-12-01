import * as vscode from 'vscode'

export function activate (context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('extension.splitEditorRightLimited', async () => {
    const editorGroups = vscode.window.tabGroups.all
    const activeGroup = vscode.window.tabGroups.activeTabGroup

    if (editorGroups.length < 2) {
      await vscode.commands.executeCommand('workbench.action.splitEditorRight')
    } else if (activeGroup.viewColumn === vscode.ViewColumn.Two) {
      await vscode.commands.executeCommand('moveActiveEditor', { to: 'left', by: 'group', value: 1 })
    } else if (activeGroup.viewColumn === vscode.ViewColumn.One) {
      await vscode.commands.executeCommand('moveActiveEditor', { to: 'right', by: 'group', value: 1 })
    } else {
      vscode.window.showInformationMessage('You can only have up to 2 editor groups.')
    }
  })

  context.subscriptions.push(disposable)
}

export function deactivate () { }
