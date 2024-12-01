# Basel VSCode Toolbox

## Overview

Basel VSCode Toolbox is a Visual Studio Code extension that provides various tools to enhance your development experience. One of the key features of this extension is the ability to manage editor groups efficiently.

## Features

- **Split Editor Right Limited**: This command allows you to split the editor to the right and manage up to two editor groups. If two editor groups are already open, it moves the active editor between the groups.

## Commands

### Split Editor Right Limited

- **Command**: `extension.splitEditorRightLimited`
- **Keybindings**:
  - `cmd+r` (when editor text is focused)
  - `cmd+t` (when editor text is focused)

### Behavior

- If there is only one editor group, it splits the editor to the right.
- If there are two editor groups and the active editor is in the first group, it moves the active editor to the second group.
- If there are two editor groups and the active editor is in the second group, it moves the active editor to the first group.
- Displays a message if there are more than two editor groups.

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions view by clicking on the Extensions icon in the Activity Bar on the side of the window or by pressing `cmd+Shift+X` or `Ctrl+Shift+X`.
3. Search for "Basel VSCode Toolbox".
4. Click "Install" to install the extension.

## Usage

1. Open a file in Visual Studio Code.
2. Use the keybindings `cmd+r` or `cmd+t` to activate the `Split Editor Right Limited` command.
3. The command will split the editor to the right or move the active editor between the two groups as described in the behavior section.

## Contributing

Contributions are welcome! If you have any suggestions or find any issues, please open an issue or submit a pull request on [GitHub](https://github.com/baselsoftwaredev/basel-vscode-toolbox).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE.md) file for details.