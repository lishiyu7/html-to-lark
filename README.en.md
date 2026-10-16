# html-to-lark

[中文](README.md) | English

Publish a **local single-file HTML page** as a **Feishu/Lark doc** — the entire body becomes one HTML block,
with styles, scripts and interactions preserved exactly as written.
Colleagues click a Feishu link and see it: no domain, no CI, no tunnelling.

## Why this exists

Tools like `answer-me-with-html` hand you a **local HTML file**. To show it to a colleague, the traditional
answer is "deploy a website" — domain, CI, tunnelling. That is a lot of machinery for "three people want a peek".

Feishu docs support HTML blocks. So: **publish it → paste the link.**

## How it works

```
input: guide.html  (single file, styles / scripts / interactions included)
         │
         ├─ prepare.js   validate → inline local images → inject three metas → build the XML
         │
output: .h2l-build/block.html + doc.xml
         │
         └─ publish.js   publish → check share scope → print the receipt
                │
         Feishu doc link ✅   (colleagues open it and see the HTML as-is)
```

## Install

**Hand this repo link to your agent and let it install:**

> Install this skill for me: https://github.com/lishiyu7/html-to-lark

Or do it manually:

```bash
git clone https://github.com/lishiyu7/html-to-lark.git ~/.claude/skills/html-to-lark
```

To keep the repo somewhere else and link it into your skills directory
(**so the installed copy can never drift from the source**):

```bash
# macOS / Linux
ln -s /path/to/html-to-lark ~/.claude/skills/html-to-lark
```
```powershell
# Windows
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\html-to-lark" -Target "D:\path\to\html-to-lark"
```

> The skills root differs per agent: Claude Code reads `~/.claude/skills`, DSH reads `~/.dsh/skills`
> (or `~/.agents/skills`). **Installing into a directory nobody scans = installed but never triggered** —
> after installing, confirm it shows up in the skill list.

### Dependencies

| Dependency | Version | Notes |
|---|---|---|
| `lark-cli` | **≥ 1.0.98** | html5-block is missing from earlier versions' docs |
| Node | **≥ 10** | scripts use only the standard library, no npm dependencies |

```bash
lark-cli auth login --domain docs --domain drive
```

**No need to pre-flight anything** — whatever is missing will say so in the error when you call it.

## Usage

Once installed, just say:

> Publish this HTML to Feishu: `/path/to/guide.html`

It runs three steps (prepare → **you take a look in the browser** → publish) and hands you a Feishu doc link.

Three day-to-day operations, in plain language:

| You want to | Say |
|---|---|
| Publish a new one | "Publish this HTML to Feishu: `guide.html`" |
| Update the existing doc after editing locally | "Update that Feishu doc: \<doc link\>" |
| **Someone edited the block inside Feishu** | "Pull that doc down first: \<doc link\>", **then edit and re-upload** |

> Why the third row matters: the block is a **one-way projection** of the local HTML. If someone edits the
> block in Feishu, that edit exists only inside the doc, and a plain update silently overwrites it.
> Hence the order: **pull → edit → upload**.
> The tool guards this for you: when it detects out-of-band edits it **refuses to overwrite** and tells you
> to pull first (`--force` overrides, deliberately).

## CLI

```bash
# create
node scripts/prepare.js guide.html --out-dir .h2l-build
node scripts/publish.js .h2l-build

# update in place (the link is unchanged)
node scripts/prepare.js guide.html --out-dir .h2l-build
node scripts/publish.js .h2l-build --doc <doc link>

# pull the block back out of the doc
node scripts/pull.js <doc link> --out pulled.html
```

The receipt prints automatically: doc link / share scope / page-width tip / server warnings.

Splitting an oversized page, multi-block docs and other edge cases: see [SKILL.md](SKILL.md).

## Hard limits at a glance

| Limit | Value |
|---|---|
| HTML length | ≤ **500KB per block** (not a limit on the whole document) |
| Usable doc width | ≈ **820px**, identical for every reader |
| Local images | inlined automatically as `data:` URIs (otherwise they will never load) |
| Other local references | will never load; not handled automatically |
| External URLs | load fine — unless the reader's network cannot reach that host |

## What has been tested

| Environment | Status | Covered |
|---|---|---|
| Windows 11 + Git Bash + Node v22 + lark-cli 1.0.98 | ✅ verified | prepare / oversize splitting / multi-block read+write / permission check / in-place update |
| macOS 15 (arm64) + Node v23 + lark-cli 1.0.98 | ✅ verified | prepare / failure cases / publish (create) / pull round trip |
| Linux | ⬜ not tested | scripts use only the Node standard library; the one platform branch in `cli.js` is the Windows/`.cmd` case, and POSIX resolution shares the macOS path |

Numbers from the macOS run (same machine, same input — re-running yields byte-identical output;
**the fixture is not shipped in this repo**):

| Stage | Result |
|---|---|
| `prepare.js` | all 3 local images (including the one inside a CSS `url()`) inlined as `data:`; block **74,975B** against a 512,000B limit; 3 metas present; no leftover local references. Re-run output is **byte-identical** to the recorded one |
| Failure cases | missing image / `./app.js` / `./style.css` are all flagged; a missing `description` is flagged too |
| `publish.js` | created successfully; share scope read back as `tenant_readable` (anyone in the org with the link can read); **no server warnings** |
| `pull.js` | pulled block is **byte-identical** to `block.html` under `cmp` → lossless round trip |

Having `cli.js` locate `run.js` is **not Windows-specific**: besides `lark-cli.cmd`, it also walks the POSIX
layout (shim in `bin/`, module under `../lib/node_modules/`) and the usual brew / nvm prefixes. The macOS run
hit the Homebrew `bin` → `../lib/node_modules` path, **with no environment variables set**.

### The one thing that can block you on macOS: credential persistence

`lark-cli` stores the app secret in the **macOS Keychain** and creates a config directory under
`~/Library/Application Support/lark-cli`. When the agent runs in a sandbox that can only write its working
directory, this step fails, along these lines:

```
keychain Set failed: mkdir /Users/<you>/Library/Application Support/lark-cli: operation not permitted
```

The trap: **the app has already been created in your tenant, but no credential was persisted locally** —
the successful scan is itself what misleads you. Two ways out: grant broader file access and re-run, or
attach the existing app with `lark-cli config init --app-id <id> --app-secret-stdin`.
This is a sandbox problem, not a skill problem.

## Docs

- [SKILL.md](SKILL.md) — full workflow, oversize splitting, drift guard *(in Chinese)*
- [references/lark-html5-block.md](references/lark-html5-block.md) — every verified fact and its evidence
  *(in Chinese)*: the macOS end-to-end run, post-mortems on this project's own misjudgements, and an upstream skill issue

## License

MIT
