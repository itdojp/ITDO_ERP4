import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import type { PdfTemplate, TemplateSetting } from './adminSettingsModel';
import {
  parseAdminSettingsJson,
  type AdminSettingsErrorLogger,
  type AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type TemplateForm = {
  kind: string;
  templateId: string;
  numberRule: string;
  layoutConfigJson: string;
  logoUrl: string;
  signatureText: string;
  isDefault: boolean;
};

type UseAdminSettingsTemplatesOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

function createDefaultTemplateForm(): TemplateForm {
  return {
    kind: 'invoice',
    templateId: '',
    numberRule: 'PYYYY-MM-NNNN',
    layoutConfigJson: '',
    logoUrl: '',
    signatureText: '',
    isDefault: true,
  };
}

export function useAdminSettingsTemplates({
  setMessage,
  logError,
}: UseAdminSettingsTemplatesOptions) {
  const [items, setItems] = useState<TemplateSetting[]>([]);
  const [pdfTemplates, setPdfTemplates] = useState<PdfTemplate[]>([]);
  const [form, setForm] = useState<TemplateForm>(createDefaultTemplateForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const templatesForKind = useMemo(
    () => pdfTemplates.filter((template) => template.kind === form.kind),
    [pdfTemplates, form.kind],
  );
  const templateNameMap = useMemo(
    () => new Map(pdfTemplates.map((template) => [template.id, template.name])),
    [pdfTemplates],
  );

  useEffect(() => {
    if (templatesForKind.length === 0) return;
    setForm((prev) => {
      if (editingId != null) {
        return prev;
      }
      if (
        prev.templateId &&
        templatesForKind.some((t) => t.id === prev.templateId)
      ) {
        return prev;
      }
      return { ...prev, templateId: templatesForKind[0].id };
    });
  }, [templatesForKind, editingId]);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: TemplateSetting[] }>('/template-settings');
      setItems(res.items || []);
    } catch (err) {
      logError('loadTemplateSettings failed', err);
      setItems([]);
    }
  }, [logError]);

  const loadPdfTemplates = useCallback(async () => {
    try {
      const res = await api<{ items: PdfTemplate[] }>('/pdf-templates');
      setPdfTemplates(res.items || []);
    } catch (err) {
      logError('loadPdfTemplates failed', err);
      setPdfTemplates([]);
    }
  }, [logError]);

  const resetForm = useCallback(() => {
    setForm(createDefaultTemplateForm());
    setEditingId(null);
  }, []);

  const submit = useCallback(async () => {
    if (!templatesForKind.length) {
      setMessage('テンプレートを先に登録してください');
      return;
    }
    if (!form.numberRule.trim()) {
      setMessage('番号ルールを入力してください');
      return;
    }
    if (!form.templateId.trim()) {
      setMessage('テンプレートを選択してください');
      return;
    }
    if (!templatesForKind.some((template) => template.id === form.templateId)) {
      setMessage('テンプレートが存在しません');
      return;
    }
    const layoutConfig = parseAdminSettingsJson(
      'layoutConfig',
      form.layoutConfigJson,
      setMessage,
    );
    if (layoutConfig === null) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const payload = {
      kind: form.kind,
      templateId: form.templateId,
      numberRule: form.numberRule.trim(),
      layoutConfig: layoutConfig || undefined,
      logoUrl: form.logoUrl.trim() || undefined,
      signatureText: form.signatureText.trim() || undefined,
      isDefault: form.isDefault,
    };
    try {
      if (editingId) {
        await api(`/template-settings/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('テンプレ設定を更新しました');
      } else {
        await api('/template-settings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('テンプレ設定を作成しました');
      }
      await load();
      resetForm();
    } catch (err) {
      logError('submitTemplateSetting failed', err);
      setMessage('テンプレ設定の保存に失敗しました');
    }
  }, [
    editingId,
    form,
    load,
    logError,
    resetForm,
    setMessage,
    templatesForKind,
  ]);

  const startEdit = useCallback((item: TemplateSetting) => {
    setEditingId(item.id);
    setForm({
      kind: item.kind,
      templateId: item.templateId,
      numberRule: item.numberRule,
      layoutConfigJson: item.layoutConfig
        ? JSON.stringify(item.layoutConfig, null, 2)
        : '',
      logoUrl: item.logoUrl || '',
      signatureText: item.signatureText || '',
      isDefault: Boolean(item.isDefault),
    });
  }, []);

  const setDefault = useCallback(
    async (id: string) => {
      try {
        await api(`/template-settings/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isDefault: true }),
        });
        await load();
        setMessage('デフォルトテンプレートを更新しました');
      } catch (err) {
        logError('setTemplateDefault failed', err);
        setMessage('デフォルト設定に失敗しました');
      }
    },
    [load, logError, setMessage],
  );

  return {
    items,
    pdfTemplates,
    form,
    setForm,
    editingId,
    templatesForKind,
    templateNameMap,
    load,
    loadPdfTemplates,
    submit,
    resetForm,
    startEdit,
    setDefault,
  };
}
