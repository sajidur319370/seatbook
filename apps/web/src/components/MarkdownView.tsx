import Markdown from 'react-markdown';

/** `skipHtml` drops raw HTML, and react-markdown blocks unsafe link URLs: a description can't run a script. */
export function MarkdownView({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm [&_a]:text-blue-600 [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        skipHtml
        components={{
          // react-markdown empties an unsafe href (javascript:), so that "link" is plain text.
          a: ({ href, children: text }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {text}
              </a>
            ) : (
              <span>{text}</span>
            ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
