import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../domain/password-hasher';

// Argon2id, paramètres minimaux recommandés par OWASP : m = 19 MiB, t = 2, p = 1.
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch {
      // Hash mal formé (ex. comptes du seed « !seed-no-login ») : refus.
      return false;
    }
  }
}
