import { describe, expect, it } from 'bun:test';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../public.decorator.js';
import { AuthGuard } from './auth.guard.js';

class TestController {
  @Public()
  publicRoute(this: void): string {
    return 'public';
  }

  nonPublicRoute(this: void): string {
    return 'non-public';
  }
}

function contextFor(handler: () => string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const guard = new AuthGuard(new Reflector());

  it('allows a public route', () => {
    const context = contextFor(TestController.prototype.publicRoute);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a non-public route while authentication is disabled', () => {
    const context = contextFor(TestController.prototype.nonPublicRoute);

    expect(guard.canActivate(context)).toBe(true);
  });
});
