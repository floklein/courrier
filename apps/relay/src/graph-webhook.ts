import { randomUUID } from 'node:crypto';
import {
  gmailNotificationDataSchema,
  graphNotificationCollectionSchema,
  googlePubSubPushSchema,
  mailRemoteChangeEventSchema,
  relaySubscriptionRegistrationSchema,
  type MailRemoteChangeEvent,
} from '@courrier/mail-contracts';
import type { FastifyInstance } from 'fastify';
import type { RelayConfig } from './config.js';
import type { RelayStore } from './store.js';
import type { RealtimeHub } from './realtime.js';
import { secureTokenEquals } from './tokens.js';

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

      const changeType = notification.lifecycleEvent ?? notification.changeType;

      if (!changeType) {
        request.log.warn({ notification }, 'Graph notification missing change type');
        continue;
      }

      const eventResult = mailRemoteChangeEventSchema.safeParse({
        id: randomUUID(),
        clientId: subscription.clientId,
        accountId: subscription.accountId,
        providerId: subscription.providerId ?? 'microsoft',
        subscriptionId: notification.subscriptionId,
        kind: notification.lifecycleEvent ? 'lifecycle' : 'message-change',
        changeType,
        resource: notification.resource,
        messageId: notification.lifecycleEvent
          ? undefined
          : (notification.resourceData?.id ?? getMessageIdFromResource(notification.resource)),
        receivedAt: new Date().toISOString(),
      });

      if (!eventResult.success) {
        request.log.warn(
          { error: eventResult.error, notification },
          'Graph notification could not be converted to a relay event',
        );
        continue;
      }

      const event: MailRemoteChangeEvent = eventResult.data;
      await store.appendEvent(event);
      realtime.sendMailChange(event);
    }

    return reply.code(202).send({ ok: true });
  });

  fastify.post('/google/pubsub', async (request, reply) => {
    const verificationToken = getVerificationToken(request.url);

    if (
      config.GOOGLE_PUBSUB_VERIFICATION_TOKEN &&
      verificationToken !== config.GOOGLE_PUBSUB_VERIFICATION_TOKEN
    ) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const result = googlePubSubPushSchema.safeParse(request.body);

    if (!result.success) {
      request.log.warn({ error: result.error }, 'Invalid Google Pub/Sub payload');
      return reply.code(400).send({ error: 'Invalid notification payload' });
    }

    const notificationData = parseGmailNotificationData(result.data.message.data);

    if (!notificationData) {
      request.log.warn({ payload: result.data }, 'Invalid Gmail notification data');
      return reply.code(400).send({ error: 'Invalid Gmail notification data' });
    }

    const subscription = await store.getSubscriptionByAccountEmail(
      notificationData.emailAddress,
    );

    if (!subscription) {
      request.log.warn(
        { emailAddress: notificationData.emailAddress },
        'Gmail notification did not match a registered account',
      );
      return reply.code(202).send({ ok: true });
    }

    const eventResult = mailRemoteChangeEventSchema.safeParse({
      id: randomUUID(),
      clientId: subscription.clientId,
      accountId: subscription.accountId,
      providerId: 'google',
      subscriptionId:
        result.data.message.messageId ??
        result.data.message.message_id ??
        notificationData.historyId,
      kind: 'message-change',
      changeType: 'updated',
      resource: notificationData.emailAddress,
      receivedAt: new Date().toISOString(),
    });

    if (!eventResult.success) {
      request.log.warn(
        { error: eventResult.error, payload: result.data },
        'Gmail notification could not be converted to a relay event',
      );
      return reply.code(202).send({ ok: true });
    }

    const event: MailRemoteChangeEvent = eventResult.data;
    await store.appendEvent(event);
    realtime.sendMailChange(event);

    return reply.code(204).send();
  });
}

function getValidationToken(url: string) {
  const parsedUrl = new URL(url, 'http://relay.local');
  return parsedUrl.searchParams.get('validationToken');
}

function getVerificationToken(url: string) {
  const parsedUrl = new URL(url, 'http://relay.local');
  return parsedUrl.searchParams.get('token');
}

function isAuthorized(authorization: string | undefined, token: string) {
  const prefix = 'Bearer ';

  if (!authorization?.startsWith(prefix)) {
    return false;
  }

  return secureTokenEquals(authorization.slice(prefix.length), token);
}

function getMessageIdFromResource(resource: string | undefined) {
  if (!resource) {
    return undefined;
  }

  const quotedMessageId = /messages\('([^']+)'\)/i.exec(resource)?.[1];

  if (quotedMessageId) {
    return quotedMessageId;
  }

  return /\/messages\/([^/?#]+)/i.exec(resource)?.[1];
}

function parseGmailNotificationData(data: string) {
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf8');
    const result = gmailNotificationDataSchema.safeParse(JSON.parse(decoded));

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
