<div align="center">

<img src="frontend/public/favicon.svg" width="80" alt="DR logo">

# DR · DeepSeek Reader

**Read papers, ask questions, and check the evidence — in one workspace.**

A local-first AI paper reader with paragraph references that take you back to the source.

[![npm](https://img.shields.io/npm/v/%40adamw_999%2Fdeep_reader?color=2f5d4a)](https://www.npmjs.com/package/@adamw_999/deep_reader)
[![Checks](https://github.com/AdamW627/deep-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/AdamW627/deep-reader/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%2014%2B-lightgrey)

[Quick start](#quick-start-macos) · [Usage](#usage) · [中文](README.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

</div>

![DR paper reading workspace](docs/reader.png)

<p align="center"><sub>Left: project library · Center: continuous PDF reading · Right: research assistant (screenshot uses a synthetic demo paper)</sub></p>

## Why DR

- **Check answers against the source:** references identify individual paragraphs, such as `p.5#16`. Hover to preview the text; click to jump to and highlight the passage.
- **Select a passage and ask:** translate, explain, derive equations, inspect figures, critique, or apply ideas to your research. Short translations arrive in about a second.
- **Read text and figures together:** the agent reads the full text, figures, and page images as needed, showing which files and images it is consulting.
- **Pay for model use when you need it:** importing, reading, and locally extracted abstracts do not call a model. Deep reading guides are generated only when requested.
- **Keep your research context:** organize papers by project, start separate conversations per paper, and tailor explanations with your research background and project memory.
- **Launch with one command:** install with `npm install -g` and run. The Python environment is prepared automatically, and application data is stored locally.

> [!NOTE]
> A single-user application for your local machine, **not an official DeepSeek product**. Model features send paper content and relevant context to your configured provider and incur charges under its pricing. Read [Privacy](PRIVACY.md) and [Security](SECURITY.md) before use.

## See it in action

The examples below use the ResNet paper ([arXiv:1512.03385](https://arxiv.org/abs/1512.03385)). Answers and paragraph numbers are illustrative; actual model output will vary. UI labels are shown in Chinese to match the application.

### 1. Import and open a paper with a link

```text
http://127.0.0.1:8765/?url=https%3A%2F%2Farxiv.org%2Fpdf%2F1512.03385
```

Open the link to import the paper into the current project and start reading. You can also select multiple PDFs, import an entire folder, or save a paper with the [browser extension](extension/README.md). Importing and reading do not call a model.

### 2. Select a sentence and get a translation in about a second

**Selected passage:**

> Instead of hoping each few stacked layers directly fit a desired underlying mapping, we explicitly let these layers fit a residual mapping.

**The Chinese translation streams into the right panel:**

> 我们不再期望每几层堆叠的网络直接拟合所需的底层映射，而是显式地让这些层去拟合一个残差映射。

Only the selected text is sent for translation. Translating the same passage again uses the local cache without another model charge.

### 3. Follow a derivation, with evidence at each step

**Select** $\mathcal{F}(x) = \mathcal{H}(x) - x$ **and click “推导” (Derive):**

> **Why is learning a residual easier than learning the mapping directly?**
>
> 1. Instead of learning $\mathcal{H}(x)$ directly, the authors learn $\mathcal{F}(x)=\mathcal{H}(x)-x$ and express the output as $y=\mathcal{F}(x)+x$. `p.3#8`
> 2. If the optimal mapping is close to the identity, driving the weights of $\mathcal{F}$ toward zero is easier than making multiple nonlinear layers fit an identity mapping. `p.3#9`
> 3. The experiments illustrate the difference: a plain 34-layer network has higher training error than its 18-layer counterpart, while residual networks show the opposite trend. `p.6#21` See Figure 4.

References such as `p.3#8` are clickable in the app: hover to preview the source paragraph, then click to navigate to and highlight it.

### 4. Understand figures and see how the agent works

**Select the caption of Figure 1 and click “图表” (Figures).** The agent looks for evidence first, and its activity appears in the reply panel:

```text
▸ Reading fulltext.md (pages 1–2)
▸ Viewing figures/fig1.png
▸ Viewing pages/p1.jpg
```

> The left and right plots show training and test error on CIFAR-10. For the plain 56-layer network, **both curves are above** those of the 20-layer network. This points to an optimization problem rather than overfitting, which would instead suggest lower training error. The paper calls this the “degradation problem.” `p.1#4`

### 5. Connect the explanation to your research

Enter your research background in settings, for example: “I work on medical image segmentation and often use U-Net.” **Select the passage about residual blocks and click “迁移” (Apply):**

> You could replace each convolutional block in the U-Net encoder with a residual block. When dimensions change, the paper uses a 1×1 convolution as a projection shortcut. `p.4#13` Your downsampling layers need to handle this too, or the shapes of $x$ and $\mathcal{F}(x)$ will not match…

You can also choose “审稿” (Review) on the same passage to examine the experimental design and conclusions from a reviewer's perspective.

### 6. Get a reading guide before diving into the paper

The “导读” (Guide) tab starts with a locally extracted abstract, at no model cost. Click “生成深度导读” (Generate deep reading guide) to have the agent read the full text and key figures, producing a guide such as:

| Item | Illustrative content |
| --- | --- |
| Problem | Training error increases as the network gets deeper: the degradation problem |
| Core idea | Learn a residual $\mathcal{F}(x)$ and add it to the input through an identity shortcut |
| Key equation | $y = \mathcal{F}(x, \lbrace W_i \rbrace) + x$ |
| Main result | 3.57% top-5 error on ImageNet; first place in ILSVRC 2015 classification |
| Open question | The 1202-layer CIFAR network performs worse than the 110-layer network, which the authors attribute to overfitting |
| Reading route | §1 motivation → Figure 1 → §3.1–3.2 → Tables 3 and 4 → §4.2 |

Later conversations about the paper can refer to this guide.

### 7. Carry research memory across papers

Each project has its own long-term memory, organized automatically from conversations and also editable by hand:

```text
Goal        Improve small-organ segmentation Dice on a small CT dataset
Constraint  One GPU with 24 GB VRAM; inference under 200 ms
Lead        Try a residual encoder + deep supervision (from ResNet and UNet++)
```

When you ask a question about any paper in the same project, the agent selects up to three relevant memories by keyword to keep the answer connected to your research.

## Quick start (macOS)

Requires **macOS 14+**, Apple Silicon or Intel, and **Node.js 20+**.

```sh
npm install -g @adamw_999/deep_reader
deepseek-reader
```

The first launch downloads uv, Python 3.12, and the Python dependencies, then opens the local reader in your browser. You do not need to configure Python manually. Installing the npm package itself does not download the runtime. Initial setup needs an internet connection; later launches reuse the prepared environment.

1. Open settings, enter your DeepSeek API key, and test the connection.
2. Import a PDF, folder, or paper URL. Local import and reading do not call a model.
3. Select a passage to translate or ask a question. Click citations to return to the paper.

```sh
deepseek-reader setup            # Prepare the runtime in advance
deepseek-reader start --no-open  # Start without opening a browser
deepseek-reader status           # Show server status and URL
deepseek-reader stop             # Stop the server
```

The npm launcher stores its runtime, library, settings, and logs in `~/Library/Application Support/deepseek-paper-reader/`, outside the installed package. Keep that directory when upgrading. See the [launcher documentation](npm/README.md).

## Run from source

### Requirements

Use Python 3.12 and Node.js 20+. macOS/Linux are recommended; on Windows use WSL for the Bash launcher. Clone the repository and enter its root directory:

```sh
git clone https://github.com/AdamW627/deep-reader.git
cd deep-reader
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
npx playwright install chromium
cd ..
```

### Start the reader

Optionally install the global `paper` command once:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/scripts/paper" "$HOME/.local/bin/paper"
# Add $HOME/.local/bin to PATH, or run ./scripts/paper directly
```

Then, from any directory:

```sh
paper          # Start in the background if needed, then open the browser
paper stop     # Stop the background service started by paper
paper restart  # Restart the service
paper status   # Show service status
paper logs     # Show and follow logs
```

You can also start the server manually from the project root:

```sh
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Open `http://127.0.0.1:8765`. The server serves the built files in `frontend/dist`: run `npm run build` in `frontend` after frontend changes, and `paper restart` after backend changes, or the page will continue using the old version. `paper` manages only services it started and will not stop a manually launched instance. Logs and PID records are stored in `.data/`.

## Usage

### Projects and importing

- Select or create a project at the top left. DR remembers your last selection. The default project includes papers imported before project support was added. Projects group local papers stored in `.data/papers/<paper-id>/`; they do not mount arbitrary folders on disk.
- The “导入” (Import) menu offers three options: select multiple PDFs, import a folder including subfolders, or open a public PDF, arXiv link, or paper page with `citation_pdf_url` metadata. Folder import copies PDFs and skips other files; later changes to the original folder are not synchronized.
- Batch imports upload and parse PDFs one at a time, with progress on the left. Failed files are listed individually without interrupting the remaining imports. Importing and opening papers do not call a model.
- A URL such as `http://127.0.0.1:8765/?url=https%3A%2F%2Farxiv.org%2Fpdf%2F1512.03385` imports the paper into the remembered project and opens it. Each visit imports it again.
- For one-click saving in your browser, see [extension/README.md](extension/README.md). The extension saves to the default project by default.
- Titles are chosen from PDF metadata first, then the largest consecutive text near the top of the first page, skipping headers such as “Published as…”, “arXiv”, and “Under review”. The supplied title or filename is the fallback. After a title-rule update, existing titles are recalculated once at startup.

### Reading

- Scroll continuously through the PDF. Navigate using the page number, outline, answer citations, or annotations. The default zoom is 150%.
- Shortcuts: `⌘B` / `Ctrl+B` toggles the library sidebar and remembers its state; `⌘F` / `Ctrl+F` searches the full paper, with Enter / Shift+Enter moving between matches; `⌘J` / `Ctrl+J` expands the reply area; `Esc` closes the selection toolbar, search bar, or import menu.
- “文档详情” (Document details) is available as soon as a paper is selected, even while its PDF is loading. It shows the title, original filename, page count, readable and exact file size, import date in local time, project, source, paper ID, absolute PDF path, and metadata/annotation directory. Sources must be HTTP(S) URLs without credentials; local uploads are labeled as local files. Copy paths or open the original PDF; if clipboard access is unavailable, select and copy the path manually. Close with the button or Escape. Switching papers or projects clears the details.
- Details paths come from `GET /api/papers/{id}/details`, resolved by the backend from the current storage root, including `PDF_READER_DATA_DIR` overrides. The frontend does not guess your home directory. New uploads preserve filename capitalization; URL imports use the final PDF URL's filename, falling back to `paper.pdf`. Old records retain only the filename already stored.
- Switch between light, dark, and system appearance at the bottom left.

### Selecting text

- Select text to explain, derive, inspect figures, review, apply, or translate it. You can also ask a free-form question about the selection, or highlight it and save a note in one of several colors.
- **Translation** sends only the selected text to the model, without reading the paper or including conversation history. The translation streams into the conversation panel; short sentences took about a second in local testing. Results are cached in the paper's `translations.json`, so repeating the translation does not call the model again.
- Other quick actions and free-form questions go through the agent, which reads full text, figures, and page images as needed, so they take longer than translation.

### Reading guides

- The “导读” (Guide) tab initially shows the abstract or opening text extracted from the PDF locally, without calling a model or incurring model charges.
- Click “生成深度导读” (Generate deep reading guide) when needed. The agent reads the paper and key figures to produce its problem, core idea, method, key equations, main results, open questions, and reading route. Later conversations use this guide. Generation and regeneration incur model charges; batch import does not generate guides automatically.

### Conversations and memory

- Answer references identify individual paragraphs, such as `p.5#16`. Hover to preview the source; click to navigate to and briefly highlight it.
- Create independent conversations for a paper; switching loads only that conversation's history. Rename manually or from the first question, search titles, archive, or delete conversations. The default historical conversation can be renamed but cannot be archived or deleted.
- Fill in “你的研究背景” (Your research background) in settings to tailor examples and explanation depth.
- Each project has independent research memory for long-term goals, questions, methods, constraints, and leads. View, edit, add, remove, or organize it immediately in settings. Answers include up to three relevant memories selected by keyword. Harness organizes memory in the background after ten conversation turns or 24 hours from the project's first activity, which incurs a small model charge.

## Model configuration

Save your API key, model, and base URL in settings, then click “测试连接” (Test connection). This sends a small real request through the Harness SDK and incurs a small API charge.

The installed Harness `deepseek-official` provider uses the Messages protocol:

- Base URL: `https://api.deepseek.com/anthropic`
- Model: `deepseek-flash`

The previous base URL, `https://api.deepseek.com`, returns HTTP 404 for this protocol; DR automatically migrates that old setting. Source installations store the key in `~/.config/deepseek-pdf-reader/settings.json` with permissions `0600`; the page does not receive the key back. Do not expose the local service to the public internet.

Translation bypasses Harness: the backend uses the same key, model, and base URL to call `<Base URL>/v1/messages` directly, with thinking disabled and streaming enabled.

Import generates agent materials for each paper: paragraph-numbered `fulltext.md`, page images in `pages/pN.jpg`, caption-based figure crops in `figures/` with an index in `figures.md`, and paragraph coordinates in `blocks.json` for citation highlights. Older papers receive these materials when first opened or queried, using roughly 2–15 MB per paper. The explanation instructions live in the paper's `AGENTS.md`, which Harness loads automatically. The agent uses `read_image` to inspect original equations and figures; `deepseek-flash` supports image input. Scanned papers without a text layer do not support full-text search or paragraph citations. Independent sessions are stored in `.data/harness/`. Highlights and notes are saved separately as JSON and are not yet embedded in exported PDFs.

The current Harness SDK (`0.2.1rc2`) forwards complete model steps rather than token-by-token output. The reply panel shows files being read, images being viewed, and text from each completed step. Translation bypasses Harness and therefore streams incrementally.

## Verification

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
node --test extension/tests/popup.test.cjs
cd frontend
node --test tests/*.test.mjs
npm run build
npx playwright test
```

Browser tests use mock APIs and valid PDF fixtures. To test real model requests, configure a key locally.

## Project structure

```text
backend/     FastAPI service, PDF parsing, model calls, and project memory
frontend/    React + Vite UI, PDF.js rendering, and KaTeX equations
extension/   Chrome / Chromium paper-saving extension
npm/         macOS launcher and npm packaging
scripts/     Source launcher and allowlisted release packaging
tests/       Backend and release checks
```

## Limitations and feedback

- The npm launcher currently supports macOS only.
- Scanned PDFs without a text layer do not have OCR, full-text search, or paragraph citations.
- Highlights and notes are stored as JSON and are not embedded into an exported PDF.
- The application is for a single local user. Keep it on loopback; the agent workspace is not an OS sandbox.

Please submit bugs and feature requests through [GitHub Issues](https://github.com/AdamW627/deep-reader/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

Repository source is licensed under [GNU AGPL-3.0-only](LICENSE). Third-party components retain their own licenses. Model services are not included in this license and require a separately configured account and API key.

The already published npm `0.1.0` metadata still says `UNLICENSED`. This repository uses AGPL-3.0-only; the npm metadata and license file will be synchronized in a future release.
