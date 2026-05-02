export function createAuthCallbackTemplate({
  tone,
  title,
  message,
}: {
  tone: 'success' | 'error';
  title: string;
  message: string;
}) {
  const iconPath =
    tone === 'success'
      ? 'M5 13l4 4L19 7'
      : 'M12 8v4m0 4h.01';
  const statusColor = tone === 'success' ? 'var(--primary)' : 'var(--destructive)';
  const statusForeground =
    tone === 'success'
      ? 'var(--primary-foreground)'
      : 'var(--destructive-foreground)';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
        --background: oklch(1 0 0);
        --foreground: oklch(0.145 0 0);
        --card: oklch(1 0 0);
        --card-foreground: oklch(0.145 0 0);
        --primary: oklch(0.205 0 0);
        --primary-foreground: oklch(0.985 0 0);
        --secondary: oklch(0.97 0 0);
        --muted: oklch(0.97 0 0);
        --muted-foreground: oklch(0.556 0 0);
        --destructive: oklch(0.577 0.245 27.325);
        --destructive-foreground: oklch(0.985 0 0);
        --border: oklch(0.922 0 0);
        --ring: oklch(0.708 0 0);
        --radius: 0.5rem;
        --status: ${statusColor};
        --status-foreground: ${statusForeground};
        --status-surface: var(--secondary);
        --shadow: 0 24px 80px oklch(0.145 0 0 / 12%);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --background: oklch(0.145 0 0);
          --foreground: oklch(0.985 0 0);
          --card: oklch(0.205 0 0);
          --card-foreground: oklch(0.985 0 0);
          --primary: oklch(0.922 0 0);
          --primary-foreground: oklch(0.205 0 0);
          --secondary: oklch(0.269 0 0);
          --muted: oklch(0.269 0 0);
          --muted-foreground: oklch(0.708 0 0);
          --destructive: oklch(0.704 0.191 22.216);
          --destructive-foreground: oklch(0.985 0 0);
          --border: oklch(1 0 0 / 10%);
          --ring: oklch(0.556 0 0);
          --shadow: 0 24px 90px oklch(0 0 0 / 45%);
        }
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 32px;
        background: var(--background);
        color: var(--foreground);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
      }

      main {
        width: min(100%, 460px);
        border: 1px solid var(--border);
        border-radius: calc(var(--radius) + 18px);
        padding: 36px;
        background: var(--card);
        box-shadow: var(--shadow);
        text-align: center;
        backdrop-filter: blur(18px);
      }

      .icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 24px;
        display: grid;
        place-items: center;
        border-radius: calc(var(--radius) + 14px);
        background: var(--status-surface);
        color: var(--status);
      }

      svg {
        width: 32px;
        height: 32px;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.75rem, 7vw, 2.35rem);
        line-height: 1.05;
        letter-spacing: 0;
        color: var(--card-foreground);
      }

      p {
        margin: 16px 0 0;
        color: var(--muted-foreground);
        font-size: 1rem;
        line-height: 1.65;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="${iconPath}" />
        </svg>
      </div>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}
