# Microsoft OAuth Setup

Courrier reads Outlook mail through Microsoft OAuth and Microsoft Graph. The
application code can start the sign-in flow, but you must create the Microsoft
app registration and provide its client ID locally.

## 1. Create the app registration

1. Open the Microsoft Entra admin center.
2. Go to **Identity** > **Applications** > **App registrations**.
3. Choose **New registration**.
4. Use a clear name, for example `Courrier Local`.
5. Under **Supported account types**, select:
   **Accounts in any organizational directory and personal Microsoft accounts**.
6. Under **Redirect URI**, choose **Public client/native (mobile & desktop)**.
7. Set the redirect URI to:

   ```text
   http://localhost
   ```

8. Register the app.

Do not create a client secret for Courrier. This is a desktop public-client
OAuth flow, so a secret cannot be kept private inside the app.

## 2. Add Graph permissions

In the app registration, open **API permissions** and add delegated Microsoft
Graph permissions:

- `User.Read`
- `Mail.ReadWrite`
- `Mail.Send`

Only delegated permissions are needed for the first version. Do not add
application permissions for mail access.

Some work or school tenants require an administrator to grant consent before
users can sign in. If Microsoft shows an admin-consent error during login, ask
the tenant administrator to approve these delegated permissions.

## 3. Configure Courrier locally

Copy the **Application (client) ID** from the app registration overview and set
it for the app:

```powershell
$env:MICROSOFT_CLIENT_ID = "<Application client ID>"
```

You can also use the checked-in example file:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```dotenv
MICROSOFT_CLIENT_ID=<Application client ID>
```

`.env` is ignored by Git and must not be committed. The app loads this file in
the Electron main process before it creates the Microsoft auth service.

## 4. Verify the flow

1. Launch Courrier.
2. If there is no cached Microsoft session, the onboarding screen should block
   the app.
3. Choose the Microsoft sign-in action.
4. The system browser should open the Microsoft login and consent flow.
5. After a successful login, Courrier should show real Outlook folders.
6. Select a folder and message to verify that real message content loads.
7. Quit and relaunch Courrier. The app should skip onboarding while the cached
   token is still valid.
8. Sign out. Courrier should return to the blocking onboarding screen.

## Common setup failures

- **Missing `MICROSOFT_CLIENT_ID`:** Courrier cannot start OAuth and should show
  a setup error.
- **Wrong account type:** personal Outlook accounts fail if the app registration
  supports only organizational accounts.
- **Missing redirect URI:** Microsoft rejects the callback unless
  `http://localhost` is configured as a public client redirect URI.
- **Missing `Mail.ReadWrite`:** sign-in can succeed, but Graph read/write
  requests fail.
- **Missing `Mail.Send`:** reading mail can work, but sending new messages and
  replies fails.
- **Tenant consent required:** some organizations block user consent until an
  administrator approves the delegated permissions.

## References

- [MSAL Node desktop tutorial](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop)
- [Microsoft Graph mail folders](https://learn.microsoft.com/en-us/graph/api/user-list-mailfolders?view=graph-rest-1.0)
- [Microsoft Graph messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
- [MSAL Node token caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching)
