import { useEffect, useRef, useState } from 'react';
import type { PublicProductSearchResult } from '@leen-mart/contracts';
import { useSearchProductsQuery } from '../catalogue.api';

interface UseProductSearchParams {
  readonly q?: string | undefined;
  readonly categoryId?: string | undefined;
}

interface UseProductSearchResult {
  readonly items: readonly PublicProductSearchResult[];
  readonly isLoading: boolean;
  readonly isFetchingMore: boolean;
  readonly isError: boolean;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
}

/**
 * Accumulates cursor-paginated pages into one flat list for "Load more" UX.
 * `searchProducts` itself stays a plain single-page query (no RTK Query
 * `merge`/`serializeQueryArgs` machinery) — accumulation is a page-level
 * concern shared by `CataloguePage` and `SearchPage`, so it lives here
 * rather than in the endpoint definition.
 */
export const useProductSearch = ({
  q,
  categoryId,
}: UseProductSearchParams): UseProductSearchResult => {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly PublicProductSearchResult[]>([]);
  const paramsKey = `${q ?? ''}::${categoryId ?? ''}`;
  const previousParamsKey = useRef(paramsKey);

  const { data, isFetching, isError } = useSearchProductsQuery({ q, categoryId, cursor });

  useEffect(() => {
    if (previousParamsKey.current !== paramsKey) {
      previousParamsKey.current = paramsKey;
      setCursor(undefined);
      setItems([]);
    }
  }, [paramsKey]);

  useEffect(() => {
    if (!data) return;
    setItems((current) => (cursor === undefined ? data.items : [...current, ...data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return {
    items,
    isLoading: isFetching && cursor === undefined && items.length === 0,
    isFetchingMore: isFetching && cursor !== undefined,
    isError,
    hasMore: data?.hasMore ?? false,
    loadMore: () => {
      if (data?.nextCursor) setCursor(data.nextCursor);
    },
  };
};
