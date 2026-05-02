import type {
  MailRemoteChangeEvent,
  RelaySubscriptionRegistration,
} from '@courrier/mail-contracts';

export type RelaySubscription = RelaySubscriptionRegistration;

export interface RelayStore {
  upsertSubscription(subscription: RelaySubscription): Promise<void>;
  getSubscriptionByClientState(
    clientState: string,
  ): Promise<RelaySubscription | undefined>;
  getSubscriptionByClientId(clientId: string): Promise<RelaySubscription | undefined>;
  appendEvent(event: MailRemoteChangeEvent): Promise<void>;
  listEventsAfter(clientId: string, eventId?: string): Promise<MailRemoteChangeEvent[]>;
  acknowledgeEvent(clientId: string, eventId: string): Promise<void>;
}

export class InMemoryRelayStore implements RelayStore {
  private readonly subscriptionsByClientId = new Map<string, RelaySubscription>();
  private readonly eventsByClientId = new Map<string, MailRemoteChangeEvent[]>();
  private readonly acknowledgedEventByClientId = new Map<string, string>();

  async upsertSubscription(subscription: RelaySubscription): Promise<void> {
    this.subscriptionsByClientId.set(subscription.clientId, subscription);
  }

  async getSubscriptionByClientState(clientState: string) {
    return [...this.subscriptionsByClientId.values()].find(
      (subscription) => subscription.clientState === clientState,
    );
  }

  async getSubscriptionByClientId(clientId: string) {
    return this.subscriptionsByClientId.get(clientId);
  }

  async appendEvent(event: MailRemoteChangeEvent): Promise<void> {
    const events = this.eventsByClientId.get(event.clientId) ?? [];
    events.push(event);
    this.eventsByClientId.set(event.clientId, events.slice(-100));
  }

  async listEventsAfter(clientId: string, eventId?: string) {
    const events = this.eventsByClientId.get(clientId) ?? [];
    const cursor = eventId ?? this.acknowledgedEventByClientId.get(clientId);

    if (!cursor) {
      return events;
    }

    const cursorIndex = events.findIndex((event) => event.id === cursor);
    return cursorIndex === -1 ? events : events.slice(cursorIndex + 1);
  }

  async acknowledgeEvent(clientId: string, eventId: string): Promise<void> {
    const events = this.eventsByClientId.get(clientId) ?? [];
    const eventIndex = events.findIndex((event) => event.id === eventId);

    if (eventIndex === -1) {
      return;
    }

    this.eventsByClientId.set(clientId, events.slice(eventIndex + 1));
    this.acknowledgedEventByClientId.set(clientId, eventId);
  }
}
