'use strict';
/**
 * 共享的 lark-cli 调用层。publish.js 与 pull.js 共用。
 *
 * 为什么调 run.js 而不是 `lark-cli` 本身：
 *   Windows 上 spawnSync 直接跑 `lark-cli.cmd` 会 EINVAL（Node ≥20 的安全限制），
 *   走 shell 又会踩参数截断 / 全角字符 / `&` 被当后台符 这些坑。
 *   用 node 直调 run.js，参数列表不经 shell，两边都清净。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REL = path.join('node_modules', '@larksuite', 'cli', 'scripts', 'run.js');

// PATH 里的 lark-cli shim 与 node_modules 同级 → 反推真实入口
function fromPathShim() {
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

// 兜底：问 npm 全局根在哪（慢，只在前面都失败时走）
function fromNpmRoot() {
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

// 注意：不能假设 run.js 在 node 旁边 —— nvm 下 node 在 C:\nvm4w，
// 而 CLI 可能装在 D:\Software\nodejs\node_global（实测踩过）。
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

function requireRunJs() {
  const r = resolveRunJs();
  if (!r) {
    console.error(
      '✖ 找不到 lark-cli 的入口 run.js。\n' +
      '  请设置环境变量 LARK_RUNJS 指向它，例如：\n' +
      '    LARK_RUNJS=<...>/node_modules/@larksuite/cli/scripts/run.js'
    );
    process.exit(1);
  }
  return r;
}

/** 跑一次 lark-cli，返回 { status, json, stdout, stderr } */
function runCli(args, { cwd } = {}) {
  const r = spawnSync(process.execPath, [requireRunJs(), ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024, // fetch 大文档时输出可能很大
  });
  if (r.error) {
    console.error('✖ 调用 lark-cli 失败：' + r.error.message);
    process.exit(1);
  }
  const stdout = (r.stdout || '').trim();
  let json = null;
  try { json = JSON.parse(stdout); } catch { /* 非 JSON 输出 */ }
  return { status: r.status, stdout, stderr: (r.stderr || '').trim(), json };
}

/** 把 CLI 的失败讲清楚（认证/scope 类错误要带上 hint） */
function explain(res, what) {
  const j = res.json;
  const hint = j && j.error && j.error.hint ? '\n  ' + j.error.hint : '';
  const msg = (j && j.error && j.error.message) || res.stderr || res.stdout || '(无输出)';
  return what + ' 失败：' + msg + hint;
}

module.exports = { runCli, explain, resolveRunJs };
