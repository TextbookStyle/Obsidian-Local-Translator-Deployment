# Obsidian 本地轻量翻译部署包

在 Windows 上为已有的 Obsidian 仓库接入 **Ollama + Hy-MT2 1.8B Q4_K_M + LLM Text Assistant**。完成配置后，在 Obsidian 中选中文本并执行 Translate，即可使用本机模型翻译。

本包以本地翻译为目标。安装阶段需要联网下载；推理阶段调用 `127.0.0.1`，不需要登录 Ollama，也不需要 API Key。

## 开始前

- 使用 Windows 10 22H2 或更新版本、Windows 11，Intel/AMD **x64** 系统；本包不支持 ARM64 或 32 位系统。Ollama 的系统和驱动要求以[官方 Windows 文档](https://docs.ollama.com/windows)为准。
- 先安装 Obsidian **1.8.7 或更新版本**，并至少创建或打开过一个笔记仓库。本包不负责安装 Obsidian。
- 提前关闭 Obsidian，避免它在退出时把正在运行的设置写回磁盘。脚本不会强制结束 Obsidian，也不会修改笔记正文。
- 首次安装会下载约 **2.81 GB**：Ollama 安装器约 1.68 GB，GGUF 模型约 1.13 GB。安装、模型导入及下载临时文件还需要空间，建议预留至少 **15 GB**；缓存与用户目录在不同磁盘时，两边都要留足空间。

  建议至少 8 GB 内存，使用其他应用较多时预留更多；这不是对所有文本长度和硬件组合的最低运行保证。

## 一键安装

1. 将整个压缩包解压到可写目录。不要直接在压缩包预览中运行文件。
2. 关闭 Obsidian。
3. 双击 `Install.cmd`，按提示选择 Obsidian 仓库。没有出现在列表中时，输入实际的仓库文件夹路径。
4. 等待下载、校验、模型导入和翻译连通性检查完成。下载中断后可以重新运行同一脚本。
5. 打开 Obsidian。在“设置 → 第三方插件”中允许社区插件，并确认 **LLM Text Assistant** 已启用。脚本不会替用户关闭受限模式。
6. 在一份测试笔记中选中英文，打开命令面板，执行 **LLM Text Assistant: Translate**。检查 Review changes 中的译文后，再选择 **Apply**。

这里的“一键”指自动处理下载、模型注册和指定仓库的插件配置。首次运行仍需用户选择仓库，并由用户在 Obsidian 内允许社区插件。

### 命令行与参数

熟悉 PowerShell 的用户可以指定仓库和下载并发数：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -VaultPath "D:\Notes\MyVault" -Connections 8
```

`Install.cmd` 使用的执行策略选项只作用于该次 PowerShell 进程，不修改系统执行策略。

### 脚本做了什么

1. 检查本机 Ollama；已安装时复用，没有时下载固定版本的官方安装器，校验 SHA-256 和 Windows 数字签名后安装。早于本包验证版本的已有安装需要用户先更新，不会静默升级或降级。
2. 检查本地模型 `hy-mt2-obsidian:Q4_K_M` 及其权重摘要、模板、关键参数。不存在时复用本机已校验权重或下载 Tencent 官方 GGUF，并用随包的适配模板在本机创建模型；已有同名模型不符合预期时停止，需用户显式选择重建。
3. 使用与插件一致的消息格式请求本地翻译接口，确认短句可译为中文。
4. 向所选仓库安装固定版本的 LLM Text Assistant，备份相关旧文件，合并其配置并启用该插件。

脚本不会上传笔记、创建账号、请求密钥、删除用户模型或修改系统代理。已有 Ollama 服务的全局设置由用户管理；本包只将插件指向本地接口。

## 本地连接与首次默认配置

本包为翻译配置了独立提示词，要求保留 Markdown 结构、链接、代码和占位符。模型输出仍应由用户复核；长文本可以按段翻译。

已有配置中的目标语言（未显式传入 `-TargetLanguage` 时）、翻译提示词、temperature、超时和笔记上下文字符数字段只要非空就会保留，上表为首次安装或这些字段缺失时的默认值。需要更换已有目标语言时，可在 Obsidian 插件设置中修改。API 地址、模型名、空 API Key，以及 Review / 上下文 / Free Prompt 开关由本方案固定配置。

### 给第二台电脑复用下载

保留部署包下的 `cache` 目录，将整个部署包连同缓存一起复制到另一台电脑，或用 `-CacheDirectory` 指定同一个可访问的缓存目录。脚本仍会校验缓存文件，不以“文件存在”作为下载完成的依据。模型和安装器没有内置在基础压缩包中。

## 日常启停

- **从部署包操作：** `Start-Translator.cmd` 启动本地服务，`Status.cmd` 查看状态，`Stop-Translator.cmd` 卸载该模型以释放内存/显存。Stop 不退出整个 Ollama 服务。
- **开始翻译：** 从开始菜单打开 Ollama，再在 Obsidian 中执行 Translate。模型会按需加载。
- **查看是否驻留：** 在 PowerShell 中运行 `ollama ps`，同时可以看到使用 CPU 还是 GPU。
- **立即释放模型内存/显存：** 运行 `ollama stop hy-mt2-obsidian:Q4_K_M`。这不删除模型，下次翻译时会再次加载。
- **完全退出 Ollama：** 在系统托盘右键 Ollama，选择 Quit / 退出。下次需要时从开始菜单打开。

如果服务由本部署包启动而没有托盘图标，先卸载已加载的模型，再在部署包目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Manage.ps1 -Action Quit` 关闭它。该操作只处理在 `%LOCALAPPDATA%\ObsidianLocalTranslator\server.json` 中记录且可验证身份的自启动服务，不会结束其他来源的 Ollama 服务。

Ollama 默认在模型闲置约 5 分钟后卸载；已有用户设置可能改变这个时间。详见[官方 FAQ](https://docs.ollama.com/faq)。

## 故障排查

官方应用的运行日志通常在 `%LOCALAPPDATA%\Ollama\server.log`；本包启动的后台服务日志在 `%LOCALAPPDATA%\ObsidianLocalTranslator\server.stderr.log`。

## 上游与许可

本项目的部署脚本和文档采用 **GNU GPL-3.0**，见 [LICENSE](LICENSE)。第三方组件继续适用各自的许可证，详见下列来源与许可说明。

- [Ollama 文档](https://docs.ollama.com/llms.txt)、[硬件支持](https://docs.ollama.com/gpu)、[OpenAI 兼容接口](https://docs.ollama.com/api/openai-compatibility)。
- [Tencent Hy-MT2 GGUF 官方模型页](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)、[ModelScope 官方仓库](https://modelscope.cn/models/Tencent-Hunyuan/Hy-MT2-1.8B-GGUF)。
- [LLM Text Assistant 上游](https://github.com/s1t5/LLM-Text-Assistant-Obsidian)。
- 第三方来源、许可证和修改说明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)