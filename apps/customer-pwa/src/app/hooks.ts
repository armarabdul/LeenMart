import { useDispatch, useSelector, useStore } from 'react-redux';
import type { AppDispatch, AppStore, RootState } from './store';

/**
 * Pre-typed Redux hooks.
 *
 * Components use these instead of the untyped originals so state and dispatch
 * are correctly typed at every call site without repeated generics.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppStore = useStore.withTypes<AppStore>();
