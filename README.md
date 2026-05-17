# HNK Studio

Modular Node.js desktop tool for HNK files.

## Current shape

- Select a game provider first.
- Open an `.hnk` file after the provider is selected.
- Browse records grouped into a left-side tree, similar to the old Python viewer.
- Keep common HNK parsing, record names, texture header parsing, and game-specific providers separate.

## Run

```bash
npm install
npm start
```

On Windows PowerShell, if `npm` is blocked by script policy, use:

```bash
npm.cmd install
npm.cmd start
```
