# HNK Studio

Modular Node.js desktop tool for HNK files.

![](https://github.com/zbirow/HNK-Studio/blob/main/hnk_studio.png)

## Info
The program is still in development, and some features may not work. Please report any problems or questions to [Issues](https://github.com/zbirow/HNK-Studio/issues).

## Current shape

- Select a game provider first.
- Open an `.hnk` file after the provider is selected.
- Keep common HNK parsing, record names, texture header parsing, and game-specific providers separate.
- Click right-mouse to folder to export all files from folder.

## Features
* Texture Viewer and Export
* Audio player end Export
* 3D model/ Viewer and Export
* Skeleton/Rig Viewer
* Sprites Viewer

# Update 0.1.1

*Add Support BGRA8888 Wii Format

## Install

Download Repo

or
```bash
git clone https://github.com/zbirow/HNK-Studio.git
```

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
