import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/shared/api/session.slice';
import { apiErrorMessage } from '@/shared/api/base-api';

interface AddToCartButtonProps {
  readonly onAddToCart: () => void;
  readonly isLoading: boolean;
  readonly error?: unknown;
  readonly justAdded: boolean;
  readonly disabled?: boolean | undefined;
}

/**
 * The cart mutation itself is owned by `ProductDetailPage` (not this
 * component) and handed down as `onAddToCart` — `features/product` may not
 * import `features/cart/cart.api` directly (SDD 25.3's feature-isolation
 * rule), so composition happens at the page level instead, exactly as the
 * lint rule's own message recommends.
 *
 * An anonymous customer never reaches `onAddToCart` at all — `RequireAuth`'s
 * own `state: { from: location }` redirect shape is reused verbatim (not a
 * second auth mechanism) so `LoginPage` sends the customer back to this exact
 * product page after signing in.
 */
export const AddToCartButton = ({
  onAddToCart,
  isLoading,
  error,
  justAdded,
  disabled = false,
}: AddToCartButtonProps): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const navigate = useNavigate();
  const location = useLocation();

  const handleClick = (): void => {
    if (!isAuthenticated) {
      void navigate('/login', { state: { from: location } });
      return;
    }
    onAddToCart();
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isLoading}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {isLoading ? 'Adding…' : justAdded ? 'Added to cart' : 'Add to cart'}
      </button>
      {error !== undefined && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error)}
        </p>
      )}
    </div>
  );
};
