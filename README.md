# html-to-lark

把**本地单文件 HTML** 发布成**飞书云文档** —— 正文整篇是一个 HTML 块，样式、脚本、交互全部原样保留。
同事点飞书链接就能看：不需要域名、不需要 CI、不需要内网穿透。

> Publish a local single-file HTML page as a Feishu/Lark doc — the whole body becomes one HTML block.
> Share the doc link instead of deploying a website.

## 为什么需要它

`answer-me-with-html` 这类工具产出的是**本地 HTML 文件**。想给同事看，传统办法是部署网站 ——
要域名、要 CI、要内网穿透，为了「给三个人看一眼」不值当。

飞书文档支持 HTML 块。所以：**发布 → 把链接甩过去**。

## 用法

```bash
node scripts/prepare.js 说明文档.html --out-dir .h2l-build
cd .h2l-build
lark-cli docs +create --doc-format xml --content "@./doc.xml" --parent-position my_library --as user
```

细节（权限核查、原地更新、硬约束、回执格式）见 [SKILL.md](SKILL.md)。

## 前置

- `lark-cli` **≥ 1.0.98**（html5-block 在此之前的文档里没有）
- 已授权：`lark-cli auth login --domain docs --domain drive`

## 硬约束速查

| 约束 | 值 |
|---|---|
| HTML 总长 | ≤ **500KB**（平台硬上限，超了硬失败） |
| 文档可用宽度 | ≈ **820px**（所有读者一致，按此验收排版） |
| 必须注入的 meta | `use-iframe` / `html-box-height-mode` / `description` |
| 本地相对引用 | **一定加载不到**（块无托管、无同目录文件） |
| 外部 URL | **可以加载**（实测，无 CSP）；但读者网络不通该域名仍会失败 |

## 文档

- [SKILL.md](SKILL.md) — 完整流程与回执格式
- [references/lark-html5-block.md](references/lark-html5-block.md) — html5-block 的全部实测事实
  （含本项目两次误判的复盘，以及一个 `write-how-to-use` 的上游问题）

## License

MIT
