using System.Text.Json;
using Courrier.Windows.Models;

namespace Courrier.Windows.Services;

public sealed class AccountStore
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public AccountStore()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Courrier");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "accounts.json");
    }

    public async Task<AccountState> ReadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path))
            {
                return new AccountState();
            }

            await using var stream = File.OpenRead(_path);
            return await JsonSerializer.DeserializeAsync<AccountState>(
                stream,
                JsonOptions,
                cancellationToken) ?? new AccountState();
        }
        catch (JsonException)
        {
            return new AccountState();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task WriteAsync(AccountState state, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var temporaryPath = _path + ".tmp";
            await using (var stream = File.Create(temporaryPath))
            {
                await JsonSerializer.SerializeAsync(stream, state, JsonOptions, cancellationToken);
            }

            File.Move(temporaryPath, _path, true);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task UpsertAccountAsync(MailAccount account, CancellationToken cancellationToken = default)
    {
        var state = await ReadAsync(cancellationToken);
        var accounts = state.Accounts
            .Where(candidate => candidate.Id != account.Id)
            .Append(account)
            .OrderBy(candidate => candidate.Email, StringComparer.OrdinalIgnoreCase)
            .ToList();
        await WriteAsync(state with { Accounts = accounts, ActiveAccountId = account.Id }, cancellationToken);
    }

    public async Task RemoveAccountAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var state = await ReadAsync(cancellationToken);
        var accounts = state.Accounts.Where(account => account.Id != accountId).ToList();
        var activeId = state.ActiveAccountId == accountId ? accounts.FirstOrDefault()?.Id : state.ActiveAccountId;
        await WriteAsync(state with { Accounts = accounts, ActiveAccountId = activeId }, cancellationToken);
    }

    public async Task SetActiveAsync(string? accountId, CancellationToken cancellationToken = default)
    {
        var state = await ReadAsync(cancellationToken);
        await WriteAsync(state with { ActiveAccountId = accountId }, cancellationToken);
    }
}

public sealed record AccountState
{
    public List<MailAccount> Accounts { get; init; } = [];
    public string? ActiveAccountId { get; init; }
}

