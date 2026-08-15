import { Outlet } from 'react-router-dom';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

/**
 * Wraps the marketplace surface (home/catalogue/search) in the shared
 * header/footer chrome. `/login`, `/register`, and `/account` deliberately
 * stay outside this layout — they already have their own focused,
 * unauthenticated-friendly presentation and must keep working exactly as
 * they do today.
 */
export const AppLayout = (): JSX.Element => (
  <div className="flex min-h-screen flex-col bg-slate-50">
    <Header />
    <div className="flex-1">
      <Outlet />
    </div>
    <Footer />
  </div>
);
