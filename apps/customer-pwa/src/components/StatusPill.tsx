interface StatusPillProps {
  readonly status: 'up' | 'down';
}

export const StatusPill = ({ status }: StatusPillProps): JSX.Element => {
  const isUp = status === 'up';
  return (
    <span
      className={
        isUp
          ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800'
          : 'inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800'
      }
    >
      <span
        aria-hidden="true"
        className={isUp ? 'h-1.5 w-1.5 rounded-full bg-emerald-600' : 'h-1.5 w-1.5 rounded-full bg-red-600'}
      />
      {isUp ? 'Up' : 'Down'}
    </span>
  );
};
