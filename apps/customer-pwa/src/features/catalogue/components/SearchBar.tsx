import { useState, type FormEvent } from 'react';
import { Button, SearchInput } from '@leen-mart/ui';
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
    <form onSubmit={handleSubmit} role="search" className="flex w-full items-center gap-2">
      {/* Phase C: the shared `SearchInput` supplies the icon, the clear
          affordance and the token styling; this component keeps sole ownership
          of where a submitted query navigates. */}
      <SearchInput
        id="marketplace-search"
        label="Search products"
        autoFocus={autoFocus}
        placeholder="Search products…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onClear={() => setValue('')}
      />
      <Button type="submit" size="md" className="shrink-0">
        Search
      </Button>
    </form>
  );
};
