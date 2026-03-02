import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'

export interface Shelf {
  id: string;
  name: string;
  createdAt: string;
  files: string[];
  description?: string;
}

export class ShelfManager {
  private storageDir: string

  constructor (private context: vscode.ExtensionContext) {
    const storageUri = context.storageUri ?? context.globalStorageUri
    this.storageDir = path.join(storageUri.fsPath, 'shelves')
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  getWorkspaceRoot (): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  }

  private runGit (args: string, cwd?: string): string {
    const root = cwd ?? this.getWorkspaceRoot()
    if (!root) throw new Error('No workspace folder found')
    return execSync(`git ${args}`, {
      cwd: root,
      maxBuffer: 50 * 1024 * 1024
    }).toString()
  }

  hasChanges (): boolean {
    try {
      const tracked = this.runGit('diff HEAD --name-only').trim()
      const untracked = this.runGit(
        'ls-files --others --exclude-standard'
      ).trim()
      const hasAny = tracked.length > 0 || untracked.length > 0
      console.log(
        `[Shelves] hasChanges: tracked=${tracked.length > 0}, untracked=${untracked.length > 0}, result=${hasAny}`
      )
      return hasAny
    } catch (err) {
      console.error('[Shelves] hasChanges error:', err)
      return false
    }
  }

  private getUntrackedFiles (): string[] {
    return this.runGit('ls-files --others --exclude-standard')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
  }

  getChangedFiles (): { tracked: string[]; untracked: string[] } {
    const tracked = this.runGit('diff HEAD --name-only')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
    const untracked = this.getUntrackedFiles()
    return { tracked, untracked }
  }

  getShelves (): Shelf[] {
    const shelves: Shelf[] = []
    if (!fs.existsSync(this.storageDir)) return shelves

    const files = fs
      .readdirSync(this.storageDir)
      .filter((f) => f.endsWith('.json'))
    for (const file of files) {
      try {
        const content = fs.readFileSync(
          path.join(this.storageDir, file),
          'utf-8'
        )
        shelves.push(JSON.parse(content) as Shelf)
      } catch {
        // skip malformed entries
      }
    }
    return shelves.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  async shelveChanges (
    name: string,
    description?: string,
    filesToShelve?: string[]
  ): Promise<Shelf> {
    const root = this.getWorkspaceRoot()
    if (!root) throw new Error('No workspace folder found')

    const { tracked: allTracked, untracked: allUntracked } =
      this.getChangedFiles()

    // If no files specified, shelve all changes
    const trackedToShelve = filesToShelve
      ? filesToShelve.filter((f) => allTracked.includes(f))
      : allTracked
    const untrackedToShelve = filesToShelve
      ? filesToShelve.filter((f) => allUntracked.includes(f))
      : allUntracked

    if (trackedToShelve.length === 0 && untrackedToShelve.length === 0) {
      throw new Error('No files selected to shelve.')
    }

    // Stage only selected files
    const filesToAdd = [...trackedToShelve, ...untrackedToShelve]
    for (const file of filesToAdd) {
      this.runGit(`add "${file.replace(/"/g, '\\"')}"`)
    }

    let patch: string
    try {
      // Create patch from staged files
      patch = this.runGit('diff --cached HEAD')
    } finally {
      // Reset the index
      this.runGit('reset HEAD')
    }

    if (!patch.trim()) {
      throw new Error('No changes to shelve.')
    }

    const id = Date.now().toString()
    const shelf: Shelf = {
      id,
      name,
      createdAt: new Date().toISOString(),
      files: filesToAdd,
      description
    }

    // Persist patch and metadata
    fs.writeFileSync(path.join(this.storageDir, `${id}.patch`), patch, 'utf-8')
    fs.writeFileSync(
      path.join(this.storageDir, `${id}.json`),
      JSON.stringify(shelf, null, 2),
      'utf-8'
    )

    // Revert only the shelved tracked files
    for (const file of trackedToShelve) {
      this.runGit(`checkout HEAD -- "${file.replace(/"/g, '\\"')}"`)
    }

    // Delete shelved untracked files
    for (const f of untrackedToShelve) {
      const fullPath = path.join(root, f)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }
    }

    return shelf
  }

  async unshelveChanges (shelf: Shelf): Promise<void> {
    const root = this.getWorkspaceRoot()
    if (!root) throw new Error('No workspace folder found')

    const patchPath = path.join(this.storageDir, `${shelf.id}.patch`)
    if (!fs.existsSync(patchPath)) {
      throw new Error(`Patch file for shelf "${shelf.name}" not found.`)
    }

    // Use git apply with the saved patch
    const safePath = patchPath.replace(/"/g, '\\"')
    this.runGit(`apply "${safePath}"`)
  }

  deleteShelf (id: string): void {
    const jsonPath = path.join(this.storageDir, `${id}.json`)
    const patchPath = path.join(this.storageDir, `${id}.patch`)
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath)
    if (fs.existsSync(patchPath)) fs.unlinkSync(patchPath)
  }

  getPatchContent (id: string): string | undefined {
    const patchPath = path.join(this.storageDir, `${id}.patch`)
    if (!fs.existsSync(patchPath)) return undefined
    return fs.readFileSync(patchPath, 'utf-8')
  }

  renameShelf (id: string, newName: string): void {
    const jsonPath = path.join(this.storageDir, `${id}.json`)
    if (!fs.existsSync(jsonPath)) throw new Error('Shelf not found.')
    const shelf: Shelf = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    shelf.name = newName
    fs.writeFileSync(jsonPath, JSON.stringify(shelf, null, 2), 'utf-8')
  }

  commitFiles (files: string[], message: string): void {
    if (!message.trim()) throw new Error('Commit message cannot be empty.')
    if (files.length === 0) throw new Error('No files selected to commit.')

    // Stage selected files
    for (const file of files) {
      this.runGit(`add "${file.replace(/"/g, '\\"')}"`)
    }

    // Commit with message
    const safeMessage = message.replace(/"/g, '\\"')
    this.runGit(`commit -m "${safeMessage}"`)
  }
}
