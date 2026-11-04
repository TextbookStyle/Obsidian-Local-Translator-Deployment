# 0.1.0 验证记录

日期：2026-11-04（UTC+8）。

## 已完成

- Windows PowerShell 5.1.19041.5007 与 PowerShell 7.6.5：所有部署脚本语法检查通过。
- 两种 PowerShell：`tests/Test-All.ps1` 通过。
- 下载模块：并行 Range、完整哈希缓存复用、已完成分段恢复、无 Range 回退、带响应体的重定向、备用源、错误 Content-Range 拒绝、错误 SHA 保留原目标，以及正确新文件替换过期目标。
- 官方安装器与腾讯 ModelScope 地址：仅请求最终文件的 1 字节，确认 206、Content-Range 和总长与 `assets.json` 一致。
- 临时 Obsidian 库：初装、重复无改动、保留其他插件与未知配置、已有版本保护、损坏 JSON 拒绝、备份及还原、中文和空格路径。
- 模型识别：权重摘要、模板、完整参数值及停止标记校验，拒绝同名但不兼容的模型。
- 已安装 Ollama 0.40.14 的本机：从已校验 GGUF 直接创建一次性模型，使用包内模板成功翻译与插件相同格式的流式请求；随后在临时库安装插件并验证第二次运行不重复修改。
- 实际翻译测试输出：`今天天气非常好。`；8192 上下文，显存约 1.79 GB。
- 一次性模型已删除；测试启动的后台服务已退出，原有模型与个人笔记库未改动。
- ZIP 解压到含中文及空格的路径后，实际运行只读检查和 Start / Status / Stop / Quit 入口通过；插件文件摘要匹配，压缩包不含默认缓存、日志、测试产物或 Git 元数据。

## 验证范围

运行机器为 Windows 10 Enterprise LTSC build 19044、约 32 GB 内存、RTX 3060 Laptop 6 GB。该 Windows build 比当前 Ollama 文档列出的 22H2 要求旧，本包面向的受支持目标仍是 Windows 10 22H2+ / Windows 11 x64。

尚未在全新 Windows 电脑上重新下载完整安装器并执行首装，也没有完成跨硬件、跨 Windows 版本或所有 Obsidian 主题的实机测试。没有把本机已有 Ollama 的集成测试当作全新电脑验收。

脚本中的真实接口检查验证模型及插件请求格式；临时库文件测试不等于真实 Obsidian UI 操作测试。首次部署后仍应在测试笔记中核对 Translate、Review、Apply 和 Discard。
