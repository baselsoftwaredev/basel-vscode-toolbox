import * as vscode from 'vscode'
import { ShelfManager, Shelf } from './ShelfManager'

// ─── Tree items ───────────────────────────────────────────────────────────────

export class ShelfItem extends vscode.TreeItem {
  readonly shelf: Shelf

  constructor (shelf: Shelf) {
    super(shelf.name, vscode.TreeItemCollapsibleState.Collapsed)
    this.shelf = shelf
    this.contextValue = 'shelf'
    this.iconPath = new vscode.ThemeIcon('archive')
    this.description = new Date(shelf.createdAt).toLocaleString()
    this.tooltip = [
      `Name: ${shelf.name}`,
      `Created: ${new Date(shelf.createdAt).toLocaleString()}`,
      shelf.description ? `Note: ${shelf.description}` : '',
      `Files: ${shelf.files.length}`
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export class ShelfFileItem extends vscode.TreeItem {
  constructor (
    public readonly shelf: Shelf,
    public readonly filePath: string
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'shelfFile'
    this.iconPath = new vscode.ThemeIcon('file')
    this.description = ''
    this.command = {
      command: 'toolbox.viewShelfPatch',
      title: 'View Patch',
      arguments: [shelf]
    }
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class ShelvesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >()

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  // eslint-disable-next-line no-useless-constructor
  constructor (private readonly shelfManager: ShelfManager) {}

  refresh (): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem (element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren (element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      const shelves = this.shelfManager.getShelves()
      if (shelves.length === 0) {
        const empty = new vscode.TreeItem('No shelves yet')
        empty.iconPath = new vscode.ThemeIcon('info')
        return [empty]
      }
      return shelves.map((s) => new ShelfItem(s))
    }

    if (element instanceof ShelfItem) {
      return element.shelf.files.map(
        (f) => new ShelfFileItem(element.shelf, f)
      )
    }

    return []
  }
}
