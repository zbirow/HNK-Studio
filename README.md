# HNK Studio


[**Wiki**](https://github.com/zbirow/HNK-Studio/wiki)

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

# Update
## Update 0.1.1

*Add Support BGRA8888 Wii Format

## Update 0.1.2

* Add Support Wii 3D Model

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

## Another Tools for HNK files

[Torus Tools](https://github.com/desuex/torus-tools) - By Desuex

[Noesis Plugin (Wii 3D Model)](https://github.com/Durik256/Noesis-Plugins/blob/master/fmt_MonsterHigh.py) - By Durik256
