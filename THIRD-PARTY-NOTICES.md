# 本项目许可

本项目的部署脚本和文档统一采用 GNU GPL-3.0，许可正文见根目录 LICENSE。第三方插件保留其原有 GNU GPL-3.0 许可证；Ollama 和模型仍适用各自的上游许可。

# 第三方组件与来源

本部署包用于组合已有的本地推理软件、公开模型与 Obsidian 插件。各组件仍适用各自的许可证；本文件不改变这些条款。

## LLM Text Assistant for Obsidian

- 作者 / 上游：s1t5，<https://github.com/s1t5/LLM-Text-Assistant-Obsidian>
- 参考版本：1.1.0
- 固定源码提交：`7e32d36f3a0dc7ef07689505659c874e53c5fea3`
- 样式修复提交：`2b0876a19740828f7b6cc88e8c79a1cfbd1cbe39`
- 许可证：[GNU General Public License v3.0](https://github.com/s1t5/LLM-Text-Assistant-Obsidian/blob/7e32d36f3a0dc7ef07689505659c874e53c5fea3/LICENSE)
- 安装文件：`main.js`、`manifest.json`、`styles.css`。

部署包附带的插件基于上述提交；`main.js` 和 `manifest.json` 来自上游。`styles.css` 的修复提交修改了 4 处颜色声明：Review 删除、新增文本均使用 `--text-normal`，背景分别使用 `rgba(var(--color-red-rgb), 0.16)` 与 `rgba(var(--color-green-rgb), 0.16)`。修改日期为 2026-11-04。这是本部署包携带的修复，不能据此宣称原仓库已发布相同版本。

分发本包时，请一并保留插件许可正文、对应源码、构建文件和上述修改说明。上游固定提交的完整源码可从[提交页面](https://github.com/s1t5/LLM-Text-Assistant-Obsidian/tree/7e32d36f3a0dc7ef07689505659c874e53c5fea3)获取。不要把部署包中的插件标注为独立原创作品。

## Ollama

- 上游：<https://github.com/ollama/ollama>
- 固定下载版本：`v0.40.14`（仅当目标电脑未安装 Ollama 时下载）。
- 上游项目许可证：[MIT License](https://github.com/ollama/ollama/blob/v0.40.14/LICENSE)。
- Windows 安装器来自官方发行源，运行前检查完整 SHA-256 与 Authenticode 签名。

基础部署包不内置 Ollama 安装器。若将下载缓存一同分发，仍需保留随安装器和其依赖提供的第三方许可，不以本文件替代它们。

## Tencent Hy-MT2 1.8B GGUF

- 发布者：Tencent。
- 官方模型：<https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF>
- 官方下载备选：<https://modelscope.cn/models/Tencent-Hunyuan/Hy-MT2-1.8B-GGUF>
- 文件：`Hy-MT2-1.8B-Q4_K_M.gguf`
- SHA-256：`dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699`
- 官方[模型卡](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/blob/a0c709d9fac510f2c807aa3af52872340dc37a4a/README.md)标注许可证为 **Apache-2.0**；分发时应保留上游提供的许可与归属信息，并以所下载固定版本的官方发布材料为准。

基础部署包不内置模型权重。`hy-mt2-obsidian:Q4_K_M` 是将上述权重与本地提示模板组合后创建的 Ollama 名称，不是 Tencent 新发布的独立模型。适配模板不修改模型权重。

## Obsidian

Obsidian 由用户自行安装，本包不附带其程序文件。官网与使用条款见 <https://obsidian.md>。
