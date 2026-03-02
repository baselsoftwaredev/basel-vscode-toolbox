import * as vscode from 'vscode'
import { ShelfManager } from './ShelfManager'
import { ShelvesProvider, ShelfItem } from './ShelvesProvider'

export function registerShelveCommands (
  context: vscode.ExtensionContext,
  shelfManager: ShelfManager,
  provider: ShelvesProvider
): void {
  // ── Shelve Changes ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('toolbox.shelveChanges', async () => {
      if (!shelfManager.hasChanges()) {
        vscode.window.showInformationMessage(
          'No changes to shelve. Ensure you have modified or new files in your workspace.'
        )
        return
      }

      const { tracked, untracked } = shelfManager.getChangedFiles()
      const allFiles = [...tracked, ...untracked]

      // Show file picker with multi-select
      const selected = await vscode.window.showQuickPick(
        allFiles.map((file) => ({
          label: file,
          picked: true
        })),
        {
          title: 'Select Files to Shelve',
          placeHolder: 'Choose which files to shelve (all selected by default)',
          canPickMany: true
        }
      )

      if (!selected || selected.length === 0) {
        vscode.window.showInformationMessage('No files selected.')
        return
      }

      const selectedFiles = selected.map((item) => item.label)

      const name = await vscode.window.showInputBox({
        title: 'Shelve Changes',
        prompt: 'Enter a name for this shelf',
        placeHolder: 'e.g. WIP: new login flow',
        validateInput: (v) =>
          v.trim().length === 0 ? 'Name cannot be empty.' : undefined
      })
      if (name === undefined) return // user cancelled

      const description = await vscode.window.showInputBox({
        title: 'Shelf Description (optional)',
        prompt: 'Add an optional description',
        placeHolder: 'Leave blank to skip'
      })

      try {
        const shelf = await shelfManager.shelveChanges(
          name.trim(),
          description?.trim() || undefined,
          selectedFiles
        )
        provider.refresh()
        vscode.window.showInformationMessage(
          `Shelved "${shelf.name}" (${shelf.files.length} file${shelf.files.length === 1 ? '' : 's'})`
        )
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to shelve: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })
  )

  // ── Unshelve (apply + keep) ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'toolbox.unshelveChanges',
      async (item?: ShelfItem) => {
        const shelf = item?.shelf ?? (await pickShelf(shelfManager))
        if (!shelf) return

        try {
          await shelfManager.unshelveChanges(shelf)
          provider.refresh()
          vscode.window.showInformationMessage(
            `Unshelved "${shelf.name}" — changes applied to working tree.`
          )
        } catch (err: unknown) {
          vscode.window.showErrorMessage(
            `Failed to unshelve: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    )
  )

  // ── Unshelve and Delete ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'toolbox.unshelveAndDelete',
      async (item?: ShelfItem) => {
        const shelf = item?.shelf ?? (await pickShelf(shelfManager))
        if (!shelf) return

        try {
          await shelfManager.unshelveChanges(shelf)
          shelfManager.deleteShelf(shelf.id)
          provider.refresh()
          vscode.window.showInformationMessage(
            `Unshelved and removed "${shelf.name}".`
          )
        } catch (err: unknown) {
          vscode.window.showErrorMessage(
            `Failed: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    )
  )

  // ── Delete Shelf ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'toolbox.deleteShelf',
      async (item?: ShelfItem) => {
        const shelf = item?.shelf ?? (await pickShelf(shelfManager))
        if (!shelf) return

        const confirm = await vscode.window.showWarningMessage(
          `Delete shelf "${shelf.name}"? This cannot be undone.`,
          { modal: true },
          'Delete'
        )
        if (confirm !== 'Delete') return

        shelfManager.deleteShelf(shelf.id)
        provider.refresh()
        vscode.window.showInformationMessage(`Shelf "${shelf.name}" deleted.`)
      }
    )
  )

  // ── Rename Shelf ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'toolbox.renameShelf',
      async (item?: ShelfItem) => {
        const shelf = item?.shelf ?? (await pickShelf(shelfManager))
        if (!shelf) return

        const newName = await vscode.window.showInputBox({
          title: 'Rename Shelf',
          value: shelf.name,
          validateInput: (v) =>
            v.trim().length === 0 ? 'Name cannot be empty.' : undefined
        })
        if (newName === undefined) return

        try {
          shelfManager.renameShelf(shelf.id, newName.trim())
          provider.refresh()
        } catch (err: unknown) {
          vscode.window.showErrorMessage(
            `Failed to rename: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    )
  )

  // ── View Patch ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'toolbox.viewShelfPatch',
      async (item?: ShelfItem) => {
        const shelf = item?.shelf ?? (await pickShelf(shelfManager))
        if (!shelf) return

        const patch = shelfManager.getPatchContent(shelf.id)
        if (!patch) {
          vscode.window.showErrorMessage('Patch file not found.')
          return
        }

        const doc = await vscode.workspace.openTextDocument({
          content: patch,
          language: 'diff'
        })
        await vscode.window.showTextDocument(doc, { preview: true })
      }
    )
  )

  // ── Refresh ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('toolbox.refreshShelves', () => {
      provider.refresh()
    })
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function pickShelf (shelfManager: ShelfManager) {
  const shelves = shelfManager.getShelves()
  if (shelves.length === 0) {
    vscode.window.showInformationMessage('No shelves found.')
    return undefined
  }

  const picked = await vscode.window.showQuickPick(
    shelves.map((s) => ({
      label: s.name,
      description: new Date(s.createdAt).toLocaleString(),
      detail: s.files.join(', '),
      shelf: s
    })),
    { title: 'Select a Shelf', placeHolder: 'Choose a shelf' }
  )

  return picked?.shelf
}
