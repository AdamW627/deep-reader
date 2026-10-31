# 安全说明

当前仅支持本机、单用户使用。应用不是 OS 沙箱，也不承诺抵御拥有本机账号权限的程序。具体外发数据见 [PRIVACY.md](PRIVACY.md)。

- 不向公网暴露服务，不绕过 Host / Origin 检查。
- 不把 API Key、收藏令牌、日志、真实论文/对话或个人路径粘贴到公开 issue。
- 模型 Base URL 必须来自你信任的供应商；更换地址等同于更换 Key 与数据的接收方。
- 不在生产环境使用示例 Key，不在仓库或镜像中预置任何凭据。
- 依赖包含 PyMuPDF（AGPL / 商业双许可）及预发布 Harness SDK。发布者应检查依赖许可证及 SDK 工具权限。

## 漏洞报告

请通过 [GitHub 私密漏洞报告](https://github.com/AdamW627/deep-reader/security/advisories/new)提交安全问题。如果该入口不可用，请先开一个不包含漏洞细节的 issue 联系维护者。请勿公开提交可用凭据或私人复现数据；先用合成 PDF 与占位配置复现。
