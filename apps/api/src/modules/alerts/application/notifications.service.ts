import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT, toPage } from '../../../common/pagination';
import { PublicHttpException } from '../../../common/public-http.exception';
import { parseCursorOrFail } from '../../../common/query';
import { PrismaService } from '../../../database/prisma.service';
import { toNotificationDto } from '../presentation/alert.contracts';
import type { NotificationDto, NotificationPageDto } from '../presentation/alert.contracts';

const notificationNotFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese aviso.');

/**
 * Bandeja de avisos dentro de la app (P9-01). Del más nuevo al más viejo, por cursor sobre
 * `(createdAt, id)`; solo los del usuario del token. No se envía nada fuera de la app.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: { limit?: number; cursor?: string; unread?: boolean }): Promise<NotificationPageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = parseCursorOrFail(query.cursor);
    const after = cursor ? new Date(cursor.key) : null;
    if (after && Number.isNaN(after.getTime())) {
      throw new PublicHttpException(400, 'VALIDATION_FAILED', 'El cursor de paginación no es válido.', ['cursor']);
    }
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId,
          ...(query.unread ? { readAt: null } : {}),
          ...(after && cursor
            ? { OR: [{ createdAt: { lt: after } }, { createdAt: after, id: { lt: cursor.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const page = toPage(rows, limit, (row) => ({ key: row.createdAt.toISOString(), id: row.id }));
    return { items: page.items.map(toNotificationDto), page: { limit, nextCursor: page.nextCursor }, unreadCount };
  }

  /** Idempotente: marcar dos veces conserva la primera fecha de lectura. */
  async markRead(userId: string, notificationId: string): Promise<NotificationDto> {
    await this.prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: new Date() } });
    const row = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!row) throw notificationNotFound();
    return toNotificationDto(row);
  }
}
