import { Alert, Button, Card } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useRegisterVendorMutation } from '../vendor.api';

/**
 * A customer who is signed in here but never completed `POST /vendors`
 * (e.g. `RegisterVendorUseCase` failed after the account was created — see
 * `RegisterPage`'s own comment) reaches this instead of a KYC status: the
 * same `registerVendor` mutation, offered again as a retry.
 */
export const BecomeVendorPrompt = (): JSX.Element => {
  const [registerVendor, { isLoading, error }] = useRegisterVendorMutation();

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-text">You&apos;re not a vendor yet</h2>
        <p className="mt-1 text-sm text-text-muted">
          Your account exists, but it hasn&apos;t been registered as a vendor. Registering will sign
          you out — you&apos;ll need to sign back in afterward.
        </p>
      </div>
      {error !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(error, 'Your account could not be registered as a vendor.')}
        </Alert>
      )}
      <Button
        type="button"
        loading={isLoading}
        className="self-start"
        onClick={() => void registerVendor()}
      >
        Register as a vendor
      </Button>
    </Card>
  );
};
