import { useCallback, useMemo } from 'react';
import type {
  ProjectOption,
  PurchaseOrder,
  PurchaseOrderDetail,
  VendorInvoice,
  VendorInvoiceForm,
  VendorOption,
} from './vendorDocumentsShared';

type InvoicePoLinkDialogState = {
  invoice: VendorInvoice;
  purchaseOrderId: string;
} | null;

type UseVendorDocumentsLookupsParams = {
  projects: ProjectOption[];
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrder[];
  vendorInvoices: VendorInvoice[];
  invoiceForm: Pick<VendorInvoiceForm, 'projectId' | 'vendorId'>;
  invoicePoLinkDialog: InvoicePoLinkDialogState;
  purchaseOrderDetails: Record<string, PurchaseOrderDetail>;
};

export function useVendorDocumentsLookups(
  params: UseVendorDocumentsLookupsParams,
) {
  const projectMap = useMemo(() => {
    return new Map(params.projects.map((project) => [project.id, project]));
  }, [params.projects]);

  const vendorMap = useMemo(() => {
    return new Map(params.vendors.map((vendor) => [vendor.id, vendor]));
  }, [params.vendors]);

  const availablePurchaseOrders = useMemo(() => {
    return params.purchaseOrders.filter(
      (po) =>
        po.projectId === params.invoiceForm.projectId &&
        po.vendorId === params.invoiceForm.vendorId,
    );
  }, [
    params.purchaseOrders,
    params.invoiceForm.projectId,
    params.invoiceForm.vendorId,
  ]);

  const availablePurchaseOrdersForInvoicePoLink = useMemo(() => {
    if (!params.invoicePoLinkDialog) return [];
    const invoice = params.invoicePoLinkDialog.invoice;
    return params.purchaseOrders.filter(
      (po) =>
        po.projectId === invoice.projectId && po.vendorId === invoice.vendorId,
    );
  }, [params.invoicePoLinkDialog, params.purchaseOrders]);

  const selectedPurchaseOrderId = params.invoicePoLinkDialog?.purchaseOrderId
    .trim();
  const selectedPurchaseOrder = selectedPurchaseOrderId
    ? params.purchaseOrderDetails[selectedPurchaseOrderId] || null
    : null;

  const vendorInvoicesByPurchaseOrderId = useMemo(() => {
    const map = new Map<string, VendorInvoice[]>();
    params.vendorInvoices.forEach((invoice) => {
      const poId = invoice.purchaseOrderId;
      if (!poId) return;
      const list = map.get(poId) || [];
      list.push(invoice);
      map.set(poId, list);
    });
    return map;
  }, [params.vendorInvoices]);

  const renderProject = useCallback(
    (projectId: string) => {
      const project = projectMap.get(projectId);
      return project ? `${project.code} / ${project.name}` : projectId;
    },
    [projectMap],
  );

  const renderVendor = useCallback(
    (vendorId: string) => {
      const vendor = vendorMap.get(vendorId);
      return vendor ? `${vendor.code} / ${vendor.name}` : vendorId;
    },
    [vendorMap],
  );

  return {
    availablePurchaseOrders,
    availablePurchaseOrdersForInvoicePoLink,
    selectedPurchaseOrderId,
    selectedPurchaseOrder,
    vendorInvoicesByPurchaseOrderId,
    renderProject,
    renderVendor,
  };
}
