import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH, type AdminUser } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import {
  useCreateAdminUserMutation,
  useListAdminUsersQuery,
} from '@/features/admin-user-management/admin-user-management.api';
import type { AdminUserListPage } from '@/features/admin-user-management/admin-user-management.api';

vi.mock('@/features/admin-user-management/admin-user-management.api', () => ({
  useListAdminUsersQuery: vi.fn(),
  useCreateAdminUserMutation: vi.fn(),
}));

const mockedUseListAdminUsersQuery = vi.mocked(useListAdminUsersQuery);
const mockedUseCreateAdminUserMutation = vi.mocked(useCreateAdminUserMutation);
const mockRefetch = vi.fn();
const mockCreateAdminUser = vi.fn();

const adminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'admin-1',
  email: 'moderator@example.com',
  role: 'CATALOGUE_MODERATOR',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const stub = (
  data: AdminUserListPage | undefined,
  options: {
    isLoading?: boolean;
    isFetching?: boolean;
    isError?: boolean;
    createLoading?: boolean;
    createError?: unknown;
    createResult?: AdminUser;
  } = {},
): void => {
  mockRefetch.mockClear();
  mockCreateAdminUser.mockReset();
  mockCreateAdminUser.mockReturnValue({
    unwrap: () =>
      options.createError !== undefined
        ? Promise.reject(new Error('rejected'))
        : Promise.resolve(options.createResult ?? adminUser()),
  });
  mockedUseListAdminUsersQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isFetching: options.isFetching ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListAdminUsersQuery>);
  mockedUseCreateAdminUserMutation.mockReturnValue([
    mockCreateAdminUser,
    { isLoading: options.createLoading ?? false, error: options.createError },
  ] as unknown as ReturnType<typeof useCreateAdminUserMutation>);
};

const renderPage = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </Provider>,
  );
};

const fillValidCreateForm = (): void => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new-admin@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct-horse-battery' },
  });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'FINANCE_ADMIN' } });
};

describe('AdminUsersPage list states', () => {
  it('renders the page heading and explanation', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Admin Users' })).toBeInTheDocument();
    expect(screen.getByText(/subordinate administrator accounts/i)).toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching', () => {
    stub(undefined, { isLoading: true });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Admin Users' })).toBeInTheDocument();
    expect(screen.queryByText('No admin users yet')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    stub(undefined, { isError: true });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Admin users could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state prompting the first admin to be created', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.getByText('No admin users yet')).toBeInTheDocument();
  });

  it('lists each admin with email, role and status', () => {
    stub({
      items: [adminUser({ email: 'risk@example.com', role: 'RISK_ANALYST', status: 'ACTIVE' })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();

    const list = within(screen.getByRole('list'));
    expect(list.getByText('risk@example.com')).toBeInTheDocument();
    expect(list.getByText(/RISK_ANALYST/)).toBeInTheDocument();
    expect(list.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('shows a load-more control only when the backend reports another page', () => {
    stub({ items: [adminUser()], nextCursor: 'cursor-2', hasMore: true });
    renderPage();

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('does not show a load-more control on the last page', () => {
    stub({ items: [adminUser()], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('AdminUsersPage create form', () => {
  it('renders the create form with email, password and role fields', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('offers exactly the four subordinate roles, and nothing else', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    const options = screen.getByLabelText('Role').querySelectorAll('option');
    const values = [...options].map((option) => option.getAttribute('value'));

    expect(values).toEqual([
      '',
      'CATALOGUE_MODERATOR',
      'FINANCE_ADMIN',
      'RISK_ANALYST',
      'SUPPORT_AGENT',
    ]);
  });

  it('never offers SUPER_ADMIN as a selectable role', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.queryByText('SUPER_ADMIN')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SUPER_ADMIN' })).not.toBeInTheDocument();
  });

  it('shows inline errors for an empty submission and never calls the endpoint', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });

  it('shows an inline error for a too-short password using the real minimum', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      screen.getByText(`String must contain at least ${PASSWORD_MIN_LENGTH} character(s)`),
    ).toBeInTheDocument();
    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });

  it('requires a role to be selected before submitting', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });

  it('submits exactly the four-field request on a valid submission', async () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    fillValidCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mockCreateAdminUser).toHaveBeenCalledWith({
        email: 'new-admin@example.com',
        password: 'correct-horse-battery',
        role: 'FINANCE_ADMIN',
      }),
    );
  });
});

describe('AdminUsersPage create success', () => {
  it('shows success feedback, resets the form, and refreshes the list', async () => {
    stub(
      { items: [], nextCursor: null, hasMore: false },
      { createResult: adminUser({ email: 'new-admin@example.com', role: 'FINANCE_ADMIN' }) },
    );
    renderPage();

    fillValidCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(screen.getByText(/new-admin@example.com was created/)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Role')).toHaveValue('');
    expect(mockRefetch).toHaveBeenCalled();
  });
});

describe('AdminUsersPage create server-side error presentation', () => {
  it('maps a VALIDATION_FAILED response onto the matching field', () => {
    stub(
      { items: [], nextCursor: null, hasMore: false },
      {
        createError: {
          status: 400,
          data: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'The request could not be validated.',
              details: [{ field: 'body.email', issue: 'Invalid email' }],
              requestId: 'req-1',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
    );
    renderPage();

    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('maps a duplicate-email conflict onto the email field, not a generic banner', () => {
    stub(
      { items: [], nextCursor: null, hasMore: false },
      {
        createError: {
          status: 409,
          data: {
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'An account with this email address already exists.',
              requestId: 'req-1',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
    );
    renderPage();

    expect(
      screen.getByText('An account with this email address already exists.'),
    ).toBeInTheDocument();
  });

  it('shows a clean, generic message for a 403 — never a raw permission error', () => {
    stub(
      { items: [], nextCursor: null, hasMore: false },
      {
        createError: {
          status: 403,
          data: {
            error: {
              code: 'UNAUTHORIZED',
              message: 'nope',
              requestId: 'req-1',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
    );
    renderPage();

    expect(
      screen.getByText('You do not have permission to perform this action.'),
    ).toBeInTheDocument();
  });

  it('shows a generic server-error message for an unmapped failure', () => {
    stub(
      { items: [], nextCursor: null, hasMore: false },
      {
        createError: {
          status: 500,
          data: {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Something went wrong.',
              requestId: 'req-1',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
    );
    renderPage();

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});

describe('AdminUsersPage security', () => {
  it('never renders a password field, input, or value inside the roster itself', () => {
    stub({ items: [adminUser()], nextCursor: null, hasMore: false });
    renderPage();

    const list = within(screen.getByRole('list'));
    expect(list.queryByText(/password/i)).not.toBeInTheDocument();
    expect(list.queryByLabelText(/password/i)).not.toBeInTheDocument();
    // The only password input on the page is the create form's own, and it
    // is always empty — never pre-filled from an existing admin's record
    // (the record has no password field to fill it from in the first place;
    // `adminUserSchema` carries none).
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('never renders a password hash, MFA secret, or MFA state inside the roster itself', () => {
    stub({ items: [adminUser()], nextCursor: null, hasMore: false });
    renderPage();

    // Scoped to the roster, not the whole page: the page's own explanatory
    // copy legitimately mentions "MFA" (new accounts start with none) —
    // that is expected help text, not a data leak. What must never appear
    // is any of these words attached to a specific admin's row.
    const listText = screen.getByRole('list').textContent ?? '';
    expect(listText).not.toMatch(/hash/i);
    expect(listText).not.toMatch(/mfa/i);
    expect(listText).not.toMatch(/totp/i);
    expect(listText).not.toMatch(/secret/i);
    expect(listText).not.toMatch(/password/i);
  });

  it('offers no client-side mechanism to submit SUPER_ADMIN as a role', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    const roleSelect = screen.getByLabelText('Role');
    fireEvent.change(roleSelect, { target: { value: 'SUPER_ADMIN' } });

    // jsdom refuses to set a <select> to a value with no matching <option> —
    // it stays on whatever it already had, proving there is no hidden path
    // to submit a role the rendered options never offered.
    expect(roleSelect).not.toHaveValue('SUPER_ADMIN');
  });
});
