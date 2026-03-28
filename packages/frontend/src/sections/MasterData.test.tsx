import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, getAuthState, useProjects } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  useProjects: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../hooks/useProjects', () => ({ useProjects }));
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: ({ targetId }: { targetId: string }) => (
    <div>annotations:{targetId}</div>
  ),
}));
vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <section>
        <h3>{title}</h3>
        <div>{children}</div>
        <div>{footer}</div>
      </section>
    ) : null,
  Select: ({
    label,
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
    children?: React.ReactNode;
  }) => (
    <label>
      {label}
      <select {...props}>{children}</select>
    </label>
  ),
}));

import { MasterData } from './MasterData';

const projects = [{ id: 'project-1', code: 'PRJ', name: 'Project One' }];

const customer = {
  id: 'customer-1',
  code: 'C001',
  name: 'Alpha Corp',
  status: 'active',
};

const vendor = {
  id: 'vendor-1',
  code: 'V001',
  name: 'Vendor One',
  status: 'active',
};

function getCustomerSection() {
  return screen.getByRole('heading', { name: '顧客' })
    .parentElement as HTMLElement;
}

function getVendorSection() {
  return screen.getByRole('heading', { name: '業者' })
    .parentElement as HTMLElement;
}

function getContactSection() {
  return screen.getByRole('heading', { name: '連絡先' })
    .parentElement as HTMLElement;
}

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(getAuthState).mockReturnValue({
    token: 'token',
    userId: 'user-1',
    roles: ['admin'],
    projectIds: ['project-1'],
  });
  vi.mocked(useProjects).mockReturnValue({
    projects,
    projectMessage: '',
  });
});

afterEach(() => {
  cleanup();
});

describe('MasterData', () => {
  it('validates required customer fields before save', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/customers') return { items: [] } as never;
      if (path === '/vendors') return { items: [] } as never;
      throw new Error(`Unhandled api path: ${path}`);
    });

    render(<MasterData />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/customers');
      expect(api).toHaveBeenCalledWith('/vendors');
    });
    fireEvent.click(
      within(getCustomerSection()).getByRole('button', { name: '追加' }),
    );

    expect(screen.getByText('コードと名称は必須です')).toBeInTheDocument();
    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
  });

  it('creates a customer and reloads the list', async () => {
    let customerLoads = 0;
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/customers' && !init?.method) {
          customerLoads += 1;
          return customerLoads > 1
            ? ({ items: [customer] } as never)
            : ({ items: [] } as never);
        }
        if (path === '/vendors') return { items: [] } as never;
        if (path === '/customers' && init?.method === 'POST')
          return customer as never;
        throw new Error(`Unhandled api path: ${path}`);
      },
    );

    render(<MasterData />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/customers');
      expect(api).toHaveBeenCalledWith('/vendors');
    });
    fireEvent.change(screen.getByLabelText('顧客コード'), {
      target: { value: 'C001' },
    });
    fireEvent.change(screen.getByLabelText('顧客名称'), {
      target: { value: 'Alpha Corp' },
    });
    fireEvent.click(
      within(getCustomerSection()).getByRole('button', { name: '追加' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/customers', {
        method: 'POST',
        body: JSON.stringify({
          code: 'C001',
          name: 'Alpha Corp',
          status: 'active',
          invoiceRegistrationId: undefined,
          taxRegion: undefined,
          billingAddress: undefined,
          externalSource: undefined,
          externalId: undefined,
        }),
      });
    });

    expect(screen.getByText('顧客を追加しました')).toBeInTheDocument();
    expect(
      await within(getCustomerSection()).findByText(
        (content, element) =>
          element?.tagName === 'LI' && content.includes('C001 / Alpha Corp'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('顧客コード')).toHaveValue('');
  });

  it('requires an owner before saving a contact', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/customers') return { items: [customer] } as never;
      if (path === '/vendors') return { items: [vendor] } as never;
      throw new Error(`Unhandled api path: ${path}`);
    });

    render(<MasterData />);

    await within(getContactSection()).findByRole('option', {
      name: 'C001 / Alpha Corp',
    });
    fireEvent.click(
      within(getContactSection()).getByRole('button', { name: '追加' }),
    );

    expect(
      screen.getByText('顧客または業者を選択してください'),
    ).toBeInTheDocument();
    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
  });

  it('shows an error when editing a contact without owner', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/customers') return { items: [customer] } as never;
      if (path === '/vendors') return { items: [vendor] } as never;
      if (path === '/contacts?customerId=customer-1') {
        return {
          items: [
            {
              id: 'contact-1',
              customerId: null,
              vendorId: null,
              name: 'No Owner',
              isPrimary: false,
            },
          ],
        } as never;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    render(<MasterData />);

    await within(getContactSection()).findByRole('option', {
      name: 'C001 / Alpha Corp',
    });
    fireEvent.change(screen.getByLabelText('連絡先の紐付け先'), {
      target: { value: 'customer-1' },
    });

    expect(await screen.findByText('No Owner')).toBeInTheDocument();
    fireEvent.click(
      within(getContactSection()).getByRole('button', { name: '編集' }),
    );

    expect(
      screen.getByText(
        'この連絡先には紐づく顧客または業者がありません。管理者にお問い合わせください。',
      ),
    ).toBeInTheDocument();
  });

  it('creates a vendor and reloads the list', async () => {
    let vendorLoads = 0;
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/customers') return { items: [] } as never;
        if (path === '/vendors' && !init?.method) {
          vendorLoads += 1;
          return vendorLoads > 1
            ? ({ items: [vendor] } as never)
            : ({ items: [] } as never);
        }
        if (path === '/vendors' && init?.method === 'POST') {
          return vendor as never;
        }
        throw new Error(`Unhandled api path: ${path}`);
      },
    );

    render(<MasterData />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/customers');
      expect(api).toHaveBeenCalledWith('/vendors');
    });
    fireEvent.change(screen.getByLabelText('業者コード'), {
      target: { value: 'V001' },
    });
    fireEvent.change(screen.getByLabelText('業者名称'), {
      target: { value: 'Vendor One' },
    });
    fireEvent.change(screen.getByLabelText('業者振込情報'), {
      target: { value: 'Bank Account' },
    });
    fireEvent.click(
      within(getVendorSection()).getByRole('button', { name: '追加' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/vendors', {
        method: 'POST',
        body: JSON.stringify({
          code: 'V001',
          name: 'Vendor One',
          status: 'active',
          bankInfo: 'Bank Account',
          taxRegion: undefined,
          externalSource: undefined,
          externalId: undefined,
        }),
      });
    });

    expect(screen.getByText('業者を追加しました')).toBeInTheDocument();
    expect(
      await within(getVendorSection()).findByText(
        (content, element) =>
          element?.tagName === 'LI' && content.includes('V001 / Vendor One'),
      ),
    ).toBeInTheDocument();
  });

  it('creates a vendor contact and reloads vendor contacts', async () => {
    let contactLoads = 0;
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/customers') return { items: [customer] } as never;
        if (path === '/vendors') return { items: [vendor] } as never;
        if (path === '/contacts?vendorId=vendor-1' && !init?.method) {
          contactLoads += 1;
          return contactLoads > 1
            ? ({
                items: [
                  {
                    id: 'contact-1',
                    customerId: null,
                    vendorId: 'vendor-1',
                    name: 'Vendor Contact',
                    email: 'vendor@example.com',
                    isPrimary: false,
                  },
                ],
              } as never)
            : ({ items: [] } as never);
        }
        if (path === '/contacts' && init?.method === 'POST') {
          return {
            id: 'contact-1',
            vendorId: 'vendor-1',
            name: 'Vendor Contact',
          } as never;
        }
        throw new Error(`Unhandled api path: ${path}`);
      },
    );

    render(<MasterData />);

    fireEvent.change(screen.getByLabelText('連絡先の紐付け種別'), {
      target: { value: 'vendor' },
    });
    await within(getContactSection()).findByRole('option', {
      name: 'V001 / Vendor One',
    });
    fireEvent.change(screen.getByLabelText('連絡先の紐付け先'), {
      target: { value: 'vendor-1' },
    });
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/contacts?vendorId=vendor-1');
    });
    fireEvent.change(screen.getByLabelText('連絡先氏名'), {
      target: { value: 'Vendor Contact' },
    });
    fireEvent.change(screen.getByLabelText('連絡先メール'), {
      target: { value: 'vendor@example.com' },
    });
    fireEvent.click(
      within(getContactSection()).getByRole('button', { name: '追加' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Vendor Contact',
          email: 'vendor@example.com',
          phone: undefined,
          role: undefined,
          isPrimary: false,
          vendorId: 'vendor-1',
        }),
      });
    });

    expect(screen.getByText('連絡先を追加しました')).toBeInTheDocument();
    expect(
      await within(getContactSection()).findByText(
        (content, element) =>
          element?.tagName === 'LI' &&
          content.includes('Vendor Contact / vendor@example.com'),
      ),
    ).toBeInTheDocument();
  });

  it('opens the vendor annotation dialog', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/customers') return { items: [customer] } as never;
      if (path === '/vendors') return { items: [vendor] } as never;
      throw new Error(`Unhandled api path: ${path}`);
    });

    render(<MasterData />);

    const button = await screen.findByRole('button', {
      name: '注釈（業者）: V001 / Vendor One',
    });
    fireEvent.click(button);

    expect(
      screen.getByRole('heading', { name: '業者: V001 / Vendor One' }),
    ).toBeInTheDocument();
    expect(screen.getByText('annotations:vendor-1')).toBeInTheDocument();
  });
});
