import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { baseApi } from '@/shared/api/base-api';
import { sessionReducer } from '@/shared/api/session.slice';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Redux Toolkit's configureStore creates a highly complex inferred type that should not be manually defined.
export const createStore = () =>
  configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      session: sessionReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
    devTools: import.meta.env.DEV,
  });

export const store = createStore();

setupListeners(store.dispatch);

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
