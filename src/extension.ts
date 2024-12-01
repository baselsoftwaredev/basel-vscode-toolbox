import * as vscode from 'vscode'

export function activate (context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('extension.splitEditorRightLimited', () => {
    const editorGroups = vscode.window.tabGroups.all
    const activeGroup = vscode.window.tabGroups.activeTabGroup

    if (editorGroups.length < 2) {
      vscode.commands.executeCommand('workbench.action.splitEditorRight')
    } else if (activeGroup.viewColumn === vscode.ViewColumn.Two) {
      vscode.commands.executeCommand('workbench.action.moveEditorToFirstGroup')
    } else {
      vscode.window.showInformationMessage('You can only have up to 2 editor groups.')
    }
  })

  context.subscriptions.push(disposable)
}

export function deactivate () { }
