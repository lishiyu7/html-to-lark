# html-to-lark

把**本地单文件 HTML** 发布成**飞书云文档** —— 正文整篇是一个 HTML 块，样式、脚本、交互全部原样保留。
同事点飞书链接就能看：不需要域名、不需要 CI、不需要内网穿透。

> Publish a local single-file HTML page as a Feishu/Lark doc — the whole body becomes one HTML block.
> Share the doc link instead of deploying a website.

## 为什么需要它

`answer-me-with-html` 这类工具产出的是**本地 HTML 文件**。想给同事看，传统办法是部署网站 ——
要域名、要 CI、要内网穿透，为了「给三个人看一眼」不值当。

飞书文档支持 HTML 块。所以：**发布 → 把链接甩过去**。

## 工作方式

```
输入：说明文档.html（单文件，含样式/脚本/交互）
         │
         ├─ prepare.js   校验 → 内联本地图片 → 注入三条 meta → 组装 XML
         │
输出：.h2l-build/block.html + doc.xml
         │
         └─ publish.js   发布 → 核查分享范围 → 打印回执
                │
         飞书文档链接 ✅  （同事打开即见 HTML 原貌）
```

## 用法

```bash
node scripts/prepare.js 说明文档.html --out-dir .h2l-build
#   ↑ 然后在浏览器打开 .h2l-build/block.html 看一眼（内联图片后效果只有打开才知道）
node scripts/publish.js .h2l-build
```

回执会自动打印：文档链接 / 分享范围 / 页宽提示 / 服务端提醒。

超限、原地更新、拆块等场景见 [SKILL.md](SKILL.md)。

## 依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| `lark-cli` | **≥ 1.0.98** | html5-block 在更早版本的文档里没有 |
| Node | **≥ 10** | 脚本只用标准库，无 npm 依赖 |

**不做事前检查** —— 调用失败时的报错就是最好的提示。

## 验证范围

**Windows 11 + Git Bash + Node v22 + lark-cli 1.0.98** 实测通过。
**macOS / Linux 未验证**：脚本本身跨平台（纯 Node 标准库），但 `publish.js` 定位 CLI 的方式
与安装方式（PowerShell junction）是 Windows 特有的。

## 硬约束速查

| 约束 | 值 |
|---|---|
| HTML 总长 | ≤ **500KB / 每块**（不是整篇文档的上限） |
| 文档可用宽度 | ≈ **820px**，所有读者一致 |
| 本地图片 | 自动内联为 `data:` URI（否则一定加载不到） |
| 其余本地引用 | 一定加载不到，不自动处理 |
| 外部 URL | 可以加载，但读者网络不通该域名会失败 |

## 文档

- [SKILL.md](SKILL.md) — 完整流程、超限拆块、原地更新
- [references/lark-html5-block.md](references/lark-html5-block.md) — 全部实测事实与证据
  （含本项目三次误判的复盘，以及一个 `write-how-to-use` 的上游问题）

## License

MIT
