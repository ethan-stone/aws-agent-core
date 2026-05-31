import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  a({ children, node: _node, ...props }) {
    return (
      <a
        {...props}
        className="text-sky-200 underline decoration-sky-200/35 underline-offset-4 transition-colors hover:text-sky-100"
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  },
  blockquote({ children, node: _node, ...props }) {
    return (
      <blockquote
        {...props}
        className="my-3 border-l border-sky-200/30 pl-3 text-slate-300"
      >
        {children}
      </blockquote>
    );
  },
  code({ children, className, node: _node, ...props }) {
    return (
      <code
        {...props}
        className={`rounded bg-black/30 px-1 py-0.5 font-mono text-[0.92em] text-cyan-100 ${
          className ?? ""
        }`}
      >
        {children}
      </code>
    );
  },
  h1({ children, node: _node, ...props }) {
    return (
      <h1 {...props} className="mb-2 mt-4 text-xl font-semibold text-slate-50">
        {children}
      </h1>
    );
  },
  h2({ children, node: _node, ...props }) {
    return (
      <h2 {...props} className="mb-2 mt-4 text-lg font-semibold text-slate-50">
        {children}
      </h2>
    );
  },
  h3({ children, node: _node, ...props }) {
    return (
      <h3 {...props} className="mb-2 mt-4 text-base font-semibold text-slate-50">
        {children}
      </h3>
    );
  },
  li({ children, node: _node, ...props }) {
    return (
      <li {...props} className="pl-1 leading-6">
        {children}
      </li>
    );
  },
  ol({ children, node: _node, ...props }) {
    return (
      <ol {...props} className="my-3 list-decimal space-y-1 pl-5">
        {children}
      </ol>
    );
  },
  p({ children, node: _node, ...props }) {
    return (
      <p {...props} className="my-2 first:mt-0 last:mb-0 leading-6">
        {children}
      </p>
    );
  },
  pre({ children, node: _node, ...props }) {
    return (
      <pre
        {...props}
        className="my-3 overflow-x-auto rounded-md border border-white/8 bg-black/30 px-3 py-2 text-xs leading-5 text-slate-100"
      >
        {children}
      </pre>
    );
  },
  table({ children, node: _node, ...props }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table
          {...props}
          className="min-w-full border-collapse text-left text-sm text-slate-200"
        >
          {children}
        </table>
      </div>
    );
  },
  td({ children, node: _node, ...props }) {
    return (
      <td {...props} className="border border-white/10 px-3 py-2 align-top">
        {children}
      </td>
    );
  },
  th({ children, node: _node, ...props }) {
    return (
      <th
        {...props}
        className="border border-white/10 bg-white/[0.04] px-3 py-2 align-top font-medium text-slate-100"
      >
        {children}
      </th>
    );
  },
  ul({ children, node: _node, ...props }) {
    return (
      <ul {...props} className="my-3 list-disc space-y-1 pl-5">
        {children}
      </ul>
    );
  },
};

export function MarkdownText(props: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 break-words text-sm leading-6 ${props.className ?? ""}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={markdownComponents}
      >
        {props.children}
      </ReactMarkdown>
    </div>
  );
}
