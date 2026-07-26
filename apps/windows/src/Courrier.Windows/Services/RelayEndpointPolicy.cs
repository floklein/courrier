namespace Courrier.Windows.Services;

public static class RelayEndpointPolicy
{
    public static bool IsAllowed(Uri? relayUri, bool allowInsecureLoopbackForDevelopment)
    {
        if (relayUri is null ||
            !string.IsNullOrEmpty(relayUri.UserInfo) ||
            !string.IsNullOrEmpty(relayUri.Query) ||
            !string.IsNullOrEmpty(relayUri.Fragment))
        {
            return false;
        }

        if (relayUri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return allowInsecureLoopbackForDevelopment &&
               relayUri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
               relayUri.IsLoopback;
    }

    public static Uri WebSocketUri(Uri relayUri)
    {
        var builder = new UriBuilder(new Uri(relayUri, "/ws"))
        {
            Scheme = relayUri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                ? "wss"
                : "ws"
        };
        return builder.Uri;
    }
}
