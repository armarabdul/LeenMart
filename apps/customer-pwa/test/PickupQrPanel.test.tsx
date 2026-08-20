import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { PickupQrPanel } from '@/features/checkout/components/PickupQrPanel';
import { useGetPickupTokenQuery } from '@/features/checkout/checkout.api';

vi.mock('@/features/checkout/checkout.api', () => ({
  useGetPickupTokenQuery: vi.fn(),
}));

const mockedUseGetPickupTokenQuery = vi.mocked(useGetPickupTokenQuery);

/** Matches the backend's own TTL, so the schedule under test is the real one. */
const TTL_MS = 90_000;
/** `PickupQrPanel` re-fetches this far ahead of `expiresAt`. */
const REFRESH_MARGIN_MS = 10_000;

interface QueryState {
  readonly token?: string;
  readonly manualCode?: string;
  readonly expiresInMs?: number;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly error?: unknown;
}

const refetch = vi.fn();

/** Stands in for RTK Query's own per-fetch timestamp, which the panel re-arms its timer on. */
let fulfilledTimeStamp = 0;

const stubQuery = (state: QueryState): void => {
  fulfilledTimeStamp += 1;
  mockedUseGetPickupTokenQuery.mockReturnValue({
    data:
      state.token === undefined
        ? undefined
        : {
            token: state.token,
            expiresAt: new Date(Date.now() + (state.expiresInMs ?? TTL_MS)).toISOString(),
            manualCode: state.manualCode ?? '4821',
          },
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error,
    refetch,
    fulfilledTimeStamp: state.token === undefined ? undefined : fulfilledTimeStamp,
  } as unknown as ReturnType<typeof useGetPickupTokenQuery>);
};

const renderPanel = (): ReturnType<typeof render> =>
  render(
    <Provider store={createStore()}>
      <PickupQrPanel orderId="order-1" subOrderId="sub-1" />
    </Provider>,
  );

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const code = (): HTMLElement => screen.getByLabelText('Pickup code');

describe('PickupQrPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refetch.mockClear();
    mockedUseGetPickupTokenQuery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading state before the first token arrives', () => {
    stubQuery({ isLoading: true });
    renderPanel();

    expect(screen.getByText('Preparing your pickup code…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pickup code')).not.toBeInTheDocument();
  });

  it('renders the issued token', () => {
    stubQuery({ token: 'pickup-token-1' });
    renderPanel();

    expect(code()).toHaveTextContent('pickup-token-1');
  });

  it('shows the manual/scanner-broken fallback code alongside the QR code (S4-QR-FALLBACK)', () => {
    stubQuery({ token: 'pickup-token-1', manualCode: '7392' });
    renderPanel();

    expect(screen.getByLabelText('Manual pickup code')).toHaveTextContent('7392');
  });

  it('does not show a manual code while the QR code is unavailable', () => {
    stubQuery({ isError: true, error: { status: 422, data: { error: { code: 'X' } } } });
    renderPanel();

    expect(screen.queryByLabelText('Manual pickup code')).not.toBeInTheDocument();
  });

  it('tells the customer the code is single-use and self-refreshing', () => {
    stubQuery({ token: 'pickup-token-1' });
    renderPanel();

    expect(
      screen.getByText(
        'Show this code at the shop. It refreshes automatically and can be used once.',
      ),
    ).toBeInTheDocument();
  });

  it('surfaces a failure with the backend’s own uniform wording and shows no code', () => {
    stubQuery({
      isError: true,
      error: {
        status: 422,
        data: {
          error: {
            code: 'PICKUP_TOKEN_INVALID',
            message: 'This pickup token is invalid or has expired.',
          },
        },
      },
    });
    renderPanel();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This pickup token is invalid or has expired.',
    );
    expect(screen.queryByLabelText('Pickup code')).not.toBeInTheDocument();
  });

  it('re-fetches ahead of expiry rather than after it, so the displayed code is never dead', async () => {
    stubQuery({ token: 'pickup-token-1' });
    renderPanel();

    await advance(TTL_MS - REFRESH_MARGIN_MS - 1_000);
    expect(refetch).not.toHaveBeenCalled();

    await advance(1_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('schedules the next refresh from each new token, so rotation continues', async () => {
    stubQuery({ token: 'pickup-token-1' });
    const { rerender } = renderPanel();

    await advance(TTL_MS - REFRESH_MARGIN_MS);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The rotated token the refetch produced. Note its refresh delay is
    // numerically identical to the first token's — a component keyed on that
    // delay would arm no further timer and leave the customer holding a code
    // that expires in ten seconds and is never replaced.
    stubQuery({ token: 'pickup-token-2' });
    rerender(
      <Provider store={createStore()}>
        <PickupQrPanel orderId="order-1" subOrderId="sub-1" />
      </Provider>,
    );

    expect(code()).toHaveTextContent('pickup-token-2');

    await advance(TTL_MS - REFRESH_MARGIN_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('stops showing a previously issued code once the backend refuses to reissue one', () => {
    // What the customer sees after the vendor has already redeemed it: the
    // last token is still in cache, but it is spent.
    stubQuery({
      token: 'pickup-token-1',
      isError: true,
      error: {
        status: 422,
        data: {
          error: {
            code: 'PICKUP_TOKEN_UNAVAILABLE',
            message: 'A pickup code is not available for this order right now.',
          },
        },
      },
    });
    renderPanel();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A pickup code is not available for this order right now.',
    );
    expect(screen.queryByLabelText('Pickup code')).not.toBeInTheDocument();
    expect(screen.queryByText('pickup-token-1')).not.toBeInTheDocument();
  });

  it('never polls faster than its floor, even if the token is already expired', async () => {
    // `expiresAt` in the past would otherwise compute a negative delay and
    // turn a stuck clock into a request loop.
    stubQuery({ token: 'pickup-token-1', expiresInMs: -60_000 });
    renderPanel();

    await advance(4_000);
    expect(refetch).not.toHaveBeenCalled();

    await advance(1_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
