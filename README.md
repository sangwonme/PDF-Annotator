# PDF Annotator

An Obsidian plugin for annotating PDFs with highlights and notes directly inside your vault.

## Features

- **PDF Viewer**: Renders PDFs using pdf.js inside Obsidian
- **Text Highlights**: Select text and highlight in 5 colors (yellow, green, blue, pink, orange)
- **Inline Notes**: Add notes to any highlight
- **Git-Friendly Storage**: Annotations saved as JSON sidecar files (`.annotations.json`) — never modifies the original PDF
- **Session Persistence**: Highlights and notes persist across Obsidian restarts

## How to Use

1. Open any PDF file in your vault — it will open in the PDF Annotator view
2. Select text to see the color picker, then click a color to highlight
3. Click a highlight to open the context menu:
   - **Add Note**: Attach a comment to the highlight
   - **Change Color**: Switch to a different highlight color
   - **Delete**: Remove the highlight
4. Notes are saved automatically

## Annotation Storage

Annotations are stored in a JSON file next to the PDF:

```
papers/
  paper.pdf
  paper.pdf.annotations.json    ← created automatically
```

The JSON format is human-readable and produces clean git diffs.

## Installation

### From Community Plugins (coming soon)

1. Open Settings → Community Plugins → Browse
2. Search for "PDF Annotator"
3. Install and enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `<vault>/.obsidian/plugins/pdf-annotator/`
3. Copy the files into that folder
4. Restart Obsidian and enable the plugin in Settings → Community Plugins

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
