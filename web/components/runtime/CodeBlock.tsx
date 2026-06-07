// Airy code block using the LECTURE .code tokens, with an optional language label.
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  return (
    <div className="col" style={{ gap: 8 }}>
      {language ? (
        <span className="kicker" style={{ letterSpacing: "0.2em" }}>
          {language}
        </span>
      ) : null}
      <pre className="code" style={{ margin: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
