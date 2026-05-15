# Google OAuth and Gmail Setup

Courrier can connect Gmail accounts with Google's installed-app OAuth flow. The
desktop app keeps Google tokens locally and uses Gmail API, People API, and
Gmail watch notifications.

## 1. Create the OAuth client

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable **Gmail API** and **People API**.
4. Configure the OAuth consent screen.
5. Create an OAuth client with application type **Desktop app**.
6. Copy the client ID.

Courrier uses a loopback redirect URI on `127.0.0.1` with a random local port.

## 2. Configure Courrier

Set these values in `apps/desktop/.env`:

```dotenv
GOOGLE_CLIENT_ID=<Google OAuth desktop client ID>
GOOGLE_CLIENT_SECRET=<optional Google OAuth desktop client secret>
```

The secret is optional for installed-app OAuth clients. If your Google client
requires one, set it locally only and do not commit it.

## 3. Configure Gmail live updates

Gmail push notifications require Cloud Pub/Sub:

1. Create a Pub/Sub topic, for example
   `projects/<project>/topics/courrier-gmail`.
2. Grant Gmail publish permission to the topic as described by Google Gmail
   push notification docs.
3. Set the desktop environment variable:

   ```dotenv
   GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/courrier-gmail
   ```

4. Create a Pub/Sub push subscription pointing at:

   ```text
   https://your-relay.example.com/google/pubsub
   ```

5. Optionally set `GOOGLE_PUBSUB_VERIFICATION_TOKEN` on the relay and append
   `?token=<value>` to the push endpoint URL.

Without `GOOGLE_PUBSUB_TOPIC`, Gmail mail actions still work, but live Gmail
updates are disabled.

## 4. Verify

1. Launch Courrier.
2. Choose **Sign in with Google**.
3. Complete consent in the system browser.
4. Verify Gmail labels, messages, search, read/unread, move, trash, send, reply,
   and recipient suggestions.
5. If Pub/Sub is configured, receive a Gmail message and confirm Courrier
   refreshes via the relay.
