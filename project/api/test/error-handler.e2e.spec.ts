import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Body, Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { HttpModule } from '../src/shared/http/http.module.js';
import { AppError, ErrorKind } from '../src/shared/errors/index.js';

const ProbeSchema = z.object({
  amount: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.string().length(3),
});

class ProbeConflictError extends AppError {
  readonly kind = ErrorKind.Conflict;
  readonly code = 'PROBE_CONFLICT';

  constructor() {
    super('Probe conflict');
  }
}

@Controller('probe')
class ProbeController {
  @Post()
  echo(
    @Body({ schema: ProbeSchema }) body: z.infer<typeof ProbeSchema>,
  ): z.infer<typeof ProbeSchema> {
    return body;
  }

  @Get('conflict')
  conflict(): never {
    throw new ProbeConflictError();
  }

  @Get('crash')
  crash(): never {
    throw new Error('database password=secret leaked?');
  }
}

describe('ErrorHandler (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HttpModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a payload that matches the Zod schema', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe')
      .send({ amount: '25.00', currency: 'BRL' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ amount: '25.00', currency: 'BRL' });
  });

  it('maps Zod issues to 400 REQUEST_VALIDATION_FAILED with details', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe')
      .set('x-request-id', 'req-1')
      .send({ amount: '25', currency: 'BRL' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(response.body.correlationId).toBe('req-1');
    expect(response.body.details[0].path).toBe('amount');
  });

  it('maps an AppError to the status of its kind', async () => {
    const response = await request(app.getHttpServer()).get('/probe/conflict');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PROBE_CONFLICT');
  });

  it('hides the message of unexpected errors behind 500 INTERNAL_ERROR', async () => {
    const response = await request(app.getHttpServer()).get('/probe/crash');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('Internal server error');
  });

  it('formats framework errors such as unknown routes and malformed JSON', async () => {
    const notFound = await request(app.getHttpServer()).get('/does-not-exist');
    const malformed = await request(app.getHttpServer())
      .post('/probe')
      .set('content-type', 'application/json')
      .send('{"amount":');

    expect(notFound.status).toBe(404);
    expect(notFound.body.code).toBe('NOT_FOUND');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('BAD_REQUEST');
  });
});
