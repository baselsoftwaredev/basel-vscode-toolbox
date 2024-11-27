import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.splitEditorRightLimited', () => {
        const editorGroups = vscode.window.tabGroups.all;
        if (editorGroups.length < 2) {
            vscode.commands.executeCommand('workbench.action.splitEditorRight');
        } else {
            vscode.window.showInformationMessage('You can only have up to 2 editor groups.');
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }