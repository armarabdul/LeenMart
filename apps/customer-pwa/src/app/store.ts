import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { baseApi } from '@/shared/api/base-api';
import { sessionReducer } from '@/shared/api/session.slice';

/**
 * Store factory.
 *
 * Exported separately from the singleton so tests can build an isolated store
 * per case instead of sharing mutable state between them.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Redux Toolkit's configureStore creates a highly complex inferred type that should not be manually defined.
export const createStore = () =>
  configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      session: sessionReducer,
      // Further feature slices are registered here as modules are built.
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
    devTools: import.meta.env.DEV,
  });

export const store = createStore();

// Enables refetchOnFocus / refetchOnReconnect behaviour.
setupListeners(store.dispatch);

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
