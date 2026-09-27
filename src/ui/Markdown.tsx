import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = { text: string; onLink: (url: string) => void };

/**
 * Markdown de los agentes. No interpreta HTML incrustado; los enlaces se abren en el navegador del
 * sistema, nunca dentro de la ventana de la app.
 */
export function Markdown({ text, onLink }: Props) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) onLink(href);
              }}
              title={href}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="md-img">[imagen{alt ? `: ${alt}` : ""}]</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
