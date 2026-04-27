import DOMPurify from 'dompurify';
import { useLayoutEffect, useState } from 'react';

function getDocumentHeight(document: Document) {
  return document.documentElement.scrollHeight;
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
  const sanitizedBody = DOMPurify.sanitize(bodyContent, {
    USE_PROFILES: { html: true },
  });

  useLayoutEffect(() => {
    setHtmlFrameHeight(0);
  }, [sanitizedBody]);

  const htmlDocument = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      html,
      body {
        margin: 8px;
      }

      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    </style>
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
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        className="w-full border-0"
        style={{
          height: htmlFrameHeight,
        }}
        onLoad={(event) => {
          const document = event.currentTarget.contentDocument;
          setHtmlFrameHeight(
            Math.ceil(document ? getDocumentHeight(document) : 0),
          );
        }}
        srcDoc={htmlDocument}
      />
    </div>
  );
}
