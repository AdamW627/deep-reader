# DR · DeepSeek Reader

A local-first PDF reader with a DeepSeek research assistant, packaged for macOS.

Organize papers by project, read PDFs continuously, translate selected passages, and discuss methods, equations and figures with an assistant. Paragraph citations link answers back to the paper. Includes highlights, notes, full-text search, reading guides, separate conversations and project memory.

[Source & documentation](https://github.com/AdamW627/deep-reader) · [Issues](https://github.com/AdamW627/deep-reader/issues)

## Requirements

- macOS 14 or later, on Apple Silicon or Intel.
- Node.js 20 or later, with npm.
- An internet connection for initial setup and DeepSeek assistant requests.
- A DeepSeek API key to use the assistant.

## Install and Run

```sh
npm install -g @adamw_999/deep_reader
deepseek-reader
```

Installing the npm package does not download Python, uv, or Python dependencies through install lifecycle scripts. On first setup or start, the launcher downloads uv, a managed Python runtime, and the pinned Python dependencies as needed. The first run therefore requires internet access and can take longer than later starts.

The default command is `start`: running `deepseek-reader` starts the local reader and opens it in your browser.

## Launcher Commands

Available CLI commands:

```sh
deepseek-reader setup
deepseek-reader start
deepseek-reader status
deepseek-reader stop
```

`setup` prepares the runtime; `start` prepares it if needed and starts the reader. `status` checks the local server, and `stop` stops it. To suppress opening the browser during setup or start, use `--no-open`:

```sh
deepseek-reader setup --no-open
deepseek-reader start --no-open
```

## Local Data

Runtime files and application data are stored outside the installed npm package at:

```text
~/Library/Application Support/deepseek-paper-reader
```

Set `DEEPSEEK_READER_HOME` to override this directory, for example:

```sh
DEEPSEEK_READER_HOME="$HOME/reader-data" deepseek-reader
```

Keep this directory if you want to preserve your local reader data when updating or reinstalling the npm package. Treat its contents as private.

## Network and Privacy

This is not an offline application. Initial setup downloads runtime components and dependencies, and the DeepSeek assistant requires an online service. Assistant requests can send paper content and conversation text to DeepSeek. Local-first storage does not mean that assistant processing stays on your computer.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for data handling and security details.

## License

The repository source is licensed under GNU AGPL-3.0-only. The already published npm version 0.1.0 still has UNLICENSED metadata; the license and repository metadata will be included in the next npm release. This project is not an official DeepSeek product.
