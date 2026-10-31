# 论文阅读器 Chrome 扩展

Manifest V3 中文扩展，将当前在线 PDF 或论文网页发送给本地阅读器。扩展无需构建，无第三方依赖或远程脚本。

## 安装与使用

1. 启动本地阅读器（默认 http://127.0.0.1:8765）。
2. 打开 Chrome 的 `chrome://extensions`，开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择此 `extension` 目录（内含 manifest.json）。
4. 打开本地阅读器的「设置」，复制收藏令牌。阅读器使用本机接口 `GET /api/capture-token` 提供 `{ "token": "…" }`；扩展不会自动获取令牌。
5. 点击扩展图标，展开「连接设置」，粘贴令牌并保存。如有需要修改阅读器端口。配置保存在 `chrome.storage.local`，不使用同步存储。
6. 切到在线 PDF 或论文网页，点击扩展图标，再点「收藏当前页面」。发送期间请保持弹窗打开；看到成功提示后在阅读器查看论文或处理状态。

本目录已提供扩展文件，但未替用户在浏览器内安装或完成真实 Chrome 手动测试。更新文件后可在扩展管理页面点击重新加载。

## 图标

`icon16.png`、`icon48.png`、`icon128.png` 由 `frontend/public/favicon.svg` 导出；弹窗顶部的 DR 标志内嵌在 `popup.html`。修改方法见根目录 README 的“品牌标志”一节。

## 实际行为

- 发送 `POST /api/papers/import`，JSON 正文为 `{ "url": "…", "title": "…" }`，请求头包含 `Content-Type: application/json` 和 `X-Capture-Token`。
- 对普通 http(s) 页面，通过 `chrome.scripting.executeScript` 读取 `citation_pdf_url`、`og:title`；标题缺失时使用文档或标签标题。相对 PDF 地址按网页 baseURI 解析；无有效元数据则发送当前标签 URL。
- 对以 .pdf 结尾的 URL 直接使用标签 URL。其他形式的 PDF 地址可能触发一次脚本注入尝试；Chrome 内置查看器拒绝注入时仍回退到标签 URL，不把注入失败误报为收藏失败。
- 成功仅表示后端以成功 HTTP 状态接受请求，不保证 PDF 已下载或解析完成；请以阅读器状态为准。
- 认证失败提示重新复制令牌；连接失败、后端 HTTP 错误和两分钟超时分别提示。超时或关闭弹窗后，请先检查阅读器以免重复提交。

## 权限与限制

- `activeTab`：仅在用户点击扩展后访问当前标签；`scripting`：读取当前网页元数据；`storage`：保存地址和令牌。
- 默认 host_permissions 仅 `http://127.0.0.1/*` 与 `http://localhost/*`。Chrome 匹配模式不能按端口限制，所以弹窗校验并使用用户配置的端口。仅允许 HTTP 本机根地址，不支持远程或带路径的阅读器地址。
- 无全站 host_permissions、后台抓取、Cookie 权限、内容脚本或远程代码。网页元数据只在用户操作时读取。请求不携带浏览器登录凭据，并禁止自动跟随后端重定向。
- 仅支持 http(s) 来源。`file://` 本地 PDF、`chrome://`、扩展内部页面等不能直接收藏。若标签显示的是其他扩展的查看器地址，请打开原始在线 PDF URL。
- 扩展只发送链接与标题，不读取 PDF 内容、不上传页面、Cookie 或登录信息。后端自行获取公共 URL；订阅、登录、验证码、反爬或网站权限限制可能使导入失败。扩展不能自动抓取已登录站点 Cookie，也不会绕过访问控制。
- 网页没有可用 PDF 链接时，后端是否能解析网页取决于其支持范围；普通网页不保证都能导入。公开 arXiv 等链接由后端处理。
- 令牌保存在本地扩展存储中，并非系统钥匙串；不要共享令牌或浏览器配置目录。需要更新令牌时，在连接设置粘贴新值并保存。

## 验证

在本目录运行：

```sh
node --check popup.js
node --test tests/popup.test.cjs
python3 -m json.tool manifest.json
```

自动测试模拟 Chrome API 和本机 HTTP 请求，覆盖元数据、PDF 回退、禁止内部页面、配置持久化、令牌头和失败提示；它不替代真实 Chrome 与实际后端的端到端测试。
