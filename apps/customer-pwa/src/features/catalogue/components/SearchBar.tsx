import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface SearchBarProps {
  readonly autoFocus?: boolean;
}

/**
 * Submits to `/search?q=...` rather than searching inline — a dedicated
 * results route is what makes a search shareable/bookmarkable/back-
 * button-able, and keeps this component free of any query-fetching concern
 * of its own.
 */
export const SearchBar = ({ autoFocus = false }: SearchBarProps): JSX.Element => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get('q') ?? '');

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    void navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={handleSubmit} role="search" className="flex w-full gap-2">
      <label className="sr-only" htmlFor="marketplace-search">
        Search products
      </label>
      <input
        id="marketplace-search"
        type="search"
        autoFocus={autoFocus}
        placeholder="Search products…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
      >
        Search
      </button>
    </form>
  );
};
