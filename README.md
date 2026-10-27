# ego-literature-download

通过 ego lite 的可见浏览器流程下载并核验学术论文 PDF 的 Codex skill。它复用用户当前已有的出版社或机构登录态，支持 DOI、题名、文章 URL 和论文列表，并检查 PDF 有效性与论文身份。

当前版本 `0.5.15`：给出 DOI 或文章 URL 后直接打开并按页面行动。多篇任务不用预先分类出版社或访问路线；各篇独立推进，viewer 的 Download 控件就绪后及时触发并实时反馈。普通单篇报告必要结果，不默认生成完整 manifest；批量、恢复、用户接管和复现任务保留逐篇证据记录。PDF 自动身份明确时可标记 `auto_verified`；只有身份歧义、文本不足、扫描件、封面或用户要求严格检查时才需视觉复核。

## 使用

安装 `ego-browser` 后，在 Codex 中调用：

```text
用 $ego-literature-download 下载 DOI 对应的论文，把 PDF 保存到指定目录并核对论文身份。
```

PDF 核验 helper 需要 Python 3.10+ 和 `pypdf`：

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
& .\.venv\Scripts\python.exe scripts/verify_pdf.py .\paper.pdf --doi 10.1234/example --title "Expected article title"
```

浏览器访问必须使用当前安装的 `ego-browser` skill 和 ego lite。skill 不读取或复制 cookies、密码、OTP、签名 URL 或完整浏览器状态，也不使用桌面自动化替代浏览器 API。机构访问、VPN、WebVPN 和安全验证由用户当前环境决定；成功下载需要浏览器下载证据、有效 PDF 和明确的身份匹配。出现身份冲突或自动证据不足时，再检查首页。

## 目录

- `SKILL.md`：入口工作流。
- `agents/openai.yaml`：Codex 展示信息。
- `scripts/`：下载捕获、候选文件保存、PDF 核验和内容分配 helper。
- `references/`：路径、权限、出版社路线、并行捕获和证据记录说明。

共享下载池会在操作前探测当前下载页结构；Ego Lite `0.6.1.13` 已有真实共享池验证，其他版本只要通过结构探测即可继续，探测失败会在浏览器操作前停止。单篇捕获和 PDF 核验仍可独立使用。

## 许可证

本项目采用 MIT License，见 [LICENSE](LICENSE)。
