import type { Bindings } from './types';

export type NotificationType = 'assignment_created' | 'changes_requested';

export function notificationStatement(
  env: Bindings,
  recipientExternalId: string,
  notificationType: NotificationType,
  message: string,
  targetType: string,
  targetId: string,
) {
  return env.CONTENT_DB.prepare(`
    INSERT INTO editorial_notifications (id, recipient_external_id, notification_type, message, target_type, target_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(`notif_${crypto.randomUUID()}`, recipientExternalId, notificationType, message, targetType, targetId);
}

export async function listNotifications(env: Bindings, userId: string) {
  const [notifications, unread] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT id, notification_type AS notificationType, message, target_type AS targetType,
             target_id AS targetId, read_at AS readAt, created_at AS createdAt
      FROM editorial_notifications WHERE recipient_external_id = ?
      ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT 50
    `).bind(userId).all(),
    env.CONTENT_DB.prepare(`
      SELECT COUNT(*) AS count FROM editorial_notifications WHERE recipient_external_id = ? AND read_at IS NULL
    `).bind(userId).first<{ count: number }>(),
  ]);
  return { notifications: notifications.results, unreadCount: unread?.count ?? 0 };
}

export async function markNotificationRead(env: Bindings, id: string, userId: string) {
  const result = await env.CONTENT_DB.prepare(`
    UPDATE editorial_notifications SET read_at = CURRENT_TIMESTAMP
    WHERE id = ? AND recipient_external_id = ? AND read_at IS NULL
  `).bind(id, userId).run();
  return result.meta.changes > 0;
}

export async function markAllNotificationsRead(env: Bindings, userId: string) {
  const result = await env.CONTENT_DB.prepare(`
    UPDATE editorial_notifications SET read_at = CURRENT_TIMESTAMP
    WHERE recipient_external_id = ? AND read_at IS NULL
  `).bind(userId).run();
  return result.meta.changes;
}
