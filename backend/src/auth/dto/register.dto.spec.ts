import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

describe('RegisterDto password policy', () => {
  async function errorsFor(password: string) {
    const errors = await validate(plainToInstance(RegisterDto, {
      username: 'alice',
      email: 'alice@example.test',
      password,
    }));
    return errors.find((error) => error.property === 'password')?.constraints ?? {};
  }

  it('requires both a letter and a digit', async () => {
    await expect(errorsFor('letters-only')).resolves.toHaveProperty('matches');
    await expect(errorsFor('12345678')).resolves.toHaveProperty('matches');
    await expect(errorsFor('letter123')).resolves.not.toHaveProperty('matches');
  });
});
