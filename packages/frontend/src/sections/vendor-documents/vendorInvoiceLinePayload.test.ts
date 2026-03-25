import { describe, expect, it } from 'vitest';

import { buildVendorInvoiceLinePayload } from './vendorInvoiceLinePayload';
import type { VendorInvoiceLine } from './vendorDocumentsShared';

const invalidPayloadCases: Array<[string, VendorInvoiceLine[], string]> = [
  [
    '行番号が不正',
    [{ lineNo: '0', description: 'x', quantity: 1, unitPrice: 1 }],
    '請求明細 1 の行番号が不正です',
  ],
  [
    '行番号が重複',
    [
      { lineNo: 1, description: 'x', quantity: 1, unitPrice: 1 },
      { lineNo: 1, description: 'y', quantity: 1, unitPrice: 1 },
    ],
    '請求明細 2 の行番号が重複しています',
  ],
  [
    '内容が空',
    [{ lineNo: 1, description: '   ', quantity: 1, unitPrice: 1 }],
    '請求明細 1 の内容を入力してください',
  ],
  [
    '数量が不正',
    [{ lineNo: 1, description: 'x', quantity: '0', unitPrice: 1 }],
    '請求明細 1 の数量が不正です',
  ],
  [
    '単価が不正',
    [{ lineNo: 1, description: 'x', quantity: 1, unitPrice: '-1' }],
    '請求明細 1 の単価が不正です',
  ],
  [
    '金額が不正',
    [
      {
        lineNo: 1,
        description: 'x',
        quantity: 1,
        unitPrice: 1,
        amount: '-10',
      },
    ],
    '請求明細 1 の金額が不正です',
  ],
  [
    '税率が不正',
    [
      {
        lineNo: 1,
        description: 'x',
        quantity: 1,
        unitPrice: 1,
        taxRate: '-1',
      },
    ],
    '請求明細 1 の税率が不正です',
  ],
  [
    '税額が不正',
    [
      {
        lineNo: 1,
        description: 'x',
        quantity: 1,
        unitPrice: 1,
        taxAmount: '-1',
      },
    ],
    '請求明細 1 の税額が不正です',
  ],
];

describe('buildVendorInvoiceLinePayload', () => {
  it('builds a payload with normalized optional fields', () => {
    const result = buildVendorInvoiceLinePayload(
      [
        {
          lineNo: '2',
          description: '  設計作業  ',
          quantity: '3',
          unitPrice: '1200',
          amount: '3600',
          taxRate: '10',
          taxAmount: '360',
          purchaseOrderLineId: '  po-line-1  ',
        },
      ],
      '差戻し再送',
    );

    expect(result).toEqual({
      ok: true,
      payload: {
        lines: [
          {
            lineNo: 2,
            description: '設計作業',
            quantity: 3,
            unitPrice: 1200,
            amount: 3600,
            taxRate: 10,
            taxAmount: 360,
            purchaseOrderLineId: 'po-line-1',
          },
        ],
        reasonText: '差戻し再送',
      },
    });
  });

  it('defaults line numbers and clears blank optional values', () => {
    const result = buildVendorInvoiceLinePayload(
      [
        {
          description: '内訳A',
          quantity: '2',
          unitPrice: '500',
          amount: '',
          taxRate: '',
          taxAmount: '',
          purchaseOrderLineId: '   ',
        },
      ],
      '',
    );

    expect(result).toEqual({
      ok: true,
      payload: {
        lines: [
          {
            lineNo: 1,
            description: '内訳A',
            quantity: 2,
            unitPrice: 500,
            amount: null,
            taxRate: null,
            taxAmount: null,
            purchaseOrderLineId: null,
          },
        ],
      },
    });
  });

  it.each(invalidPayloadCases)('%s', (_label, lines, errorText) => {
    const result = buildVendorInvoiceLinePayload(lines, '');

    expect(result).toEqual({
      ok: false,
      errorText,
    });
  });
});
