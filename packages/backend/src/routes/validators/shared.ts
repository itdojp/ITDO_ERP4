import { Type } from '@sinclair/typebox';

export const flowTypeSchema = Type.Union([
  Type.Literal('estimate'),
  Type.Literal('invoice'),
  Type.Literal('expense'),
  Type.Literal('leave'),
  Type.Literal('time'),
  Type.Literal('purchase_order'),
  Type.Literal('vendor_invoice'),
  Type.Literal('vendor_quote'),
]);

export const booleanQuerySchema = Type.Union([
  Type.Boolean(),
  Type.Literal('true'),
  Type.Literal('false'),
  Type.Literal('1'),
  Type.Literal('0'),
]);
