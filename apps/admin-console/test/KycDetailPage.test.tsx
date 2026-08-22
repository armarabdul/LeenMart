import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminKycSubmissionDetail } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { KycDetailPage } from '@/pages/KycDetailPage';
import {
  useActivateVendorMutation,
  useDecideKycMutation,
  useGetKycSubmissionQuery,
  useStartKycReviewMutation,
} from '@/features/kyc-review/kyc-review.api';

vi.mock('@/features/kyc-review/kyc-review.api', () => ({
  useGetKycSubmissionQuery: vi.fn(),
  useStartKycReviewMutation: vi.fn(),
  useDecideKycMutation: vi.fn(),
  useActivateVendorMutation: vi.fn(),
}));

const mockedUseGetKycSubmissionQuery = vi.mocked(useGetKycSubmissionQuery);
const mockedUseStartKycReviewMutation = vi.mocked(useStartKycReviewMutation);
const mockedUseDecideKycMutation = vi.mocked(useDecideKycMutation);
const mockedUseActivateVendorMutation = vi.mocked(useActivateVendorMutation);

const mockStartReview = vi.fn();
const mockDecideKyc = vi.fn();
const mockActivateVendor = vi.fn();

const detail = (overrides: Partial<AdminKycSubmissionDetail> = {}): AdminKycSubmissionDetail => ({
  kycId: 'kyc-1',
  vendorId: 'vendor-1',
  vendorStatus: 'KYC_SUBMITTED',
  panLast4: '1234',
  gstin: '27AAAAA0000A1Z5',
  bankAccountLast4: '5678',
  ifsc: 'HDFC0000123',
  submittedAt: '2026-01-01T00:00:00.000Z',
  reviewedBy: null,
  startedAt: null,
  decidedBy: null,
  decidedAt: null,
  rejectionReason: null,
  rejectionNote: null,
  documents: [
    {
      type: 'PAN',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      status: 'UPLOADED',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const stub = (
  data: AdminKycSubmissionDetail | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockStartReview.mockReset();
  mockDecideKyc.mockReset();
  mockActivateVendor.mockReset();
  mockedUseGetKycSubmissionQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetKycSubmissionQuery>);
  mockedUseStartKycReviewMutation.mockReturnValue([
    mockStartReview,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useStartKycReviewMutation>);
  mockedUseDecideKycMutation.mockReturnValue([
    mockDecideKyc,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useDecideKycMutation>);
  mockedUseActivateVendorMutation.mockReturnValue([
    mockActivateVendor,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useActivateVendorMutation>);
};

const renderDetail = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/kyc-review/kyc-1']}>
        <Routes>
          <Route path="/kyc-review/:kycId" element={<KycDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('KycDetailPage', () => {
  it('shows an error state when the submission cannot be found', () => {
    stub(undefined, { isError: true });
    renderDetail();

    expect(screen.getByRole('alert')).toHaveTextContent('This submission could not be found.');
  });

  it('shows vendor identity fields, masked to the last four digits', () => {
    stub(detail());
    renderDetail();

    expect(screen.getByText('····1234')).toBeInTheDocument();
    expect(screen.getByText('····5678 · HDFC0000123')).toBeInTheDocument();
  });

  it('offers a claim action for a submitted, unclaimed submission', () => {
    stub(detail({ vendorStatus: 'KYC_SUBMITTED' }));
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Claim for review' }));
    expect(mockStartReview).toHaveBeenCalledWith('kyc-1');
    expect(screen.queryByText('Decision')).not.toBeInTheDocument();
  });

  it('offers the decision form once claimed (under review)', () => {
    stub(
      detail({
        vendorStatus: 'KYC_UNDER_REVIEW',
        reviewedBy: 'admin-1',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    renderDetail();

    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim for review' })).not.toBeInTheDocument();
  });

  it('approves with only a decision field, no reason', () => {
    stub(detail({ vendorStatus: 'KYC_UNDER_REVIEW' }));
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockDecideKyc).toHaveBeenCalledWith({ kycId: 'kyc-1', body: { decision: 'APPROVE' } });
  });

  it('rejects using the closed rejection-reason vocabulary and an optional note', () => {
    stub(detail({ vendorStatus: 'KYC_UNDER_REVIEW' }));
    renderDetail();

    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'BANK_DETAILS_MISMATCH' },
    });
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'IFSC mismatch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(mockDecideKyc).toHaveBeenCalledWith({
      kycId: 'kyc-1',
      body: { decision: 'REJECT', reason: 'BANK_DETAILS_MISMATCH', note: 'IFSC mismatch' },
    });
  });

  it('shows the rejection reason and note for a rejected submission', () => {
    stub(
      detail({
        vendorStatus: 'KYC_REJECTED',
        rejectionReason: 'DOCUMENT_UNCLEAR',
        rejectionNote: 'PAN image is blurry',
      }),
    );
    renderDetail();

    expect(screen.getByText('This submission was rejected')).toBeInTheDocument();
    expect(screen.getByText('PAN image is blurry')).toBeInTheDocument();
  });

  it('offers a separate activation action for an approved vendor, not folded into approval', () => {
    stub(
      detail({
        vendorStatus: 'KYC_APPROVED',
        decidedBy: 'admin-1',
        decidedAt: '2026-01-02T00:00:00.000Z',
      }),
    );
    renderDetail();

    const activateButton = screen.getByRole('button', { name: 'Activate vendor' });
    fireEvent.click(activateButton);
    expect(mockActivateVendor).toHaveBeenCalledWith('vendor-1');
  });

  it('shows document metadata without offering a broken "view" action', async () => {
    stub(detail());
    renderDetail();

    expect(await screen.findByText('PAN card')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view document/i })).not.toBeInTheDocument();
  });

  describe('vendor status action (Phase L.4)', () => {
    it('composes the suspend action for an ACTIVE vendor, at the page level', () => {
      stub(detail({ vendorStatus: 'ACTIVE' }));
      renderDetail();

      expect(screen.getByRole('button', { name: 'Suspend vendor' })).toBeInTheDocument();
      // KycActionPanel itself renders nothing for ACTIVE — this is the page's own composition, not a KYC decision.
      expect(screen.queryByText('Decision')).not.toBeInTheDocument();
    });

    it('composes the reinstate action for a SUSPENDED vendor, at the page level', () => {
      stub(detail({ vendorStatus: 'SUSPENDED' }));
      renderDetail();

      expect(screen.getByRole('button', { name: 'Reinstate vendor' })).toBeInTheDocument();
    });

    it('offers neither action for a vendor still mid-KYC', () => {
      stub(detail({ vendorStatus: 'KYC_UNDER_REVIEW' }));
      renderDetail();

      expect(screen.queryByRole('button', { name: 'Suspend vendor' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reinstate vendor' })).not.toBeInTheDocument();
    });
  });
});
