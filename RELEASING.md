# 发布流程

## 发布配置

- GitHub：`AdamW627/deep-reader`，公开源码仓库。
- npm：`@adamw_999/deep_reader`；已发布 `0.1.0`，本次 GitHub 发布不重新发布 npm。
- 许可证：AGPL-3.0-only，完整正文在 LICENSE。npm `0.1.0` 的旧元数据仍为 UNLICENSED；下次 npm 发布需提升版本并纳入 LICENSE 与新的仓库元数据。

## 公开前检查

1. 检查项目名称、托管账号、LICENSE 与依赖许可证。第三方组件保留其授权条款。
2. 阅读 PRIVACY.md / SECURITY.md。不要附带真实资料截图、运行日志、个人绝对路径或浏览器配置。
3. 运行下述测试和白名单打包；自动扫描只能发现部分明显问题，不能替代人工审阅。
4. 现有 Git 历史含开发机路径及作者身份信息。不要直接公开现有 `.git`，不要推送旧分支/标签；建议从审核后的源码包创建全新仓库，并先设置你愿意公开的提交身份（例如托管平台的 noreply 邮箱）。原工作区和历史保持不动。

## 验证

```sh
.venv/bin/python -m pytest tests -q
node --test extension/tests/popup.test.cjs
npm --prefix npm test
cd frontend
npm ci
npm run build
node --test tests/*.test.mjs
npx playwright install chromium
npx playwright test
cd ..
python3 scripts/package_release.py release/deepseek-reader-source.tar.gz
```

打包仅选择已跟踪的允许源码以及明确列出的发布文档/脚本；不复制 Git 历史、用户资料、环境、依赖、构建产物或其他未跟踪文件。脚本拒绝覆盖已有压缩包；修改后请使用新的文件名。包内 UID/GID 和作者名清零，不携带本机所有者元数据。

解包后人工检查完整文件列表，在干净目录安装并测试。构建前端应当由接收者自行执行；浏览器扩展直接使用 extension/ 目录。不要用 `zip -r` / 整目录拖拽上传替代本流程。

## 发布状态

打包命令仅准备本地源码包。首次 GitHub 发布从审核后的包创建独立、无旧历史的 Git 仓库，使用公开 noreply 提交邮箱；当前工作区和旧历史保持不动。推送到 main 前，按项目 Git 安全规则取得明确确认。后续发布前重新审阅文件清单并运行检查。
