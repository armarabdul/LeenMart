import { env } from '@/shared/config/env';

export const Footer = (): JSX.Element => (
  <footer className="border-t border-slate-200 bg-white">
    <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500">© {env.appName}</div>
  </footer>
);
