import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca uma rota ou controller como público para que o AuthGuard não exija autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
