import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { sessionEstablished } from '@/shared/api/session.slice';
import { VendorStreamAlert } from '@/features/vendor-stream/VendorStreamAlert';
import { RECONNECT_DELAY_MS } from '@/features/vendor-stream/useVendorOrderStream';

vi.mock('@/features/vendor-stream/alert-tone', () => ({
  startAlertTone: vi.fn(),
  stopAlertTone: vi.fn(),
}));

const { startAlertTone, stopAlertTone } = await import('@/features/vendor-stream/alert-tone');
const mockedStart = vi.mocked(startAlertTone);
const mockedStop = vi.mocked(stopAlertTone);

const session: AuthSessionResponse = {
  user: {
    id: '00000000-0000-7000-8000-000000000001',
    email: 'vendor@example.com',
    role: 'VENDOR_OWNER',
  },
  accessToken: 'the-access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

/** A controllable fake SSE stream — pushes raw wire frames on demand, and can be ended to simulate a disconnect. */
class FakeSseStream {
  readonly response: Response;
  private controller!: ReadableStreamDefaultController<Uint8Array>;

  constructor() {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.response = new Response(stream, { status: 200 });
  }

  push(eventType: string, data: unknown): void {
    const frame = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    this.controller.enqueue(new TextEncoder().encode(frame));
  }

  end(): void {
    this.controller.close();
  }
}

const renderAlert = (): void => {
  const store = createStore();
  store.dispatch(sessionEstablished(session));

  render(
    <Provider store={store}>
      <MemoryRouter>
        <VendorStreamAlert />
      </MemoryRouter>
    </Provider>,
  );
};

describe('VendorStreamAlert (S4-SSE)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let streams: FakeSseStream[];

  beforeEach(() => {
    streams = [];
    fetchMock = vi.fn().mockImplementation(() => {
      const stream = new FakeSseStream();
      streams.push(stream);
      return Promise.resolve(stream.response);
    });
    vi.stubGlobal('fetch', fetchMock);
    mockedStart.mockClear();
    mockedStop.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing before any order.placed frame arrives', () => {
    renderAlert();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('connects with the bearer token in the Authorization header, not a query parameter', async () => {
    renderAlert();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/vendor/stream');
    expect(url).not.toContain('token=');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer the-access-token');
  });

  it('shows the accessible alert and starts the audible tone on order.placed', async () => {
    renderAlert();
    await waitFor(() => expect(streams).toHaveLength(1));

    streams[0]?.push('order.placed', {
      orderId: 'order-1',
      occurredAt: '2026-08-20T00:00:00.000Z',
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('New order received');
    expect(mockedStart).toHaveBeenCalled();
  });

  it('acknowledge stops the tone and hides the alert', async () => {
    renderAlert();
    await waitFor(() => expect(streams).toHaveLength(1));
    streams[0]?.push('order.placed', {
      orderId: 'order-1',
      occurredAt: '2026-08-20T00:00:00.000Z',
    });
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedStop).toHaveBeenCalled();
  });

  it('a second order.placed after acknowledging raises the alert again', async () => {
    renderAlert();
    await waitFor(() => expect(streams).toHaveLength(1));

    streams[0]?.push('order.placed', {
      orderId: 'order-1',
      occurredAt: '2026-08-20T00:00:00.000Z',
    });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    streams[0]?.push('order.placed', {
      orderId: 'order-2',
      occurredAt: '2026-08-20T00:05:00.000Z',
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
  });

  it(
    'reconnects after the stream ends',
    async () => {
      renderAlert();
      await waitFor(() => expect(streams).toHaveLength(1));

      streams[0]?.end();

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: RECONNECT_DELAY_MS + 2_000,
        interval: 250,
      });
    },
    RECONNECT_DELAY_MS + 5_000,
  );

  it('the acknowledge control has an accessible name', async () => {
    renderAlert();
    await waitFor(() => expect(streams).toHaveLength(1));
    streams[0]?.push('order.placed', {
      orderId: 'order-1',
      occurredAt: '2026-08-20T00:00:00.000Z',
    });
    await screen.findByRole('alert');

    expect(
      screen.getByRole('button', { name: 'Acknowledge new order alert and stop the sound' }),
    ).toBeInTheDocument();
  });
});
