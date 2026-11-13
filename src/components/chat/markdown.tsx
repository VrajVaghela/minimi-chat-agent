import ReactMarkdown, { defaultUrlTransform } from "react-markdown";

export function Markdown({
  text,
  onCite,
}: {
  text: string;
  onCite: (n: number) => void;
}) {
  const withCites = text.replace(/\[(\d+)\]/g, "[$1](#cite-$1)");
  return (
    <div className="since-md text-[1.02rem] leading-7">
      <ReactMarkdown
        urlTransform={(url) => (url.startsWith("#") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) {
              const n = Number(href.slice("#cite-".length));
              return (
                <button type="button" className="cite" onClick={() => onCite(n)}>
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withCites}
      </ReactMarkdown>
    </div>
  );
}
