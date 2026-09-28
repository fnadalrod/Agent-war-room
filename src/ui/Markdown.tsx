import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copy } from "../domain/copy";

type Props = { text: string; onLink: (url: string) => void };

/**
 * Agent Markdown. Embedded HTML is not interpreted; links open in the system browser, never inside
 * the app window.
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
          img: ({ alt }) => <span className="md-img">{copy.markdown.image(alt)}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
