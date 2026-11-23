import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountDto } from './account.dto';

describe('AccountDto', () => {
  it.each([{ username: null }, { email: null }, { avatarUrl: null }, { newPassword: 'weak' }, { avatarUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, { email: 'invalid' }, { username: '../escape' }])('rejects invalid account input %j', async input => {
    expect((await validate(plainToInstance(AccountDto, input))).length).toBeGreaterThan(0);
  });
  it('accepts separate profile, password and avatar removal updates', async () => {
    for (const input of [{ username: 'alice-new', email: 'new@example.com', currentPassword: 'Current123' }, { newPassword: 'Changed456', currentPassword: 'Current123' }, { avatarUrl: '' }]) {
      expect(await validate(plainToInstance(AccountDto, input))).toHaveLength(0);
    }
  });
});
