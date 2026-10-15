#!/usr/bin/env node
'use strict';
/**
 * html-to-lark · 发布阶段
 *
 * prepare.js 之后的固定流程全部固化在这里（省 token、降方差、弱模型也不易走偏）：
 *   1. 漂移守卫  更新前先核对文档里的块是否被本流程之外改过 —— 改过就拒绝覆盖
 *   2. 发布      新建 / --doc 原地更新
 *   3. 权限核查  只读；非目标档位才提示改，且需 --confirm-permission-change
 *   4. 回执      链接 + 分享范围 + 页宽提示 + 服务端 warnings
 *
 * 用法：
 *   node publish.js <构建目录>
 *   node publish.js <构建目录> --doc <飞书文档URL> [--force]
 *   node publish.js <构建目录> --doc <URL> --confirm-permission-change
 */

const fs = require('fs');
const path = require('path');
const { runCli, explain } = require('./cli');
const state = require('./state');

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const buildDir = argv.find((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const targetDoc = opt('doc', '');
const confirmPerm = argv.includes('--confirm-permission-change');
const force = argv.includes('--force');

function die(msg) { console.error('✖ ' + msg); process.exit(1); }

if (!buildDir) die('用法: node publish.js <构建目录> [--doc <飞书文档URL>] [--force] [--confirm-permission-change]');
const absBuild = path.resolve(buildDir);
if (!fs.existsSync(path.join(absBuild, 'doc.xml'))) {
  die('构建目录里没有 doc.xml：' + absBuild + '\n  先跑 prepare.js 生成。');
}

const sha = state.hash;

// 本次要上传的块内容：按 block-N.html / block.html 顺序拼接
const blockFiles = fs.readdirSync(absBuild).filter((f) => /^block(-\d+)?\.html$/.test(f))
  .sort((a, b) => (a === 'block.html' ? -1 : b === 'block.html' ? 1 : parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/))));
if (blockFiles.length === 0) die('构建目录里没有 block*.html，先跑 prepare.js。');
const localPayload = blockFiles.map((f) => fs.readFileSync(path.join(absBuild, f), 'utf8')).join('\n');
const localHash = sha(localPayload);

const L = [];
let permOk = null;
let permText = '（未取得）';

// ── 1+2. 漂移守卫 → 发布 ────────────────────────────────────────────────
let res, action, docId, url, serverWarnings = [];

if (targetDoc) {
  action = '原地更新';
  const fetched = runCli(['docs', '+fetch', '--doc', targetDoc, '--detail', 'full', '--as', 'user'], { cwd: absBuild });
  if (!fetched.json || !fetched.json.ok) die(explain(fetched, '读取目标文档'));

  const doc = fetched.json.data.document;
  docId = doc.document_id || targetDoc.split('/').filter(Boolean).pop();
  const content = doc.content || '';
  const refs = [...content.matchAll(/<html5-block\b[^>]*\bdata-ref="([^"]+)"/g)].map((m) => m[1]);
  if (refs.length === 0) die('目标文档里没有 html5-block，无法原地更新。去掉 --doc 走新建。');
  if (refs.length > 1) {
    die('目标文档里有 ' + refs.length + ' 个 html5-block，无法判断替换哪一个（不猜）。\n' +
        '  请先人工确认，或去掉 --doc 走新建。');
  }

  // 漂移守卫：把文档里的当前内容和「上次由本工具推上去的」比对
  const rm = (doc.reference_map && doc.reference_map['html5-block']) || {};
  const entry = rm[refs[0]] || Object.values(rm)[0] || {};
  let current = '';
  if (typeof entry.data === 'string') current = entry.data;
  else if (entry.path) {
    const p = path.resolve(absBuild, entry.path.replace(/^@/, ''));
    if (fs.existsSync(p)) current = fs.readFileSync(p, 'utf8');
  }
  const currentHash = current ? sha(current) : '';
  const remembered = (state.get(docId) || {}).hash || '';

  if (!remembered) {
    L.push('提示：这台机器上没有该文档的历史记录，**无法核对**它是否被别人改过。');
    L.push('      若不确定，先 `node scripts/pull.js ' + targetDoc + '` 看一眼再决定。');
    L.push('');
  } else if (currentHash && currentHash !== remembered) {
    if (!force) {
      die(
        '文档里的块**已经在本次流程之外被改过**，直接覆盖会丢掉那些改动。\n' +
        '  期望（上次推上去的）sha256 ' + remembered + '\n' +
        '  实际（文档里现在的）  sha256 ' + currentHash + '\n' +
        '  正确做法：先 pull 再改再上传 ——\n' +
        '    node scripts/pull.js ' + JSON.stringify(targetDoc) + '\n' +
        '  确认那些改动不要了、就是要覆盖 → 加 --force。'
      );
    }
    L.push('⚠ 已用 --force 跳过漂移守卫：文档里的改动将被覆盖。');
    L.push('');
  }

  const xml = fs.readFileSync(path.join(absBuild, 'doc.xml'), 'utf8');
  const body = xml.replace(/<title>[\s\S]*?<\/title>/, ''); // 只替换块，不动标题与其余正文
  res = runCli(['docs', '+update', '--doc', targetDoc, '--command', 'block_replace',
                '--block-id', (content.match(/<html5-block\b[^>]*\bid="([^"]+)"/) || [])[1] || '',
                '--content', body, '--as', 'user'], { cwd: absBuild });
} else {
  action = '新建';
  res = runCli(['docs', '+create', '--doc-format', 'xml', '--content', '@./doc.xml',
                '--parent-position', 'my_library', '--as', 'user'], { cwd: absBuild });
}
if (!res.json || !res.json.ok) die(explain(res, action + '文档'));

const outDoc = res.json.data.document;
// 更新操作【不返回】document_id（只有 new_blocks / revision_id / url）—— 不能直接取（踩过）
docId = outDoc.document_id || docId || (outDoc.url || '').split('/').filter(Boolean).pop()
  || targetDoc.split('/').filter(Boolean).pop() || '';
if (!docId) die('拿不到文档 ID，后续权限核查无法进行。响应：' + JSON.stringify(res.json).slice(0, 300));
url = outDoc.url || ('https://<host>.feishu.cn/docx/' + docId);
serverWarnings = res.json.data.warnings || [];

// 记下这次的指纹，供下次更新做漂移比对
state.remember(docId, localHash, action + ' / ' + blockFiles.length + ' 块');

// ── 3. 权限核查（只读；非目标档位才提示改）──────────────────────────────
const pr = runCli(['drive', 'permission.public', 'get', '--token', docId, '--type', 'docx', '--as', 'user'],
                  { cwd: absBuild });
if (pr.json && pr.json.ok) {
  const v = pr.json.data.permission_public.link_share_entity;
  permOk = v === 'tenant_readable';
  permText = v + '（' + (permOk ? '组织内获得链接的人可阅读 ✅' : '⚠️ 不是「组织内可阅读」') + '）';
  if (!permOk) {
    if (confirmPerm) {
      const p = runCli(['drive', 'permission.public', 'patch', '--token', docId, '--type', 'docx',
                        '--data', '{"link_share_entity":"tenant_readable"}', '--as', 'user', '--yes'],
                       { cwd: absBuild });
      if (p.json && p.json.ok) { permText += ' → 已改为 tenant_readable'; permOk = true; }
      else permText += ' → 改权限失败：' + ((p.json && p.json.error && p.json.error.message) || p.stderr);
    } else {
      permText += '\n     未改（默认不动权限）。要改成组织内可读，加 --confirm-permission-change 重跑。';
    }
  }
} else {
  permText = '（未取得，权限接口报错，请人工确认）';
}

// ── 4. 回执 ─────────────────────────────────────────────────────────────
L.push('html-to-lark 发布完成（' + action + '）');
L.push('');
L.push('  文档链接   ' + url);
L.push('  文档 ID    ' + docId);
L.push('  分享范围   ' + permText);
L.push('  块数       ' + blockFiles.length);
L.push('  内容指纹   ' + localHash + '（已记录，供下次更新做漂移比对）');
if (serverWarnings.length) {
  L.push('  服务端提醒：');
  for (const w of serverWarnings) L.push('             ' + JSON.stringify(w));
}
L.push('');
L.push('💡 阅读更佳：打开文档右上角 ··· →「页宽设置」→ 选「较宽」或「全宽」。');
L.push('   注意：这个设置只对你自己生效，不影响别人看到的效果；转发时建议一并告诉同事。');
L.push('');
L.push('（回执四项：链接 ✅ / 权限 ' + (permOk === true ? '✅' : permOk === false ? '⚠️ 未达目标档位' : '⚠️ 未取得') +
       ' / 页宽提示 ✅ / 服务端提醒 ' + (serverWarnings.length ? '有，见上' : '无') + '）');

console.log(L.join('\n'));
fs.writeFileSync(
  path.join(absBuild, 'publish-result.json'),
  JSON.stringify({ action, docId, url, permOk, permText, serverWarnings, hash: localHash,
                   newBlocks: (outDoc.new_blocks || []).map((b) => b.block_id) }, null, 2),
  'utf8'
);
