using Windows.Security.Credentials;

namespace Courrier.Windows.Services;

public sealed class SecureTokenStore : ISecureTokenStore
{
    private const string Resource = "Courrier.Windows.Tokens";
    private readonly PasswordVault _vault = new();
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task SaveAsync(string key, string value)
    {
        await _gate.WaitAsync();
        try
        {
            DeleteCore(key);
            _vault.Add(new PasswordCredential(Resource, key, value));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<string?> ReadAsync(string key)
    {
        await _gate.WaitAsync();
        try
        {
            var credential = _vault.Retrieve(Resource, key);
            credential.RetrievePassword();
            return credential.Password;
        }
        catch
        {
            return null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DeleteAsync(string key)
    {
        await _gate.WaitAsync();
        try
        {
            DeleteCore(key);
        }
        finally
        {
            _gate.Release();
        }
    }

    private void DeleteCore(string key)
    {
        try
        {
            _vault.Remove(_vault.Retrieve(Resource, key));
        }
        catch
        {
            // PasswordVault reports missing credentials as an exception.
        }
    }
}
