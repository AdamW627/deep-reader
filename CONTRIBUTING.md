# 参与贡献 / Contributing

欢迎通过 [Issues](https://github.com/AdamW627/deep-reader/issues) 反馈问题、讨论功能，或提交 Pull Request。源码安装步骤见 [README](README.md#从源码运行)。

## 反馈问题

请说明系统、Node/Python 或 npm 包版本、复现步骤、预期行为与实际行为。尽量使用可公开分享的最小 PDF 或合成样例。不要上传 API Key、收藏令牌、私有论文、个人对话、运行目录或未经检查的日志。

安全问题请参阅 [SECURITY.md](SECURITY.md)，避免在公开 issue 披露可利用的漏洞细节。

## 本地开发

后端：

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765 --reload
```

在另一个终端启动前端开发服务（Vite 将 `/api` 代理到后端）：

```sh
cd frontend
npm ci
npm run dev
```

## 提交前检查

```sh
.venv/bin/python -m pytest tests -q
node --test extension/tests/popup.test.cjs
npm --prefix npm test
cd frontend
node --test tests/*.test.mjs
npm run build
npx playwright install chromium
npx playwright test
```

自动测试使用临时数据或模拟 API，不需要真实模型 Key。涉及真实模型的变更，请在本机单独验证，并在 PR 中说明验证范围。

PR 请描述具体问题、变更后的行为和验证结果。功能或用户可见行为变化请同步更新 README 与 CHANGELOG。请遵循现有代码风格，避免混入无关格式化；不要提交 `.data/`、`.env*`、PDF、日志、虚拟环境、依赖或构建产物。

贡献按本项目的 [AGPL-3.0-only](LICENSE) 许可证提供。

## English

Please open an issue with your environment, reproduction steps, expected behavior, and actual behavior. Use public or synthetic PDF fixtures and remove private paths, paper content, conversation history, and credentials. Report security issues through the process in SECURITY.md.

Follow the source setup in README.en.md, then run the checks above. Automated checks use temporary data and mock APIs; they do not require a live model key. Describe any separate live-model validation in your PR. Keep changes focused, update documentation for user-facing changes, and submit contributions under AGPL-3.0-only.
