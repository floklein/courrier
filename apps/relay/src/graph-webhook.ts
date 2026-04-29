import { randomUUID } from 'node:crypto';
import {
  graphNotificationCollectionSchema,
  type MailRemoteChangeEvent,
} from '@courrier/mail-contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RelayConfig } from './config.js';
import type { RelayStore } from './store.js';
import type { RealtimeHub } from './realtime.js';

const relaySubscriptionRegistrationSchema = z.object({
  clientId: z.string().min(1),
  clientState: z.string().min(24),
  authToken: z.string().min(24),
  subscriptionId: z.string().optional(),
  expirationDateTime: z.string().optional(),
});

export function registerGraphWebhookRoutes({
  config,
  fastify,
  realtime,
  store,
}: {
  config: RelayConfig;
  fastify: FastifyInstance;
  realtime: RealtimeHub;
  store: RelayStore;
}) {
  fastify.post('/relay/subscriptions', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, config.RELAY_ADMIN_TOKEN)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const result = relaySubscriptionRegistrationSchema.safeParse(request.body);

    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid subscription registration' });
    }

    await store.upsertSubscription(result.data);
    return reply.code(201).send({ ok: true });
  });

  fastify.post('/graph/notifications', async (request, reply) => {
    const validationToken = getValidationToken(request.url);

    if (validationToken) {
      return reply
        .code(200)
        .type('text/plain')
        .send(decodeURIComponent(validationToken));
    }

    const result = graphNotificationCollectionSchema.safeParse(request.body);

    if (!result.success) {
      request.log.warn({ error: result.error }, 'Invalid Graph notification payload');
      return reply.code(400).send({ error: 'Invalid notification payload' });
    }

    for (const notification of result.data.value) {
      if (!notification.clientState) {
        request.log.warn({ notification }, 'Graph notification missing client state');
        continue;
      }

      const subscription = await store.getSubscriptionByClientState(
        notification.clientState,
      );

      if (!subscription) {
        request.log.warn(
          { clientState: notification.clientState },
          'Graph notification did not match a registered client state',
        );
        continue;
      }

      const changeType =
        notification.lifecycleEvent === 'missed'
          ? 'missed'
          : notification.changeType;

      if (!changeType) {
        continue;
      }

      const event: MailRemoteChangeEvent = {
        id: randomUUID(),
        clientId: subscription.clientId,
        subscriptionId: notification.subscriptionId,
        changeType,
        resource: notification.resource,
        messageId: notification.resourceData?.id,
        receivedAt: new Date().toISOString(),
      };

      await store.appendEvent(event);
      realtime.sendMailChange(event);
    }

    return reply.code(202).send({ ok: true });
  });
}

function getValidationToken(url: string) {
  const parsedUrl = new URL(url, 'http://relay.local');
  return parsedUrl.searchParams.get('validationToken');
}

function isAuthorized(authorization: string | undefined, token: string) {
  return authorization === `Bearer ${token}`;
}
