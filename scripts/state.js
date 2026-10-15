'use strict';
/**
 * 按文档记录「我们最后一次看到的块内容指纹」，供漂移守卫比对。
 *
 * 为什么不放在构建目录：publish 和 pull 可能跑在不同的 `--out-dir` 上，
 * 而漂移守卫要求两边共用同一份记忆。放家目录下的小状态文件最省事。
 *
 * 语义：
 *   - publish 成功后 → 记下【我们推上去的】指纹
 *   - pull 成功后    → 记下【文档里当前的】指纹（即「已看过，漂移已消化」）
 *   - 下次 publish 前比对：文档现值 ≠ 记忆值 → 说明有人在流程外改过 → 拒绝覆盖
 * 这样「pull → 改 → 上传」不会被自己的守卫挡住，而「别人改过 → 直接覆盖」会被挡住。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(os.homedir(), '.html-to-lark');
const FILE = path.join(DIR, 'state.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(obj) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function get(docId) {
  return load()[docId] || null;
}

function remember(docId, hash, note) {
  const all = load();
  all[docId] = { hash, at: new Date().toISOString(), note: note || '' };
  save(all);
}

const hash = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

module.exports = { get, remember, hash, FILE };
