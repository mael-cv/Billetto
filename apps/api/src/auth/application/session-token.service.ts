import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import type { Actor } from '../domain/actor';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const claimsSchema = z.object({
  sub: z.number().int().positive(),
  role: z.enum(['visitor', 'organizer', 'admin']),
  org: z.number().int().positive().nullable(),
  email: z.string(),
  prenom: z.string(),
  nom: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});

/**
 * Jeton de session JWT HS256 signé avec node:crypto.
 * - l'en-tête est FIXE et comparé tel quel : pas d'attaque « alg: none » ni de
 *   confusion d'algorithme ;
 * - signature comparée en temps constant ;
 * - expiration obligatoire.
 * Le jeton voyage uniquement dans un cookie HttpOnly.
 */
@Injectable()
export class SessionTokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  sign(actor: Actor, now = Date.now()): string {
    const iat = Math.floor(now / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: actor.userId,
        role: actor.role,
        org: actor.organisateurId,
        email: actor.email,
        prenom: actor.prenom,
        nom: actor.nom,
        iat,
        exp: iat + this.config.SESSION_TTL_SECONDS,
      }),
    ).toString('base64url');
    return `${HEADER}.${payload}.${this.signature(`${HEADER}.${payload}`)}`;
  }

  verify(token: string | undefined, now = Date.now()): Actor | null {
    if (!token || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];
    if (header !== HEADER) return null;

    const expected = Buffer.from(this.signature(`${header}.${payload}`));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    } catch {
      return null;
    }
    const claims = claimsSchema.safeParse(decoded);
    if (!claims.success || claims.data.exp <= Math.floor(now / 1000)) return null;

    return {
      userId: claims.data.sub,
      role: claims.data.role,
      organisateurId: claims.data.org,
      email: claims.data.email,
      prenom: claims.data.prenom,
      nom: claims.data.nom,
    };
  }

  private signature(data: string): string {
    return createHmac('sha256', this.config.JWT_SECRET).update(data).digest('base64url');
  }
}
