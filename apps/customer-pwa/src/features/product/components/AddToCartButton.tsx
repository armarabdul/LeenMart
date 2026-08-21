import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button } from '@leen-mart/ui';
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
      <Button
        type="button"
        size="lg"
        onClick={handleClick}
        disabled={disabled}
        loading={isLoading}
        className="w-full"
      >
        {isLoading ? 'Adding…' : justAdded ? 'Added to cart' : 'Add to cart'}
      </Button>
      {error !== undefined && <Alert tone="danger">{apiErrorMessage(error)}</Alert>}
    </div>
  );
};
