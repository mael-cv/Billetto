export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** false pour un mot de passe faux OU un hash invalide (jamais d'exception). */
  verify(hash: string, password: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
