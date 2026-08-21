import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { KycSubmissionForm } from '@/features/vendor/components/KycSubmissionForm';
import { useCreateKycUploadIntentMutation, useSubmitKycMutation } from '@/features/vendor/kyc.api';
import { submitKycDocuments } from '@/features/vendor/lib/submit-kyc-documents';

vi.mock('@/features/vendor/kyc.api', () => ({
  useCreateKycUploadIntentMutation: vi.fn(),
  useSubmitKycMutation: vi.fn(),
}));
vi.mock('@/features/vendor/lib/submit-kyc-documents', () => ({ submitKycDocuments: vi.fn() }));

const mockedUseCreateKycUploadIntentMutation = vi.mocked(useCreateKycUploadIntentMutation);
const mockedUseSubmitKycMutation = vi.mocked(useSubmitKycMutation);
const mockedSubmitKycDocuments = vi.mocked(submitKycDocuments);

interface StubOptions {
  readonly intentError?: unknown;
  readonly submitKycError?: unknown;
}

const stub = (options: StubOptions = {}): void => {
  mockedSubmitKycDocuments.mockReset();
  mockedSubmitKycDocuments.mockResolvedValue(undefined);
  mockedUseCreateKycUploadIntentMutation.mockReturnValue([
    vi.fn(),
    { error: options.intentError },
  ] as unknown as ReturnType<typeof useCreateKycUploadIntentMutation>);
  mockedUseSubmitKycMutation.mockReturnValue([
    vi.fn(),
    { error: options.submitKycError },
  ] as unknown as ReturnType<typeof useSubmitKycMutation>);
};

const renderForm = (isResubmission = false): void => {
  render(
    <Provider store={createStore()}>
      <KycSubmissionForm vendorId="vendor-1" isResubmission={isResubmission} />
    </Provider>,
  );
};

const pdf = (name: string): File => new File(['x'], name, { type: 'application/pdf' });

const fillBusinessDetails = (): void => {
  fireEvent.change(screen.getByLabelText('PAN'), { target: { value: 'ABCDE1234F' } });
  fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29ABCDE1234F1Z5' } });
  fireEvent.change(screen.getByLabelText('Bank account number'), {
    target: { value: '000123456789' },
  });
  fireEvent.change(screen.getByLabelText('IFSC code'), { target: { value: 'HDFC0000123' } });
};

const fillDocuments = (): void => {
  fireEvent.change(screen.getByLabelText('PAN card'), { target: { files: [pdf('pan.pdf')] } });
  fireEvent.change(screen.getByLabelText('GSTIN certificate'), {
    target: { files: [pdf('gstin.pdf')] },
  });
  fireEvent.change(screen.getByLabelText(/Bank account proof/), {
    target: { files: [pdf('bank.pdf')] },
  });
};

describe('KycSubmissionForm', () => {
  it('starts with every field empty and no error shown', () => {
    stub();
    renderForm();

    expect(screen.getByLabelText('PAN')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an empty submission with inline errors and never starts the upload', () => {
    stub();
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(
      screen.getAllByText('String must contain at least 1 character(s)').length,
    ).toBeGreaterThan(0);
    expect(mockedSubmitKycDocuments).not.toHaveBeenCalled();
  });

  it('requires all three documents, not fewer', () => {
    stub();
    renderForm();

    fillBusinessDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(screen.getAllByText('Choose a file')).toHaveLength(3);
    expect(mockedSubmitKycDocuments).not.toHaveBeenCalled();
  });

  it('clears a text field error live once it becomes valid', () => {
    stub();
    renderForm();
    const pan = screen.getByLabelText('PAN');

    fireEvent.change(pan, { target: { value: '' } });
    fireEvent.blur(pan);
    expect(screen.getByText('String must contain at least 1 character(s)')).toBeInTheDocument();

    fireEvent.change(pan, { target: { value: 'ABCDE1234F' } });
    expect(
      screen.queryByText('String must contain at least 1 character(s)'),
    ).not.toBeInTheDocument();
  });

  it('submits the encryption/upload orchestration once every field and document is valid', async () => {
    stub();
    renderForm();

    fillBusinessDetails();
    fillDocuments();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() =>
      expect(mockedSubmitKycDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: 'vendor-1',
          text: {
            pan: 'ABCDE1234F',
            gstin: '29ABCDE1234F1Z5',
            accountNumber: '000123456789',
            ifsc: 'HDFC0000123',
          },
        }),
      ),
    );
  });

  it('surfaces an upload-intent server error', () => {
    stub({
      intentError: {
        status: 500,
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'boom',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderForm();

    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('surfaces a submission server error', () => {
    stub({
      submitKycError: {
        status: 500,
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'boom',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderForm();

    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('labels the button "Resubmit for review" after a prior rejection', () => {
    stub();
    renderForm(true);

    expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeInTheDocument();
  });

  it('labels the button "Submit for review" for a first-time submission', () => {
    stub();
    renderForm(false);

    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
  });
});
