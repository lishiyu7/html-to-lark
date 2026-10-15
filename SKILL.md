---
name: html-to-lark
description: 把本地单文件 HTML 网页发布成飞书云文档——正文整篇是一个 HTML 块，样式、脚本、交互、受众开关全部原样保留。当用户说「把这个 HTML 发到飞书 / 发成飞书文档 / 让同事看这个网页 / 不想部署网站怎么分享 / 转成飞书文档发给别人」，或刚用 answer-me-with-html 产出单文件 HTML 后想要一个可转发的链接时使用。不用于把 HTML 重排成飞书原生排版（那是重建内容，不是发布），也不用于部署公网站点。
---

# html-to-lark

本地 HTML → 飞书云文档，正文**整篇一个 HTML 块**。同事点链接就能看 —— 不需要域名、不需要 CI、不需要内网穿透。

这就是它存在的唯一理由：**省掉「部署网站」这一步**。

## 何时用 / 何时不用

**用**：手上有份单文件 HTML（尤其是 `answer-me-with-html` 的产物），想让别人看到它本来的样子。
**不用**：要把内容变成飞书原生排版（可搜索、可评论——那得重建内容，是另一件事）；要部署公网站点。

## 前置

```bash
lark-cli --version                                    # 需 ≥ 1.0.98（html5-block 在此之前未被内置文档收录）
lark-cli docs +create --help | grep reference-map     # 有输出即版本 OK
lark-cli auth login --domain docs --domain drive      # 未授权时
```

## 流程

### 1 准备

```bash
node scripts/prepare.js <输入.html> --out-dir .h2l-build
```

产出 `.h2l-build/doc.xml` + `block.html`，并打印报告。脚本承包机械部分：校验（含 500KB 硬上限）、扫描引用、扫描并剥除旧版 chrome、注入三条 meta、标题与 alt 的回落、组装 XML。

### 2 把报告讲给用户（**不要跳过**）

报告里有两类信息必须转述，否则用户会拿到一份坏页面：

- **本地相对引用 N 处** → 块内**一定加载不到**。请用户先处理（内联，或改成可公开访问的 URL）。
- **标题 / description 的回落提醒** → `description` 决定块的 `alt`，而 `alt` 是这个块唯一的索引面。

### 3 发布

```bash
cd .h2l-build
lark-cli docs +create --doc-format xml --content "@./doc.xml" --parent-position my_library --as user
```

**不要写 `--reference-map`** —— CLI 会自动把 `path="@./block.html"` 展开进 `reference_map`（实测确认）。

### 4 权限核查（默认只读，别多此一举）

```bash
lark-cli drive permission.public get --token <document_id> --type docx --as user
```

- `link_share_entity == "tenant_readable"` → 已是「组织内获得链接的人可阅读」，**到此为止**。（多数租户新建文档默认就是它。）
- 否则才改，且 **必须先向用户确认** —— 该命令是 high-risk-write，CLI 明令 agent 不得自行加 `--yes`：

```bash
lark-cli drive permission.public patch --token <document_id> --type docx \
  --data '{"link_share_entity":"tenant_readable"}' --as user --yes
```

### 5 回执（四项必须齐全）

1. **文档链接**
2. **权限现状**（原文回显，如「分享范围：组织内获得链接的人可阅读」）
3. **页宽提示**（原文见下，**必须带那两句注意**）
4. **警告清单**（本地引用、回落提醒等）

## 更新已有文档

```bash
# 1) 先拿当前 block id —— block_replace 后旧 id 失效，每次都要重新 fetch
lark-cli docs +fetch --doc <文档URL> --detail with-ids --as user
# 2) 原地替换该 html5-block
lark-cli docs +update --doc <文档URL> --command block_replace --block-id <id> \
  --content '<html5-block path="@./block.html"></html5-block>' --as user
```

文档 URL 不变，同事刷新即新版。若文档里有**多个** html5-block，先问用户替换哪一个，不要自作主张。

## 硬约束

全部为**实测**结论，不是从文档抄的：

| 约束 | 值 | 说明 |
|---|---|---|
| HTML 总长 | **≤ 500KB** | 平台硬上限，超了硬失败。不是能商量的策略问题 |
| 文档可用宽度 | **≈ 820px** | **所有读者一致**。排版按这个宽度验收 |
| 三条 meta | `use-iframe` / `html-box-height-mode` / `description` | 必须自己注入；CLI 原样写入、**不校验**，写错了不报错 |
| `description` → 块的 `alt` | — | 实测坐实。alt 是这个块**唯一的索引面** |
| 本地相对引用 | **一定加载不到** | 块只是存进 `reference_map` 的一段文本，无托管、无同目录文件 |
| 外部 URL | **可以加载** | 实测外部 JS/CSS/图片全通、页面无 CSP。但读者网络不通该域名仍会失败 |
| 高度模式 | 默认 `auto` | 长页完整展开；单屏类（deck / dashboard）用 `--height viewport` |

## 页宽提示（回执第 3 项，原文照用）

> 💡 阅读更佳：打开文档右上角 **···** → **页宽设置** → 选**较宽**或**全宽**。
> 注意：这个设置**只对你自己生效**，不影响别人看到的效果；转发时建议一并告诉同事。

**为什么必须带第二句**：页宽是**每个读者本地的查看偏好**，不是文档属性。飞书帮助中心明载「仅对设置者生效，不会影响其他阅读者」，且「无法将全宽设为默认值」，官方 API 也没有这个字段。不写清楚，用户会以为设一次所有人都宽了。

（我们踩过这个坑：曾计划把「默认全宽」做进本 skill，核实后撤销 —— 原理上不可行，且非官方内部接口也只对设置者自己生效。）

## 参考

- [references/lark-html5-block.md](references/lark-html5-block.md) — html5-block 的完整事实与实测记录。
