# ego-literature-download

通过 ego lite 的可见浏览器流程下载并核验学术论文 PDF 的 Codex skill。它复用用户当前已有的出版社或机构登录态，支持 DOI、题名、文章 URL 和论文列表，并在交付前检查 PDF 有效性、论文身份和首页内容。

## 使用

安装 `ego-browser` 后，在 Codex 中调用：

```text
用 $ego-literature-download 下载 DOI 对应的论文，并把 PDF 和核验记录放进指定目录。
```

PDF 核验 helper 需要 Python 3.10+ 和 `pypdf`：

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
& .\.venv\Scripts\python.exe scripts/verify_pdf.py .\paper.pdf --doi 10.1234/example --title "Expected article title"
```

浏览器访问必须使用当前安装的 `ego-browser` skill 和 ego lite。skill 不读取或复制 cookies、密码、OTP、签名 URL 或完整浏览器状态，也不使用桌面自动化替代浏览器 API。机构访问、VPN、WebVPN 和安全验证由用户当前环境决定；成功下载仍需要 PDF 解析、身份核对和首页目视检查。

## 目录

- `SKILL.md`：入口工作流。
- `agents/openai.yaml`：Codex 展示信息。
- `scripts/`：下载捕获、候选文件保存、PDF 核验和内容分配 helper。
- `references/`：路径、权限、出版社路线、并行捕获和证据记录说明。

共享下载池适配器目前只对 Ego Lite `0.6.1.13` 的下载页结构完成验证；其他版本会在浏览器操作前拒绝，待重新检查后再放行。单篇捕获和 PDF 核验仍可独立使用。

## 许可证

本项目采用 MIT License，见 [LICENSE](LICENSE)。
