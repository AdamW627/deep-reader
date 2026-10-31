# DR · DeepSeek Reader

[![npm](https://img.shields.io/npm/v/%40adamw_999%2Fdeep_reader)](https://www.npmjs.com/package/@adamw_999/deep_reader)
[![Checks](https://github.com/AdamW627/deep-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/AdamW627/deep-reader/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**把论文阅读、原文证据和研究对话放在同一个工作台。**

DR（DeepSeek Reader）是一款本地优先的论文阅读器：左侧管理项目与论文，中间连续阅读 PDF，右侧与基于 DeepSeek Harness 的研究助手交流。从选段翻译、公式推导到图表讲解，回答中的段落引用都可以跳回原文。

[English](README.en.md) · [npm 安装](#快速开始macos) · [功能与使用](#使用) · [参与贡献](CONTRIBUTING.md) · [更新日志](CHANGELOG.md)

![DR 论文阅读工作台](docs/reader.png)

*实际界面截图，使用合成演示论文；右侧为本地提取的免费快览。*

## 功能概览

| 功能 | 用途 |
| --- | --- |
| 项目论文库 | 按研究项目分组，批量导入 PDF、文件夹或论文链接 |
| 连续 PDF 阅读 | 目录导航、全文搜索、高亮备注、浅色与深色外观 |
| 选段操作 | 翻译、解释、推导、图表、审稿、迁移，也可自由提问 |
| 可追溯的回答 | 查看 Agent 的阅读与工具调用记录，点击段落引用返回证据 |
| 按需深度导读 | 本地摘要免费浏览，需要时再生成方法、结果与阅读路线 |
| 研究上下文 | 每篇论文独立多会话，结合研究背景和项目级长期记忆 |

> 本机单用户工具，非 DeepSeek 官方产品。模型功能会向配置的供应商发送论文内容及相关上下文，自动记忆整理也会联网并产生费用。使用前请阅读 [隐私说明](PRIVACY.md) 与 [安全边界](SECURITY.md)。

## 快速开始（macOS）

需要 **macOS 14+**（Apple Silicon / Intel）和 **Node.js 20+**。

```sh
npm install -g @adamw_999/deep_reader
deepseek-reader
```

首次启动会下载 uv、Python 3.12 和 Python 依赖，随后在浏览器打开本地阅读器；无需手动配置 Python 环境。安装 npm 包本身不执行运行时下载。首次准备需要联网，之后运行时会复用。

1. 在设置中填写 DeepSeek API Key，点击“测试连接”。模型功能按供应商规则计费。
2. 导入 PDF、文件夹或论文链接；导入与本地阅读不调用模型。
3. 选中文字翻译或提问，点击回答中的引用返回原文。

```sh
deepseek-reader setup            # 提前准备运行环境
deepseek-reader start --no-open  # 启动，不自动打开浏览器
deepseek-reader status           # 查看服务地址和状态
deepseek-reader stop             # 停止服务
```

npm 安装的数据与运行环境保存在 `~/Library/Application Support/deepseek-paper-reader/`，独立于全局 npm 包，更新包时请保留该目录。源码运行的数据位置见下文。更多启动器说明见 [npm/README.md](npm/README.md)。

## 从源码运行

### 运行环境

需要 Python 3.12、Node.js 20+。推荐 macOS / Linux；Windows 请使用 WSL（启动脚本为 Bash）。克隆后进入项目根目录：

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

### 启动

推荐安装全局 `paper` 命令（一次性）：

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/scripts/paper" "$HOME/.local/bin/paper"
# 将 $HOME/.local/bin 加入 PATH；也可以直接执行 ./scripts/paper
```

之后在任意目录：

```sh
paper          # 服务未运行时自动后台启动，然后打开浏览器
paper stop     # 停止由 paper 启动的后台服务
paper restart  # 重启服务
paper status   # 查看运行状态
paper logs     # 查看并跟踪日志
```

也可以手动启动：

```sh
# 在解压后的项目根目录运行
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

打开 http://127.0.0.1:8765 。服务返回的是 `frontend/dist` 里的构建产物：改了前端要在 frontend 中运行 `npm run build`，改了后端要 `paper restart`，否则页面仍是旧版本。`paper` 只管理自己启动的服务，手动运行的实例不会被 `paper stop` 误杀；日志与 PID 记录在 `.data/`。

## 使用

### 项目与导入

- 左上角选择或新建项目；记住上次选择。默认项目包含此前导入的论文。项目是本机论文分组，统一存储在 `.data/papers/<paper-id>/`，不是任意磁盘路径挂载。
- 左栏“导入”按钮展开后有三种方式：
  - **选择 PDF**：一次可选多篇。
  - **导入文件夹**：包含子文件夹，只复制 PDF，跳过其他文件。文件夹是复制导入，原目录后续变化不会自动同步。
  - **从链接打开**：公开 PDF、arXiv 或含 citation_pdf_url 的论文页面。
- 多篇导入时逐个上传解析，进度显示在左栏；失败的文件单独列出，不中断其余文件。导入和打开论文都不调用模型。
- 可直接使用 `http://127.0.0.1:8765/?url=https%3A%2F%2Farxiv.org%2Fpdf%2F1512.03385`，自动导入到当前记住的项目并打开。每次打开此链接会重新导入。
- 浏览器一键收藏见 extension/README.md。扩展默认保存到默认项目。
- 论文标题依次取：PDF 文档标题；首页上部字号最大的连续文字（跳过 “Published as…”、“arXiv”、“Under review” 这类页眉）；导入时提供的标题或文件名。规则更新后，服务启动时会按新规则重算一次旧论文的标题。

### 阅读

- PDF 使用鼠标滚轮连续阅读；工具栏页码、目录、回复引用、批注均可跳转。默认缩放为 150%。
- 快捷键：`⌘B` / `Ctrl+B` 收起或展开左侧论文库（状态本机记住）；`⌘F` / `Ctrl+F` 在论文全文中搜索（Enter / Shift+Enter 切换结果）；`⌘J` / `Ctrl+J` 放大回复区；`Esc` 关闭选区浮层、搜索栏或导入菜单。
- 选中论文后，阅读器顶部“文档详情”即使在 PDF 加载中也可打开。详情包含标题、原始文件名、页数、可读大小与精确字节数、本地时间的导入日期、项目、来源、论文 ID、实际 PDF 绝对路径及元数据 / 批注目录。来源只允许无账号密码的 HTTP(S) 链接；本地上传显示“本地文件导入”。可复制 PDF / 目录路径，剪贴板不可用时按提示手动选择复制；也可打开原始 PDF。关闭按钮或 Escape 关闭，切换论文 / 项目会清除详情。
- 详情路径来自 `GET /api/papers/{id}/details`，由后端按当前存储根目录解析（支持 `PDF_READER_DATA_DIR`），前端不推测用户目录。新上传保留文件名大小写；链接导入使用最终 URL 中的 PDF 文件名，无法获取时为 `paper.pdf`。旧论文使用已有文件名记录，无法恢复过去未保存的原名。
- 左下角可切换浅色 / 深色 / 跟随系统外观。

### 选中文字

- 选中文字后，浮层提供解释、推导、图表、审稿、迁移、翻译六个快捷动作，也可以带着选段自由提问，或高亮并保存备注（多种颜色）。
- **翻译**只把选中的文字发给模型，不读论文、不带对话历史，译文逐字显示在右侧对话里，短句实测约 1 秒出全文。同一段文字的译文缓存在论文目录的 `translations.json`，再次翻译直接返回，不再调用模型。
- 其他快捷动作和自由提问交给 Agent：它会按需读全文、图表和页面原图，所以比翻译慢。

### 导读

- 右栏“导读”标签默认显示从 PDF 提取的摘要或开头，不调用模型，不产生费用。
- 需要时点“生成深度导读”：Agent 通读全文并查看关键图表，生成问题、核心想法、方法、关键公式、主要结果、存疑之处和阅读路线；之后的对话会参考它。只有点击生成或重新生成时才产生费用，批量导入不会自动生成。

### 对话与记忆

- 回复中的引用精确到段落（如 `p.5#16`）：悬停可预览原文，点击后跳转并短暂高亮该段。
- 同一论文可新建独立对话，切换时只加载当前会话历史；支持手动改名、根据首个问题自动命名、标题搜索、归档和删除。默认历史对话允许改名，不允许归档或删除。
- 设置中填写“你的研究背景”，Agent 会据此选择例子和讲解深度。
- 每个项目有独立的研究记忆，保存长期目标、问题、方法、约束和研究线索，可在设置里查看、编辑、增删或立即整理。回答时按关键词选最多 3 条相关记忆；每个项目累计 10 轮对话或距首次活动 24 小时，由 Harness 在后台整理一次，会产生少量费用。

## 模型配置

设置中保存 API Key、模型和 Base URL，然后点击“测试连接”。测试使用真实 Harness SDK 小请求，会产生少量 API 费用。

当前安装 Harness 的 deepseek-official provider 使用 Messages 协议：

- Base URL: `https://api.deepseek.com/anthropic`
- 模型: `deepseek-flash`

原来的 `https://api.deepseek.com` 会出现 HTTP 404，应用会自动迁移这个旧配置。Key 存于 `~/.config/deepseek-pdf-reader/settings.json`，文件权限 0600，页面不回传 Key。请勿把本地服务暴露到公网。

翻译不经过 Harness：后端用同一组 Key、模型和 Base URL 直接请求 `<Base URL>/v1/messages`，关闭思考并流式返回。

导入时为每篇论文生成 Agent 资料：带段落编号的 `fulltext.md`、每页图片 `pages/pN.jpg`、按图注裁剪的 `figures/`（索引在 `figures.md`）以及 `blocks.json`（段落坐标，用于引用高亮）。旧论文在首次打开或提问时自动补齐，每篇约 2–15 MB。讲解协议写在论文目录的 `AGENTS.md`，由 Harness 自动加载；Agent 用 `read_image` 查看公式、图表原图（`deepseek-flash` 支持图像输入）。扫描件没有文字层，暂不支持全文搜索和段落引用。独立会话保存在 `.data/harness/`。高亮备注单独保存 JSON，暂未嵌入导出 PDF。

当前 Harness SDK（0.2.1rc2）只转发完整的模型步骤，没有逐字流：回复区实时显示 Agent 正在阅读的文件、查看的图片和每一步的文字。翻译不走 Harness，所以能逐字显示。

## 品牌标志

DR 标志是 64×64 的 SVG，同一份图形保存在三处，修改时需同步：

- `frontend/src/Mark.jsx`：侧栏、欢迎页和研究助手头像，颜色跟随主题。
- `frontend/public/favicon.svg`：浏览器标签图标。
- `extension/popup.html`：扩展弹窗顶部。

扩展图标 `extension/icon16.png`、`icon48.png`、`icon128.png` 由 favicon 导出：

```sh
.venv/bin/python -c "import pymupdf; p = pymupdf.open('frontend/public/favicon.svg')[0]; [p.get_pixmap(matrix=pymupdf.Matrix(s/64, s/64), alpha=True).save(f'extension/icon{s}.png') for s in (16, 48, 128)]"
```

## 验证

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
node --test extension/tests/popup.test.cjs
cd frontend
node --test tests/*.test.mjs
npm run build
npx playwright test
```

浏览器自动测试使用模拟 API 和有效 PDF；真实模型需在本机设置 Key 后测试。

## 项目结构

```text
backend/     FastAPI 服务、PDF 解析、模型调用与项目记忆
frontend/    React + Vite 阅读界面，PDF.js 渲染与 KaTeX 公式
extension/   Chrome / Chromium 论文收藏扩展
npm/         macOS 启动器与 npm 打包入口
scripts/     源码启动与白名单发布打包
tests/       后端与发布检查
```

## 限制与反馈

- npm 启动器目前仅支持 macOS；其他系统请使用源码方式。
- 扫描件暂不提供 OCR，因此没有文字层的 PDF 不支持全文搜索和段落引用。
- 高亮备注保存在本地 JSON，暂未嵌入导出 PDF。
- 应用仅供本机单用户使用，请勿将服务暴露到公网；Agent 工作目录不是操作系统沙箱。

问题与功能建议请提交到 [GitHub Issues](https://github.com/AdamW627/deep-reader/issues)，贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

项目源码采用 [GNU AGPL-3.0-only](LICENSE)。第三方组件沿用各自许可证；模型服务不包含在本项目授权中，需要单独配置账号与 API Key。

已发布的 npm `0.1.0` 元数据仍标记为 `UNLICENSED`；本仓库已采用 AGPL-3.0-only，npm 元数据与许可证文件将在后续版本发布时同步。
