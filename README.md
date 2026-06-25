# MeesaJarJar's ISO Slicer V4

**MeesaJarJar.com** — Isometric tile & mask extractor for sprite sheet slicing.

A single-file, zero-dependency web tool for extracting individual parts from isometric sprites. Align a diamond grid, select an anchor tile, trace a mask, and export layers as transparent PNGs with position metadata.

---

## Quick Start

1. Open `index.html` in a browser (or run `run.bat` to start a local server).
2. Drag & drop a PNG, or paste from clipboard with **Ctrl+V**.
3. Align the diamond grid to your sprite's tile footprint.
4. Use **Select tile** to pick an anchor, then **Draw mask** to trace the region.
5. Export as a `.zip` containing transparent PNGs and a `manifest.json`.

### Local Server

Double-click `run.bat` to start a server on port `8080` accessible from any device on your network.

```
python -m http.server 8080 --bind 0.0.0.0
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Isometric grid** | Configurable tile width/height and X/Y offset to match any UO-style iso projection. |
| **Image scale** | Scale the reference image independently of the workspace zoom (default 0.6 = 1:1 native). |
| **Snap to tile corners** | Toggle to snap mask points to the nearest diamond corner for precise selection. |
| **Select all art above** | Right-click a tile to auto-scan and select all art above it in one click. |
| **Multi-tile selection** | Ctrl+Click to select multiple tiles, then extract them as a single layer. |
| **Layer management** | Create, rename, toggle visibility, reorder, and delete layers. |
| **Export as ZIP** | Each layer exports as a full-size transparent PNG + `manifest.json` with anchor tile and pixel offset. |
| **Undo / Redo** | Full undo/redo stack (Ctrl+Z / Ctrl+Shift+Z). |
| **Keyboard shortcuts** | V = Select tile, M = Draw mask, H/Space = Pan, Ctrl+Z/Y = Undo/Redo, Enter = Create layer. |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tile tool |
| `M` | Draw mask tool |
| `H` / `Space` | Pan tool (hold to pan) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+Enter` | Create layer from selected tiles |
| `Enter` | Finalize mask |
| `Escape` | Cancel / deselect |

---

## File Structure

```
UOSlice/
  index.html      — UI layout and styles
  app.js          — All application logic (~1700 lines, vanilla JS)
  jszip.min.js    — Bundled JSZip for ZIP export
  run.bat         — Local server launcher
```

No build step. No frameworks. Just open `index.html`.

---

## Export Format

The exported `.zip` contains:

- **`manifest.json`** — Array of layers, each with:
  - `name` — Layer name
  - `tile` — Anchor tile `{tx, ty}` in grid coordinates
  - `maskPoints` — Polygon vertices in image pixel space
  - `offsetX`, `offsetY` — Pixel offset from tile center to layer origin
  - `width`, `height` — Dimensions of the exported PNG
- **`<layer-name>.png`** — Full-size transparent PNG of the extracted region.

---

## License

Free to use. Created by [MeesaJarJar.com](https://meesajarjar.com).
