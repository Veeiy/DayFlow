// Inline markdown: bold, italic, links
export const renderInline = (text) => {
  if (!text) return null;
  const parts = []; let remaining = text; let key = 0;
  while (remaining.length > 0) {
    const bold   = remaining.match(/\*\*(.+?)\*\*/);
    const italic = remaining.match(/\*([^*]+)\*/);
    const link   = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    const matches = [bold, italic, link].filter(Boolean);
    if (matches.length === 0) { parts.push(<span key={key++}>{remaining}</span>); break; }
    const first = matches.sort((a, b) => a.index - b.index)[0];
    if (first.index > 0) parts.push(<span key={key++}>{remaining.slice(0, first.index)}</span>);
    if (first === bold) {
      parts.push(<strong key={key++} style={{ fontWeight: 700 }}>{bold[1]}</strong>);
      remaining = remaining.slice(first.index + bold[0].length);
    } else if (first === italic) {
      parts.push(<em key={key++}>{italic[1]}</em>);
      remaining = remaining.slice(first.index + italic[0].length);
    } else if (first === link) {
      parts.push(<a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#7048e8", fontWeight: 600, textDecoration: "underline" }}>{link[1]}</a>);
      remaining = remaining.slice(first.index + link[0].length);
    }
  }
  return <>{parts}</>;
};

export const renderMd = (text) => {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      elements.push(<div key={i} style={{ fontSize: 15, fontWeight: 800, color: "#1a1a2e", marginTop: 14, marginBottom: 4 }}>{renderInline(line.slice(3))}</div>);
    } else if (line.startsWith("### ")) {
      elements.push(<div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", marginTop: 10, marginBottom: 2 }}>{renderInline(line.slice(4))}</div>);
    } else if (line.startsWith("# ")) {
      elements.push(<div key={i} style={{ fontSize: 17, fontWeight: 800, color: "#1a1a2e", marginTop: 16, marginBottom: 6 }}>{renderInline(line.slice(2))}</div>);
    } else if (line.trim() === "---" || line.trim() === "***") {
      elements.push(<div key={i} style={{ height: 1, background: "#ece9e0", margin: "10px 0" }}/>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "flex-start" }}>
          <span style={{ color: "#7048e8", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>·</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)[1];
      elements.push(
        <div key={i} style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "flex-start" }}>
          <span style={{ color: "#7048e8", fontWeight: 700, flexShrink: 0, minWidth: 16, marginTop: 1 }}>{num}.</span>
          <span>{renderInline(line.slice(num.length + 2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 6 }}/>);
    } else {
      elements.push(<div key={i} style={{ marginTop: 2 }}>{renderInline(line)}</div>);
    }
    i++;
  }
  return <>{elements}</>;
};
