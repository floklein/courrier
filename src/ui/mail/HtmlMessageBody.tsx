import DOMPurify from 'dompurify';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import darkReaderScript from 'virtual:darkreader-script';
import { useTheme } from '../../theme/ThemeProvider';

const darkReaderTheme = {
  brightness: 100,
  contrast: 100,
  sepia: 0,
};

const darkReaderBootstrap = `
  (() => {
    const darkReader = window.DarkReader;

    if (!darkReader) {
      return;
    }

    darkReader.setFetchMethod(window.fetch.bind(window));
    darkReader.enable(${JSON.stringify(darkReaderTheme)});
  })();
`;

function createFrameBootstrap(frameId: string) {
  return `
  (() => {
    const frameId = ${JSON.stringify(frameId)};

    const postHeight = () => {
      window.parent.postMessage({
        type: 'courrier-mail-frame-height',
        frameId,
        height: Math.ceil(document.documentElement.scrollHeight),
      }, '*');
    };

    const startHeightObserver = () => {
      postHeight();

      const resizeObserver = new ResizeObserver(postHeight);
      resizeObserver.observe(document.documentElement);

      if (document.body) {
        resizeObserver.observe(document.body);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startHeightObserver, { once: true });
    } else {
      startHeightObserver();
    }

    window.addEventListener('load', postHeight);
    window.setTimeout(postHeight, 50);
    window.setTimeout(postHeight, 250);
  })();
`;
}

export function HtmlMessageBody({
  bodyContent,
  isMailDragActive,
  title,
}: {
  bodyContent: string;
  isMailDragActive: boolean;
  title: string;
}) {
  const [htmlFrameHeight, setHtmlFrameHeight] = useState(0);
  const iframeWindowRef = useRef<Window | null>(null);
  const frameId = useId();
  const { resolvedTheme } = useTheme();
  const sanitizedBody = DOMPurify.sanitize(bodyContent, {
    USE_PROFILES: { html: true },
  });

  useLayoutEffect(() => {
    setHtmlFrameHeight(0);
  }, [sanitizedBody]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.source !== iframeWindowRef.current ||
        !event.data ||
        event.data.type !== 'courrier-mail-frame-height' ||
        event.data.frameId !== frameId ||
        typeof event.data.height !== 'number'
      ) {
        return;
      }

      setHtmlFrameHeight(event.data.height);
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [frameId]);

  const frameBootstrap = createFrameBootstrap(frameId);

  const darkReaderTags =
    resolvedTheme === 'dark'
      ? `
    <script>${darkReaderScript}</script>
    <script>${darkReaderBootstrap}</script>`
      : '';

  const htmlDocument = `<!doctype html>
<html data-theme="${resolvedTheme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      html,
      body {
        margin: 8px;
        overflow-x: hidden;
      }

      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color-scheme: ${resolvedTheme};
      }
    </style>
    ${darkReaderTags}
    <script>${frameBootstrap}</script>
  </head>
  <body>
    ${sanitizedBody}
  </body>
</html>`;

  return (
    <div className="relative">
      {isMailDragActive && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10"
        />
      )}
      <iframe
        title={title}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
        className="w-full border-0"
        style={{
          height: htmlFrameHeight,
        }}
        onLoad={(event) => {
          iframeWindowRef.current = event.currentTarget.contentWindow;
        }}
        srcDoc={htmlDocument}
      />
    </div>
  );
}
