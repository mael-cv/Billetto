import { z } from 'zod';
import { text } from '../../common/validation/schemas';

const email = z.email().max(254);

export const loginSchema = z.strictObject({
  email,
  // Borne haute : Argon2 sur un mot de passe de plusieurs Mo = déni de service.
  password: z.string().min(1).max(128),
});

export const registerSchema = z.strictObject({
  email,
  password: z.string().min(12, '12 caractères minimum').max(128),
  prenom: text(80),
  nom: text(80),
});

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
