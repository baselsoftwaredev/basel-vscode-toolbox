import * as vscode from 'vscode'

export function activate (context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('extension.splitEditorRightLimited', async () => {
    const editorGroups = vscode.window.tabGroups.all
    const activeGroup = vscode.window.tabGroups.activeTabGroup
    const activeEditor = vscode.window.activeTextEditor

    if (!activeEditor) {
      vscode.window.showInformationMessage('No active editor found.')
      return
    }

    if (editorGroups.length < 2) {
      await vscode.commands.executeCommand('workbench.action.splitEditorRight')
    } else if (activeGroup.viewColumn === vscode.ViewColumn.Two) {
      await vscode.window.showTextDocument(activeEditor.document, vscode.ViewColumn.One)
    } else if (activeGroup.viewColumn === vscode.ViewColumn.One) {
      await vscode.window.showTextDocument(activeEditor.document, vscode.ViewColumn.Two)
    } else {
      vscode.window.showInformationMessage('You can only have up to 2 editor groups.')
    }
  })

  context.subscriptions.push(disposable)
}

export function deactivate () { }
