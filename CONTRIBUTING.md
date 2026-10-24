# Contributing to Codiff

## AI Assistance Notice

> [!IMPORTANT]
>
> If you use any kind of AI assistance to contribute to Codiff, disclose it in
> the pull request.

Include the extent of the assistance, such as research, documentation, tests, or
code generation. Disclose AI-generated pull request responses as well. Trivial
tab completion limited to a keyword or short phrase does not need disclosure.

Example:

> This PR was written primarily with Claude Code.

Or:

> I used ChatGPT to understand the sharing flow. I wrote and tested the change
> myself.

Contributors are expected to understand submitted code and be able to explain
its behavior and tradeoffs.

Thanks to
[Ghostty's contribution guidelines](https://github.com/ghostty-org/ghostty/blob/main/CONTRIBUTING.md)
for inspiring this policy.

## Requirements

Codiff uses Node.js 24.21.0 or later, pnpm 12, and
[Vite+](https://viteplus.dev/). Install Vite+ before working in the repository.

You will also need Git. The native application requires a platform supported by
Electron.

## Initial Setup

From the repository root:

```bash
vp install
vp run build
```

The first build creates the package output consumed by the desktop application
for the desktop application.

## Native Application Development

Start the renderer from the repository root:

```bash
vp run dev
```

In another terminal, launch Electron against the development renderer:

```bash
vp run dev:app
```

Run the built application without the development server with:

```bash
vp run electron
```

Changes to `core/`, Electron code, or CLI behavior should include focused tests
under the corresponding `__tests__` directory.

## Validation

Run `vp check --fix`, `vp test`, and then `vpr build` after code changes.

This fork only reads repository contents and remote reviews. Keep repository file writes,
Git mutations, and remote mutation APIs out of both the renderer bridge and Electron backend.
Local notes and display preferences can be persisted outside the repository.
