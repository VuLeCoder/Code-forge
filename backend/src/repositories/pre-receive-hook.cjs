#!/usr/bin/env node
'use strict';

const { readdirSync, statSync } = require('node:fs');
const { delimiter, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const defaultBranch = process.env.CODE_FORGE_DEFAULT_BRANCH;
const maxFileBytes = Number(process.env.CODE_FORGE_MAX_FILE_BYTES);
const maxRepositoryBytes = Number(process.env.CODE_FORGE_MAX_REPOSITORY_BYTES);
const zero = (value) => /^0{40}$|^0{64}$/.test(value);
const objectId = (value) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

function reject(message) {
  process.stderr.write(`Code Forge: ${message}\n`);
  process.exit(1);
}

function git(args, input) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function directoryBytes(root, seen = new Set()) {
  if (!root || seen.has(root)) return 0;
  seen.add(root);
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += directoryBytes(path, seen);
    else if (entry.isFile()) total += statSync(path).size;
    if (total > maxRepositoryBytes) return total;
  }
  return total;
}

if (!defaultBranch || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 ||
  !Number.isSafeInteger(maxRepositoryBytes) || maxRepositoryBytes < maxFileBytes) {
  reject('cấu hình quota không hợp lệ.');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input) > 1024 * 1024) reject('quá nhiều cập nhật ref trong một push.');
});
process.stdin.on('end', () => {
  const lines = input.trim().split('\n').filter(Boolean);
  if (!lines.length || lines.length > 1000) reject('danh sách cập nhật ref không hợp lệ.');
  const proposed = [];
  for (const line of lines) {
    const fields = line.split(' ');
    if (fields.length !== 3) reject('dữ liệu cập nhật ref không hợp lệ.');
    const [oldSha, newSha, ref] = fields;
    if (!objectId(oldSha) || !objectId(newSha) || oldSha.length !== newSha.length ||
      !ref.startsWith('refs/heads/')) reject('chỉ được cập nhật branch trong refs/heads.');
    const branch = ref.slice('refs/heads/'.length);
    if (git(['check-ref-format', '--branch', branch]) === null) reject('tên branch không hợp lệ.');
    if (zero(newSha)) {
      if (ref === `refs/heads/${defaultBranch}`) reject('không được xóa branch mặc định.');
      continue;
    }
    if (git(['cat-file', '-e', `${newSha}^{commit}`]) === null) reject('đầu branch phải là commit hợp lệ.');
    if (!zero(oldSha) && git(['merge-base', '--is-ancestor', oldSha, newSha]) === null) {
      reject('chỉ chấp nhận cập nhật fast-forward.');
    }
    proposed.push(newSha);
  }

  const listed = git(['rev-list', '--objects', '--all', ...proposed]);
  if (listed === null) reject('không thể kiểm tra object của repository.');
  const ids = [...new Set(listed.split('\n').filter(Boolean).map((line) => line.split(' ')[0]))];
  if (ids.some((id) => !objectId(id))) reject('danh sách object không hợp lệ.');
  const details = ids.length ? git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${ids.join('\n')}\n`) : '';
  if (details === null) reject('không thể đo quota repository.');
  let logicalBytes = 0;
  for (const line of details.split('\n').filter(Boolean)) {
    const [id, type, rawSize] = line.split(' ');
    const size = Number(rawSize);
    if (!objectId(id) || !['blob', 'tree', 'commit', 'tag'].includes(type) || !Number.isSafeInteger(size) || size < 0) {
      reject('metadata object không hợp lệ.');
    }
    if (type === 'blob' && size > maxFileBytes) reject(`file vượt giới hạn ${maxFileBytes} byte.`);
    logicalBytes += size;
    if (logicalBytes > maxRepositoryBytes) reject(`repository vượt giới hạn ${maxRepositoryBytes} byte.`);
  }

  try {
    const roots = [process.env.GIT_OBJECT_DIRECTORY,
      ...(process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES || '').split(delimiter)].filter(Boolean);
    const physicalBytes = roots.reduce((sum, root) => sum + directoryBytes(root), 0);
    if (physicalBytes > maxRepositoryBytes) reject(`repository vượt giới hạn ${maxRepositoryBytes} byte.`);
  } catch {
    reject('không thể đo storage repository.');
  }
});
