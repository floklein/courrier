import { z } from 'zod';

export const graphChangeTypeSchema = z.enum(['created', 'updated', 'deleted']);
export const graphLifecycleEventSchema = z.enum([
  'missed',
  'reauthorizationRequired',
  'subscriptionRemoved',
]);

export const graphResourceDataSchema = z
  .object({
    id: z.string().optional(),
    '@odata.id': z.string().optional(),
    '@odata.type': z.string().optional(),
    '@odata.etag': z.string().optional(),
  })
  .passthrough();

export const graphChangeNotificationSchema = z
  .object({
    subscriptionId: z.string(),
    subscriptionExpirationDateTime: z.string().optional(),
    clientState: z.string().optional(),
    changeType: graphChangeTypeSchema.optional(),
    resource: z.string().optional(),
    tenantId: z.string().optional(),
    resourceData: graphResourceDataSchema.optional(),
    lifecycleEvent: graphLifecycleEventSchema.optional(),
  })
  .passthrough();

export const graphNotificationCollectionSchema = z
  .object({
    value: z.array(graphChangeNotificationSchema),
    validationTokens: z.array(z.string()).optional(),
  })
  .passthrough();

export const relayClientRegistrationSchema = z.object({
  type: z.literal('register'),
  clientId: z.string().min(1),
  token: z.string().min(1),
  lastEventId: z.string().optional(),
});

export const relayClientAckSchema = z.object({
  type: z.literal('ack'),
  eventId: z.string().min(1),
});

export const relayClientMessageSchema = z.discriminatedUnion('type', [
  relayClientRegistrationSchema,
  relayClientAckSchema,
]);

export const mailRemoteChangeEventSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  subscriptionId: z.string().min(1),
  changeType: graphChangeTypeSchema.or(z.literal('missed')),
  resource: z.string().optional(),
  messageId: z.string().optional(),
  receivedAt: z.string().datetime(),
});

export const relayServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    clientId: z.string().min(1),
  }),
  z.object({
    type: z.literal('mail-change'),
    event: mailRemoteChangeEventSchema,
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().min(1),
  }),
]);

export type GraphChangeType = z.infer<typeof graphChangeTypeSchema>;
export type GraphLifecycleEvent = z.infer<typeof graphLifecycleEventSchema>;
export type GraphChangeNotification = z.infer<
  typeof graphChangeNotificationSchema
>;
export type GraphNotificationCollection = z.infer<
  typeof graphNotificationCollectionSchema
>;
export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;
export type RelayClientRegistration = z.infer<
  typeof relayClientRegistrationSchema
>;
export type RelayClientAck = z.infer<typeof relayClientAckSchema>;
export type MailRemoteChangeEvent = z.infer<typeof mailRemoteChangeEventSchema>;
export type RelayServerMessage = z.infer<typeof relayServerMessageSchema>;
