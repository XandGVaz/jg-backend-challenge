import { z } from 'zod';

const AMOUNT = /^(0|[1-9]\d*)\.\d{2}$/;
const SIGNED_AMOUNT = /^-?(0|[1-9]\d*)\.\d{2}$/;

export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .meta({ example: 'BRL' });

export const MoneySchema = z
  .object({
    amount: z
      .string()
      .regex(AMOUNT, 'Expected a non-negative decimal with 2 places')
      .meta({ example: '25.00' }),
    currency: CurrencySchema,
  })
  .strict()
  .meta({ id: 'Money' });

export const SignedMoneySchema = MoneySchema.extend({
  amount: z.string().regex(SIGNED_AMOUNT).meta({ example: '-5.00' }),
}).meta({ id: 'SignedMoney' });
