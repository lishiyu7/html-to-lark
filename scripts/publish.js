#!/usr/bin/env node
'use strict';
/**
 * html-to-lark · 发布阶段
 *
 * prepare.js 之后的固定流程全部固化在这里（省 token、降方差、弱模型也不易走偏）：
 *   1. 发布（新建 / --doc 原地更新）
 *   2. 权限核查（只读；非目标档位才提示改，且需 --confirm-permission-change）
 *   3. 打印回执（链接 + 权限 + 页宽提示 + 服务端 warnings）
 *
 * 全程用 node 直调 CLI 的 run.js（参数列表不经 shell），规避
 * Windows Git Bash 的参数截断 / 全角字符 / `&` 截断等坑。
 *
 * 用法：
 *   node publish.js <构建目录> [--doc <飞书文档URL>] [--confirm-permission-change]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const buildDir = argv.find((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const targetDoc = opt('doc', '');
const confirmPerm = argv.includes('--confirm-permission-change');

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

if (!buildDir) die('用法: node publish.js <构建目录> [--doc <飞书文档URL>] [--confirm-permission-change]');
const absBuild = path.resolve(buildDir);
if (!fs.existsSync(path.join(absBuild, 'doc.xml'))) {
  die('构建目录里没有 doc.xml：' + absBuild + '\n  先跑 prepare.js 生成。');
}

// ── 定位 CLI 入口 ───────────────────────────────────────────────────────
// 为什么要这么绕：Windows 上 spawnSync 直接跑 `lark-cli.cmd` 会 EINVAL（Node ≥20 的安全限制），
// 而「run.js 就在 node 旁边」的假设在 nvm 环境下不成立（实测：node 在 C:\nvm4w，
// CLI 却装在 D:\Software\nodejs\node_global）。所以按可靠性依次找。
const REL = path.join('node_modules', '@larksuite', 'cli', 'scripts', 'run.js');

function fromPathShim() {
  // PATH 里的 lark-cli shim 与 node_modules 同级 → 反推真实入口
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const name of ['lark-cli.cmd', 'lark-cli', 'lark-cli.ps1', 'lark-cli.exe']) {
      if (!fs.existsSync(path.join(d, name))) continue;
      const cand = path.join(d, REL);
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
}

function fromNpmRoot() {
  // 兜底：问 npm 全局根在哪（慢，只在前面都失败时走）
  for (const npmCmd of ['npm.cmd', 'npm']) {
    try {
      const r = spawnSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
      const root = (r.stdout || '').trim();
      if (root) {
        const cand = path.join(root, '@larksuite', 'cli', 'scripts', 'run.js');
        if (fs.existsSync(cand)) return cand;
      }
    } catch { /* 继续 */ }
  }
  return null;
}

function resolveRunJs() {
  if (process.env.LARK_RUNJS && fs.existsSync(process.env.LARK_RUNJS)) return process.env.LARK_RUNJS;
  const nodeDir = path.dirname(process.execPath);
  const cands = [
    fromPathShim(),
    path.join(nodeDir, 'node_global', REL),
    path.join(nodeDir, REL),
    path.join(nodeDir, '..', 'lib', REL),
    '/usr/local/lib/node_modules/@larksuite/cli/scripts/run.js',
    '/usr/lib/node_modules/@larksuite/cli/scripts/run.js',
    fromNpmRoot(),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
const RUN_JS = resolveRunJs();
if (!RUN_JS) {
  die('找不到 lark-cli 的入口 run.js。\n' +
      '  请设置环境变量 LARK_RUNJS 指向它，例如：\n' +
      '    LARK_RUNJS=<...>/node_modules/@larksuite/cli/scripts/run.js');
}

function cli(args, extra = {}) {
  const r = spawnSync(process.execPath, [RUN_JS, ...args], {
    cwd: absBuild, encoding: 'utf8', ...extra,
  });
  if (r.error) die('调用 lark-cli 失败：' + r.error.message);
  const out = (r.stdout || '').trim();
  let json = null;
  try { json = JSON.parse(out); } catch { /* 非 JSON 输出 */ }
  return { status: r.status, stdout: out, stderr: (r.stderr || '').trim(), json };
}

function explain(res, what) {
  const j = res.json;
  const scopes = j && j.error && j.error.hint ? '\n  ' + j.error.hint : '';
  const msg = (j && j.error && j.error.message) || res.stderr || res.stdout || '(无输出)';
  return what + ' 失败：' + msg + scopes;
}

// ── 1. 发布 ─────────────────────────────────────────────────────────────
let res, action;
if (targetDoc) {
  action = '原地更新';
  const fetched = cli(['docs', '+fetch', '--doc', targetDoc, '--detail', 'with-ids', '--as', 'user']);
  if (!fetched.json || !fetched.json.ok) die(explain(fetched, '读取目标文档'));
  const content = (fetched.json.data.document.content || '');
  const ids = [...content.matchAll(/<html5-block[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  if (ids.length === 0) die('目标文档里没有 html5-block，无法原地更新。去掉 --doc 走新建。');
  if (ids.length > 1) {
    die('目标文档里有 ' + ids.length + ' 个 html5-block，无法判断替换哪一个。\n' +
        '  请先人工确认，或去掉 --doc 走新建。');
  }
  // 替换正文 = doc.xml 去掉 <title>
  const xml = fs.readFileSync(path.join(absBuild, 'doc.xml'), 'utf8');
  const body = xml.replace(/<title>[\s\S]*?<\/title>/, '');
  res = cli(['docs', '+update', '--doc', targetDoc, '--command', 'block_replace',
             '--block-id', ids[0], '--content', body, '--as', 'user']);
} else {
  action = '新建';
  res = cli(['docs', '+create', '--doc-format', 'xml', '--content', '@./doc.xml',
             '--parent-position', 'my_library', '--as', 'user']);
}
if (!res.json || !res.json.ok) die(explain(res, action + '文档'));

const doc = res.json.data.document;
// 更新操作【不返回】document_id（只有 new_blocks / revision_id / url），
// 所以不能直接取 doc.document_id —— 否则会把 undefined 当 token 去查权限（踩过）。
const docId = doc.document_id
  || (doc.url || '').split('/').filter(Boolean).pop()
  || (targetDoc || '').split('/').filter(Boolean).pop()
  || '';
if (!docId) die('拿不到文档 ID，后续权限核查无法进行。响应：' + JSON.stringify(res.json).slice(0, 300));
const url = doc.url || ('https://<host>.feishu.cn/docx/' + docId);
const serverWarnings = (res.json.data.warnings || []);

// ── 2. 权限核查（只读；非目标档位才提示改）─────────────────────────────────
let permText = '（未取得，权限接口报错，请人工确认）';
let permOk = null;
const pr = cli(['drive', 'permission.public', 'get', '--token', docId, '--type', 'docx', '--as', 'user']);
if (pr.json && pr.json.ok) {
  const v = pr.json.data.permission_public.link_share_entity;
  permOk = v === 'tenant_readable';
  permText = v + '（' + (permOk ? '组织内获得链接的人可阅读 ✅' : '⚠️ 不是「组织内可阅读」') + '）';
  if (!permOk) {
    if (confirmPerm) {
      const p = cli(['drive', 'permission.public', 'patch', '--token', docId, '--type', 'docx',
                     '--data', '{"link_share_entity":"tenant_readable"}', '--as', 'user', '--yes']);
      if (p.json && p.json.ok) { permText += ' → 已改为 tenant_readable'; permOk = true; }
      else permText += ' → 改权限失败：' + ((p.json && p.json.error && p.json.error.message) || p.stderr);
    } else {
      permText += '\n     未改（默认不动权限）。要改成组织内可读请：';
      permText += '\n       node scripts/publish.js ' + buildDir + (targetDoc ? ' --doc ' + targetDoc : '') +
                  ' --confirm-permission-change';
    }
  }
}

// ── 3. 回执 ─────────────────────────────────────────────────────────────
const L = [];
L.push('html-to-lark 发布完成（' + action + '）');
L.push('');
L.push('  文档链接   ' + url);
L.push('  文档 ID    ' + docId);
L.push('  分享范围   ' + permText);
L.push('  块数       ' + ((doc.new_blocks && doc.new_blocks.length) || '（更新操作不返回）'));
if (serverWarnings.length) {
  L.push('  服务端提醒 ');
  for (const w of serverWarnings) L.push('             ' + JSON.stringify(w));
}
L.push('');
L.push('💡 阅读更佳：打开文档右上角 ··· →「页宽设置」→ 选「较宽」或「全宽」。');
L.push('   注意：这个设置只对你自己生效，不影响别人看到的效果；转发时建议一并告诉同事。');
L.push('');
// 回执状态要如实反映，不能写死 ✅（否则权限核查失败时是在骗人）
L.push('（回执四项：链接 ✅ / 权限 ' + (permOk === true ? '✅' : permOk === false ? '⚠️ 未达目标档位' : '⚠️ 未取得') +
       ' / 页宽提示 ✅ / 服务端提醒 ' + (serverWarnings.length ? '有，见上' : '无') + '）');

console.log(L.join('\n'));
fs.writeFileSync(
  path.join(absBuild, 'publish-result.json'),
  JSON.stringify({ action, docId, url, permOk, permText, serverWarnings,
                   newBlocks: (doc.new_blocks || []).map((b) => b.block_id) }, null, 2),
  'utf8'
);
