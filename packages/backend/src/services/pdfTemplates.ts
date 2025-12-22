export type PdfTemplate = {
  id: string;
  name: string;
  kind: 'invoice' | 'purchase_order';
  version: string;
  description?: string;
  isDefault?: boolean;
};

const templates: PdfTemplate[] = [
  {
    id: 'invoice-default',
    name: 'Invoice Default',
    kind: 'invoice',
    version: 'v1',
    description: 'Default invoice template',
    isDefault: true,
  },
  {
    id: 'purchase-order-default',
    name: 'Purchase Order Default',
    kind: 'purchase_order',
    version: 'v1',
    description: 'Default purchase order template',
    isDefault: true,
  },
];

export function listPdfTemplates(kind?: string): PdfTemplate[] {
  if (!kind) return [...templates];
  return templates.filter((t) => t.kind === kind);
}

export function getPdfTemplate(id: string): PdfTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export function getDefaultTemplate(kind: string): PdfTemplate | undefined {
  return templates.find((t) => t.kind === kind && t.isDefault);
}
