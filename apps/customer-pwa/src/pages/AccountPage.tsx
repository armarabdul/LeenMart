import { Link, useNavigate } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { useLogoutMutation } from '@/features/auth/auth.api';
import { selectCurrentUser, selectRefreshToken } from '@/shared/api/session.slice';

export const AccountPage = (): JSX.Element => {
  const user = useAppSelector(selectCurrentUser);
  const refreshToken = useAppSelector(selectRefreshToken);
  const navigate = useNavigate();
  const [logout, { isLoading }] = useLogoutMutation();

  const handleLogout = async (): Promise<void> => {
    if (refreshToken) {
      await logout({ refreshToken }).catch(() => undefined);
    }
    void navigate('/login', { replace: true });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Your account</h1>
        <p className="text-sm text-slate-600">Signed in as {user?.email}</p>
      </header>

      <Link
        to="/orders"
        className="rounded-md border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        My orders
      </Link>

      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={isLoading}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
      >
        {isLoading ? 'Logging out…' : 'Log out'}
      </button>
    </main>
  );
};
