import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSslOptions } from './mikro-orm.config.js';

describe('createSslOptions', () => {
  it('disables TLS by default', () => {
    expect(createSslOptions({ DATABASE_SSL_MODE: 'disable' })).toBeUndefined();
  });

  it('encrypts without verifying the certificate in require mode', () => {
    expect(createSslOptions({ DATABASE_SSL_MODE: 'require' })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('verifies against the public roots when no CA file is given', () => {
    expect(createSslOptions({ DATABASE_SSL_MODE: 'verify-full' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('verifies against the CA bundle file when one is given', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ca-')), 'bundle.pem');
    writeFileSync(file, 'PEM');
    expect(
      createSslOptions({ DATABASE_SSL_MODE: 'verify-full', DATABASE_SSL_CA_FILE: file }),
    ).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
  });
});
