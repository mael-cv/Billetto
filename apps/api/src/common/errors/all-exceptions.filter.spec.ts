import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ApiError } from './http-errors';
import { AllExceptionsFilter } from './all-exceptions.filter';

function host() {
  const reply = { status: jest.fn(), send: jest.fn() };
  reply.status.mockReturnValue(reply);
  const request = { id: 'req-1', method: 'GET', routeOptions: { url: '/x' } };
  const h = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }) } as unknown as ArgumentsHost;
  return { h, reply };
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('ne divulgue ni message ni stacktrace pour une erreur inattendue', () => {
    const { h, reply } = host();
    const err = new Error('connection string postgres://user:secret@db/billetto');
    new AllExceptionsFilter().catch(err, h);
    expect(reply.status).toHaveBeenCalledWith(500);
    const body = reply.send.mock.calls[0][0];
    expect(body).toEqual({ statusCode: 500, error: 'ERREUR_INTERNE', message: 'Erreur interne', requestId: 'req-1' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('conserve le format des erreurs applicatives', () => {
    const { h, reply } = host();
    new AllExceptionsFilter().catch(new ApiError(409, 'CONFLIT', 'déjà pris', [{ champ: 'slug' }]), h);
    expect(reply.send.mock.calls[0][0]).toEqual({
      statusCode: 409,
      error: 'CONFLIT',
      message: 'déjà pris',
      details: [{ champ: 'slug' }],
      requestId: 'req-1',
    });
  });

  it('erreur Fastify 4xx : statut conservé, message générique', () => {
    const { h, reply } = host();
    new AllExceptionsFilter().catch(Object.assign(new Error('Body is too large: 99999 bytes'), { statusCode: 413 }), h);
    expect(reply.send.mock.calls[0][0]).toMatchObject({ statusCode: 413, message: 'Requête invalide' });
  });
});
