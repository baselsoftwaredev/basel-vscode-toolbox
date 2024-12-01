import * as assert from 'assert'
import * as vscode from 'vscode'
import { suite, test } from 'mocha'

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.')

  test('Split Editor Right Limited Command', async () => {
    // Activate the extension
    await vscode.commands.executeCommand('extension.splitEditorRightLimited')

    // Get the active editor group
    const activeGroup = vscode.window.tabGroups.activeTabGroup

    // Check if the command executed correctly
    if (vscode.window.tabGroups.all.length < 2) {
      assert.strictEqual(vscode.window.tabGroups.all.length, 2, 'Should have split the editor into two groups')
    } else if (activeGroup.viewColumn === vscode.ViewColumn.Two) {
      assert.strictEqual(activeGroup.viewColumn, vscode.ViewColumn.One, 'Should have moved the editor to the first group')
    } else {
      assert.fail('Unexpected state')
    }
  })
})
