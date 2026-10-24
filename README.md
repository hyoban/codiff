# Codiff

Codiff is a beautiful, minimal, local diff viewer for reviewing Git changes and committing them.

<img width="48%" src="https://github.com/user-attachments/assets/9801587d-5879-461a-b375-9fbfa3c5f25d" />
<img width="48%" src="https://github.com/user-attachments/assets/8b92902b-1112-4553-ba59-74e84a61ca7d" />

## Why Codiff

- **Fast Local Reviews:** Review and commit changes in any Git repository.
- **Inline Review Comments:** Comment directly on GitHub pull requests and GitLab merge requests, or copy review comments as Markdown for follow-ups.
- **Lightweight Definition Navigation:** Mod/Ctrl-click an identifier to find likely local definitions without starting a language server.

## Download

Install with Homebrew:

```bash
brew install --cask nkzw-tech/tap/codiff
```

Download the latest Codiff app from [GitHub Releases](https://github.com/nkzw-tech/codiff/releases).

After installing the app, run `Codiff > Install Terminal Helper` to make the `codiff` command available in your shell.

## Command Line

```bash
codiff
```

Run it from any Git repository, or pass a path:

```bash
codiff /path/to/repository
```

Review a specific commit:

```bash
codiff a1b2c3d
```

Review the current branch against a target branch:

```bash
codiff main
```

Review a GitHub pull request or GitLab merge request using the current repository remote:

```bash
codiff pr 75
codiff pr owner:my-feature-branch
codiff mr 23
```

Branch lookup uses `gh` and selects an open GitHub pull request. Include `owner:` for pull
requests from forks.

Full GitHub and GitLab review URLs are also supported. GitLab hosts and nested project paths are
derived from the URL or local Git remote and authenticated through `glab`; Codiff does not require
instance-specific configuration.

Share a Markdown plan:

```bash
codiff --plan plan.md --share
```

Show all available options:

```bash
codiff --help
```

Codiff prints its own shell completions for bash, fish and zsh. They complete every flag, the
values those flags accept, and Git refs for the ref argument:

```bash
# bash, in ~/.bashrc
source <(codiff --completions bash)

# fish, in ~/.config/fish/completions/codiff.fish
codiff --completions fish | source

# zsh, on the fpath
codiff --completions zsh > ~/.zsh/completions/_codiff
```

Launching Codiff in multiple repositories opens a separate native window for each repository.

## Command Bar

Open the command bar with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on macOS, or
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on other platforms. Type to filter commands, use
<kbd>Up</kbd>/<kbd>Down</kbd> to move through results, press <kbd>Enter</kbd> to run the selected
command, and press <kbd>Esc</kbd> to close it.

The command bar includes actions for common review workflows:

- Focus File Filter
- Find in Diffs
- Show File Tree and Show History
- Copy Review Comments
- Copy Review Comments and Close
- Toggle Viewed for the currently selected file
- Toggle Diff Layout, with the target layout action shown as the hint
- Open the currently selected file in your editor
- Toggle Sidebar
- Reload Window

## Configuration

Codiff reads configuration from `~/.codiff/codiff.jsonc`. Open `Codiff > Open Config File...` to
create the file with defaults and open it in your editor. The file supports JSONC comments and
trailing commas, includes a JSON schema reference for editor completion, and is watched while Codiff
is running so changes apply to open windows.

Set `settings.showWhitespace` to `true` to show whitespace-only changes in diffs and file line
counts; when it is `false`, Codiff hides those changes from the working-tree review state.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/nkzw-tech/codiff/main/core/config/codiff-config.schema.json",
  "settings": {
    "codeFontFamily": "",
    "codeFontSize": 13,
    "copyCommentsOnClose": false,
    "diffStyle": "split",
    "editorCommand": "",
    "lastRepositoryPath": "",
    "sidebarPosition": "left",
    "showWhitespace": false,
    "theme": "system",
    "wordWrap": false,
  },
  "keymap": {
    "commandBar": "Mod+k",
    "diffSearch": "Mod+f",
    "fileFilter": "Mod+p",
    "nextSearchMatch": "Enter",
    "openFile": "Mod+Shift+o",
    "prevSearchMatch": "Shift+Enter",
    "closeSearch": "Escape",
    "submitComment": "Mod+Enter",
    "discardComment": "Escape",
    "toggleSidebar": "Mod+Shift+b",
  },
}
```

Set `settings.editorCommand` to customize file opening. Use `{file}` for the selected file,
`{line}` for its line number when available, and `{repo}` for the repository root, for example
`"subl \"{repo}\" \"{file}\""`.
Set `settings.sidebarPosition` to `left` or `right` to choose which side of the desktop window shows
the file sidebar.

Choose `View > Diff > Split` or `View > Diff > Unified`, use Toggle Diff Layout in the command bar,
or set `settings.diffStyle` to `split` for side-by-side diffs or `unified` for unified diffs.
Choose `View > Diff > Word Wrap`, use Toggle Word Wrap in the command bar, or set
`settings.wordWrap` to `true` to wrap long diff lines.
Choose `View > Diff > Expand Unchanged Lines` or set `settings.expandUnchanged` to `true` to show
full files instead of collapsing unchanged lines between hunks.
Set `settings.renderMarkdownAs` to `source` to open Markdown files as text diffs by default instead
of rendered previews.
Choose `View > Diff > Font Size`, use the code font size commands in the command bar, or use
<kbd>Cmd/Ctrl</kbd>+<kbd>+</kbd>, <kbd>Cmd/Ctrl</kbd>+<kbd>-</kbd>, and
<kbd>Cmd/Ctrl</kbd>+<kbd>0</kbd> to change only diff and code rendering font size.
Set `settings.codeFontFamily` manually to an installed CSS font family name, for example
`"JetBrains Mono"` or `"SF Mono"`. Leave it empty to use Codiff's bundled mono stack.
Use `Mod` for <kbd>Cmd</kbd> on macOS and <kbd>Ctrl</kbd> on other platforms. Shortcut strings can
combine `Mod`, `Ctrl`, `Alt`, `Shift`, or `Meta` with a key, for example `Mod+k` or
`Alt+Enter`.

This fork has no built-in updater. Update by rebuilding from this fork.

## Development

Use Node.js 24.21.0 or later.

```bash
vp install
vp build
vpr codiff
```

For live development:

```bash
vpr dev
ELECTRON_RENDERER_URL=http://127.0.0.1:5173 vpr electron
```

To try lightweight Mod/Ctrl-click definition navigation against a deterministic temporary Git
repository, run `vpr example:definition-navigation`. See the
[definition navigation example](examples/definition-navigation/README.md) for the expected flow.

Useful checks:

```bash
vp check
vp test
vp build
```

Run `vpr test:integration` to build and test the public sharing service.

## Contributing

Found an issue, or want to improve something? See the
[contributing guide](CONTRIBUTING.md) for local application and public web
service setup.
