import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../public.decorator.js';

/** Guard global sem validação enquanto a autenticação externa não estiver habilitada. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Mantém rotas públicas fora da futura autenticação e libera as demais temporariamente.
   * Nas rotas não públicas, este método deverá validar o bearer token emitido pelo IdP no fluxo
   * OAuth2 client credentials, incluindo assinatura, issuer, audience, expiração e escopos da rota.
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return true;
  }
}
