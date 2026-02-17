import React from 'react';

type TemplateFormValue = {
  kind: string;
  templateId: string;
  numberRule: string;
  layoutConfigJson: string;
  logoUrl: string;
  signatureText: string;
  isDefault: boolean;
};

type TemplateOption = {
  id: string;
  name: string;
};

type TemplateSettingItem = {
  id: string;
  kind: string;
  templateId: string;
  numberRule: string;
  logoUrl?: string | null;
  signatureText?: string | null;
  isDefault?: boolean | null;
};

type TemplateSettingsCardProps = {
  templateForm: TemplateFormValue;
  setTemplateForm: React.Dispatch<React.SetStateAction<TemplateFormValue>>;
  templateKinds: readonly string[];
  templatesForKind: TemplateOption[];
  editingTemplateId: string | null;
  onSubmit: () => void;
  onReset: () => void;
  onReload: () => void;
  items: TemplateSettingItem[];
  templateNameMap: Map<string, string>;
  onEdit: (item: TemplateSettingItem) => void;
  onSetDefault: (id: string) => void;
};

export const TemplateSettingsCard: React.FC<TemplateSettingsCardProps> = ({
  templateForm,
  setTemplateForm,
  templateKinds,
  templatesForKind,
  editingTemplateId,
  onSubmit,
  onReset,
  onReload,
  items,
  templateNameMap,
  onEdit,
  onSetDefault,
}) => {
  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>テンプレ設定（見積/請求/発注）</strong>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <label>
          種別
          <select
            value={templateForm.kind}
            onChange={(e) =>
              setTemplateForm({ ...templateForm, kind: e.target.value })
            }
          >
            {templateKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          テンプレ
          <select
            value={templateForm.templateId}
            onChange={(e) =>
              setTemplateForm({
                ...templateForm,
                templateId: e.target.value,
              })
            }
          >
            {templatesForKind.length === 0 && <option value="">テンプレなし</option>}
            {templatesForKind.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          番号ルール
          <input
            type="text"
            value={templateForm.numberRule}
            onChange={(e) =>
              setTemplateForm({
                ...templateForm,
                numberRule: e.target.value,
              })
            }
            placeholder="PYYYY-MM-NNNN"
          />
        </label>
        <label>
          ロゴURL
          <input
            type="text"
            value={templateForm.logoUrl}
            onChange={(e) =>
              setTemplateForm({ ...templateForm, logoUrl: e.target.value })
            }
            placeholder="https://..."
          />
        </label>
        <label>
          署名テキスト
          <input
            type="text"
            value={templateForm.signatureText}
            onChange={(e) =>
              setTemplateForm({
                ...templateForm,
                signatureText: e.target.value,
              })
            }
            placeholder="代表取締役 ..."
          />
        </label>
        <label className="badge" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={templateForm.isDefault}
            onChange={(e) =>
              setTemplateForm({
                ...templateForm,
                isDefault: e.target.checked,
              })
            }
            style={{ marginRight: 6 }}
          />
          default
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label style={{ flex: 1, minWidth: 240 }}>
          layoutConfig (JSON)
          <textarea
            value={templateForm.layoutConfigJson}
            onChange={(e) =>
              setTemplateForm({
                ...templateForm,
                layoutConfigJson: e.target.value,
              })
            }
            rows={3}
            style={{ width: '100%' }}
          />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="button" onClick={onSubmit}>
          {editingTemplateId ? '更新' : '作成'}
        </button>
        <button className="button secondary" onClick={onReset}>
          クリア
        </button>
        <button className="button secondary" onClick={onReload}>
          再読込
        </button>
      </div>
      <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {items.length === 0 && <div className="card">設定なし</div>}
        {items.map((item) => (
          <div key={item.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{item.kind}</strong> / {item.templateId}
                {templateNameMap.has(item.templateId) &&
                  ` (${templateNameMap.get(item.templateId)})`}{' '}
                / {item.numberRule}
              </div>
              <span className="badge">
                {item.isDefault ? 'default' : 'custom'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              logo: {item.logoUrl || '-'} / signature: {item.signatureText || '-'}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="button secondary" onClick={() => onEdit(item)}>
                編集
              </button>
              <button
                className="button secondary"
                disabled={Boolean(item.isDefault)}
                onClick={() => onSetDefault(item.id)}
              >
                デフォルト化
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
