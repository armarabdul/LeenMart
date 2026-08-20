import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Composes conditional class names and resolves conflicting Tailwind
 * utilities in favour of the last one given — what every shared component's
 * `className` override prop needs to actually override rather than merely
 * append.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
