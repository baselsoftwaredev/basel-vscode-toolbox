import * as vscode from 'vscode';
import { splitEditorRightLimited } from './commands/split-editor';

export function activate(context: vscode.ExtensionContext) {
  // Register splitEditorRightLimited command
  const splitEditorDisposable = vscode.commands.registerCommand(
    'extension.splitEditorRightLimited',
    () => splitEditorRightLimited()
  );

  context.subscriptions.push(splitEditorDisposable);
}

export function deactivate() {}