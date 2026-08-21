import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { ReviewResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { WriteReviewControl } from '@/features/review/components/WriteReviewControl';
import { useCreateReviewMutation, useGetMyReviewsQuery } from '@/features/review/review.api';

vi.mock('@/features/review/review.api', () => ({
  useCreateReviewMutation: vi.fn(),
  useGetMyReviewsQuery: vi.fn(),
}));

const mockedCreate = vi.mocked(useCreateReviewMutation);
const mockedMyReviews = vi.mocked(useGetMyReviewsQuery);

const ORDER_ITEM_ID = '01a01111-1111-7111-8111-111111111111';

const createReview = vi.fn();

interface Options {
  readonly subOrderStatus?: string;
  readonly myReviews?: ReviewResponse[];
  readonly rejects?: boolean;
  readonly isLoading?: boolean;
  readonly error?: unknown;
}

const renderControl = (options: Options = {}): void => {
  createReview.mockReset();
  createReview.mockReturnValue({
    unwrap:
      options.rejects === true
        ? () => Promise.reject(new Error('nope'))
        : () => Promise.resolve({ id: 'r1' }),
  });

  mockedCreate.mockReturnValue([
    createReview,
    { isLoading: options.isLoading ?? false, error: options.error },
  ] as unknown as ReturnType<typeof useCreateReviewMutation>);

  mockedMyReviews.mockReturnValue({
    data: options.myReviews ?? [],
  } as unknown as ReturnType<typeof useGetMyReviewsQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <WriteReviewControl
          orderItemId={ORDER_ITEM_ID}
          subOrderStatus={options.subOrderStatus ?? 'DELIVERED'}
        />
      </MemoryRouter>
    </Provider>,
  );
};

const openForm = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Write a review' }));
};

describe('WriteReviewControl (S8-REVIEWS)', () => {
  describe('eligibility', () => {
    it.each(['DELIVERED', 'COMPLETED'])('offers the review action for a %s sub-order', (status) => {
      renderControl({ subOrderStatus: status });

      expect(screen.getByRole('button', { name: 'Write a review' })).toBeInTheDocument();
    });

    it.each(['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP'])(
      'renders nothing for a %s sub-order — not yet reviewable',
      (status) => {
        renderControl({ subOrderStatus: status });

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
      },
    );

    it('shows "you reviewed this" instead of the form once a review exists', () => {
      renderControl({
        myReviews: [{ orderItemId: ORDER_ITEM_ID } as unknown as ReviewResponse],
      });

      expect(screen.getByText('You reviewed this item')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Write a review' })).not.toBeInTheDocument();
    });

    it('is unaffected by a review belonging to a different order item', () => {
      renderControl({
        myReviews: [{ orderItemId: 'some-other-item' } as unknown as ReviewResponse],
      });

      expect(screen.getByRole('button', { name: 'Write a review' })).toBeInTheDocument();
    });
  });

  describe('the form', () => {
    it('offers five ratings and defaults to five stars', () => {
      renderControl();
      openForm();

      expect(screen.getAllByRole('radio')).toHaveLength(5);
      expect(screen.getByRole('radio', { name: '5 stars' })).toBeChecked();
    });

    it('refuses to submit an empty body', () => {
      renderControl();
      openForm();

      expect(screen.getByRole('button', { name: 'Submit review' })).toBeDisabled();
    });

    it('refuses to submit whitespace only', () => {
      renderControl();
      openForm();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });

      expect(screen.getByRole('button', { name: 'Submit review' })).toBeDisabled();
    });

    it('submits the order item, the chosen rating and the body — and never a customer id', () => {
      renderControl();
      openForm();
      fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Good mangoes' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

      expect(createReview).toHaveBeenCalledWith({
        orderItemId: ORDER_ITEM_ID,
        rating: 4,
        body: 'Good mangoes',
      });
      // The server derives the reviewer from the session; the client must not
      // be able to name one.
      expect(JSON.stringify(createReview.mock.calls[0])).not.toMatch(/customerId|userId/);
    });
  });

  describe('success and failure are not the same thing', () => {
    it('moves to the reviewed state only after the server accepted it', async () => {
      renderControl();
      openForm();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Great' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

      expect(await screen.findByText('You reviewed this item')).toBeInTheDocument();
    });

    it('does NOT claim success when the submission failed', async () => {
      renderControl({ rejects: true });
      openForm();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Great' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

      await Promise.resolve();
      expect(screen.queryByText('You reviewed this item')).not.toBeInTheDocument();
    });

    it('does NOT claim success when the reader cancels', () => {
      // Regression: cancel and submit once shared one callback, so backing out
      // of the form falsely reported the item as reviewed.
      renderControl();
      openForm();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByText('You reviewed this item')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Write a review' })).toBeInTheDocument();
    });

    it('disables submit while the request is in flight, so one click cannot become two', () => {
      renderControl({ isLoading: true });
      openForm();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Great' } });

      expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    });
  });
});

describe('WriteReviewControl field validation (Phase H)', () => {
  it('has a real accessible label, not just a placeholder', () => {
    renderControl();
    openForm();

    expect(screen.getByLabelText('Your review')).toBeInTheDocument();
  });
});

describe('WriteReviewControl field validation errors (Phase H)', () => {
  it('reports an empty body inline once the field has been touched, not just via a disabled button', () => {
    renderControl();
    openForm();

    const body = screen.getByRole('textbox');
    fireEvent.focus(body);
    fireEvent.blur(body);

    expect(screen.getByText('String must contain at least 1 character(s)')).toBeInTheDocument();
    expect(body).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the inline error once real text is entered', () => {
    renderControl();
    openForm();

    const body = screen.getByRole('textbox');
    fireEvent.blur(body);
    expect(screen.getByText('String must contain at least 1 character(s)')).toBeInTheDocument();

    fireEvent.change(body, { target: { value: 'Great mangoes' } });
    expect(
      screen.queryByText('String must contain at least 1 character(s)'),
    ).not.toBeInTheDocument();
  });

  it('maps a field-scoped API validation error onto the review body', () => {
    renderControl({
      error: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request payload failed validation.',
            details: [
              { field: 'body.body', issue: 'String must contain at most 2000 character(s)' },
            ],
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    openForm();

    expect(screen.getByText('String must contain at most 2000 character(s)')).toBeInTheDocument();
  });
});
