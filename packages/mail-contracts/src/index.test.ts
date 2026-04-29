import { describe, expect, it } from 'vitest';
import {
  graphNotificationCollectionSchema,
  relayClientMessageSchema,
} from './index';

describe('mail contract schemas', () => {
  it('accepts Graph notification collections with extra Graph metadata', () => {
    const result = graphNotificationCollectionSchema.safeParse({
      value: [
        {
          subscriptionId: 'subscription-1',
          clientState: 'client-state',
          changeType: 'created',
          resource: "Users('user')/messages('message-1')",
          resourceData: {
            id: 'message-1',
            '@odata.type': '#Microsoft.Graph.Message',
          },
        },
      ],
      validationTokens: ['token'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects malformed relay client messages', () => {
    const result = relayClientMessageSchema.safeParse({
      type: 'register',
      clientId: '',
      token: 'token',
    });

    expect(result.success).toBe(false);
  });
});
