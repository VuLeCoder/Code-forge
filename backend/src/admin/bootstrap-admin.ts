import { loadEnvFile } from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient, SystemRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { normalizeEmail, normalizeUsername } from '../auth/normalization';

const reservedUsernames = new Set([
  'api', 'login', 'register', 'new', 'invitations', 'settings', 'admin', 'git',
  'explore', 'tokens', 'favicon.ico', 'robots.txt', 'sitemap.xml',
]);

function loadLocalEnvironment() {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function validateIdentity(username: string, email: string) {
  if (username.length < 3 || username.length > 39 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(username)) {
    throw new Error('Username phải dài 3–39 ký tự và chỉ chứa chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  }
  if (reservedUsernames.has(normalizeUsername(username))) throw new Error('Username này được dành riêng cho hệ thống.');
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email không hợp lệ.');
}

function promptLine(label: string, lineReader: Interface | null, secret = false): Promise<string> {
  if (lineReader) return lineReader.question(label);
  stdout.write(label);
  const previousRaw = stdin.isRaw;
  const decoder = new StringDecoder('utf8');
  return new Promise((resolve, reject) => {
    const finish = (value?: string, error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(Boolean(previousRaw));
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value ?? '');
    };
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\r' || character === '\n') return finish(value);
        if (character === '\u0003') return finish(undefined, new Error('Đã hủy thao tác.'));
        if (character === '\u007f' || character === '\b') {
          const chars = Array.from(value);
          if (chars.length) {
            chars.pop();
            value = chars.join('');
            if (!secret) stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ' && character !== '\u007f') {
          value += character;
          if (!secret) stdout.write(character);
        }
      }
    };
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

export async function bootstrapAdmin() {
  loadLocalEnvironment();
  const db = new PrismaClient();
  const lineReader = stdin.isTTY && stdout.isTTY && typeof stdin.setRawMode === 'function'
    ? null
    : createInterface({ input: stdin, output: stdout, terminal: false });
  try {
    const username = (await promptLine('Username: ', lineReader)).trim();
    const email = (await promptLine('Email: ', lineReader)).trim();
    validateIdentity(username, email);
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    const matches = await db.user.findMany({
      where: { OR: [{ normalizedUsername }, { normalizedEmail }] },
      take: 2,
    });
    if (matches.length > 1) throw new Error('Username và email thuộc các tài khoản khác nhau.');
    const existing = matches[0];
    if (existing) {
      if (existing.normalizedUsername !== normalizedUsername || existing.normalizedEmail !== normalizedEmail) {
        throw new Error('Username và email không khớp với cùng một tài khoản.');
      }
      if (existing.systemRole === SystemRole.ADMIN) {
        stdout.write(`Tài khoản ${existing.username} đã có quyền ADMIN.\n`);
        return;
      }
      await db.user.update({ where: { id: existing.id }, data: { systemRole: SystemRole.ADMIN } });
      stdout.write(`Đã cấp quyền ADMIN cho ${existing.username}; trạng thái và mật khẩu hiện tại được giữ nguyên.\n`);
      return;
    }

    const password = await promptLine('Mật khẩu mới: ', lineReader, true);
    const confirmation = await promptLine('Nhập lại mật khẩu: ', lineReader, true);
    if (password.length < 8 || password.length > 128) throw new Error('Mật khẩu phải dài 8–128 ký tự.');
    if (password !== confirmation) throw new Error('Mật khẩu xác nhận không khớp.');
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const user = await db.user.create({ data: {
      username,
      normalizedUsername,
      email,
      normalizedEmail,
      passwordHash,
      systemRole: SystemRole.ADMIN,
      status: UserStatus.ACTIVE,
      lockedAt: null,
    }, select: { id: true, username: true } });
    stdout.write(`Đã tạo tài khoản ADMIN ${user.username}.\n`);
  } finally {
    lineReader?.close();
    await db.$disconnect();
  }
}

if (require.main === module) {
  void bootstrapAdmin().catch((error: unknown) => {
    console.error(`Không thể tạo hoặc nâng quyền ADMIN: ${error instanceof Error ? error.message : 'Lỗi không xác định.'}`);
    process.exitCode = 1;
  });
}
