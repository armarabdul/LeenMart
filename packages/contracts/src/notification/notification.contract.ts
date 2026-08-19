import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * Which inbox the caller is asking for (S6-NOTIFY-INAPP).
 *
 * A vendor owner holds both — they buy as a customer and sell as a vendor on
 * one account — so the kind is a parameter of the request rather than a
 * property of the identity. The vendor portal asks for `VENDOR`, the customer
 * PWA for `CUSTOMER`, and one `/me/notifications` family serves both.
 */
export const notificationRecipientKindSchema = z.enum(['CUSTOMER', 'VENDOR']);

/** SDD 11.2 names four channels; S6-NOTIFY-INAPP ships the one with no external dependency. */
export const notificationChannelSchema = z.enum(['IN_APP']);

/**
 * GET /api/v1/me/notifications.
 *
 * `unreadOnly` is a filter, never a side effect — opening a list does not mark
 * anything read (locked decision). Pagination is the shared cursor schema:
 * default 20, hard ceiling 100 (PERF-08).
 */
export const notificationListQuerySchema = cursorPaginationSchema
  .extend({
    kind: notificationRecipientKindSchema,
    unreadOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

/** GET /api/v1/me/notifications/unread-count and POST .../read-all both scope to one inbox. */
export const notificationInboxQuerySchema = z
  .object({ kind: notificationRecipientKindSchema })
  .strict();

export const notificationParamsSchema = z.object({ id: uuidSchema }).strict();

/**
 * One notification as the client sees it.
 *
 * `title`/`body` are fixed application strings for v1 (FR-59 deferred). The
 * originating `payload` travels too, so a client can deep-link to the order
 * without the server having baked a URL into prose — and so a later templated
 * version can re-render from the facts.
 */
export const notificationResponseSchema = z.object({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  recipientKind: notificationRecipientKindSchema,
  channel: notificationChannelSchema,
  eventType: z.string(),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()),
  /** `null` means unread. Read state is this field and nothing else. */
  readAt: isoDateTimeSchema.nullable(),
});

export const notificationListResponseSchema = z.object({
  items: z.array(notificationResponseSchema),
  /** `null` at the end of the list. */
  nextCursor: z.string().nullable(),
});

export const notificationUnreadCountResponseSchema = z.object({
  unread: z.number().int().min(0),
});

/** `updated: false` means the id named nothing the caller owns, or it was already read. */
export const notificationMarkReadResponseSchema = z.object({ updated: z.boolean() });

/** How many notifications this call actually moved from unread to read. */
export const notificationMarkAllReadResponseSchema = z.object({ updated: z.number().int().min(0) });

export type NotificationRecipientKindDto = z.infer<typeof notificationRecipientKindSchema>;
export type NotificationChannelDto = z.infer<typeof notificationChannelSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationInboxQuery = z.infer<typeof notificationInboxQuerySchema>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
export type NotificationUnreadCountResponse = z.infer<typeof notificationUnreadCountResponseSchema>;
export type NotificationMarkReadResponse = z.infer<typeof notificationMarkReadResponseSchema>;
export type NotificationMarkAllReadResponse = z.infer<typeof notificationMarkAllReadResponseSchema>;
