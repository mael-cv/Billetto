import { z } from 'zod';
import { text } from '../../common/validation/schemas';

export const email = z.email().max(254);

// Mots de passe d'au moins 12 caractères parmi les plus courants : refusés d'office.
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678910111',
  '123456123456',
  '111111111111',
  '000000000000',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwertyuiopas',
  'azertyuiop12',
  'azertyuiop123',
  'azertyuiopqs',
  'password1234',
  'password12345',
  'passwordpassword',
  'motdepasse123',
  'motdepasse1234',
  'motdepassemotdepasse',
  'iloveyou1234',
  'administrator',
  'administrateur',
  'adminadminadmin',
  'billetto1234',
  'billettobilletto',
  'abcdefghijkl',
  'abcdefghijklm',
  'abcdef123456',
  'letmein12345',
  'welcome12345',
  'changeme1234',
]);

/** 12 caractères minimum, ni mot de passe courant, ni un ou deux caractères répétés. */
export const newPassword = z
  .string()
  .min(12, '12 caractères minimum')
  .max(128)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), 'mot de passe trop courant')
  .refine((value) => new Set(value).size >= 5, 'mot de passe trop simple (au moins 5 caractères différents)');

export const loginSchema = z.strictObject({
  email,
  // Borne haute : Argon2 sur un mot de passe de plusieurs Mo = déni de service.
  password: z.string().min(1).max(128),
});

export const registerSchema = z.strictObject({
  email,
  password: newPassword,
  prenom: text(80),
  nom: text(80),
});

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword,
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'le nouveau mot de passe doit différer de l’actuel',
  });

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
