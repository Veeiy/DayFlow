import { useState } from "react";

export default function LearnSection({ section, onAsk }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ background: "#fff", borderRadius: 24, boxShadow: "0 2px 0px rgba(0,0,0,0.04),0 8px 32px rgba(0,0,0,0.07)", border: "1px solid rgba(255,255,255,0.8)", overflow: "hidden" }}>
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f0efe9", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 13, background: `${section.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{section.emoji}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>{section.title}</div>
      </div>
      {section.lessons.map((lesson, i) => (
        <div key={i} style={{ borderBottom: i < section.lessons.length - 1 ? "1px solid #f8f7f2" : "none" }}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", padding: "14px 20px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontFamily: "inherit", textAlign: "left" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e", lineHeight: 1.4 }}>{lesson.q}</span>
            <span style={{ fontSize: 18, color: section.color, flexShrink: 0, transition: "transform 0.2s", display: "inline-block", transform: open === i ? "rotate(45deg)" : "rotate(0deg)" }}>+</span>
          </button>
          {open === i && (
            <div style={{ padding: "0 20px 16px" }}>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.7, marginBottom: 12 }}>{lesson.a}</div>
              <button onClick={() => onAsk(lesson.q)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: `${section.color}15`, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, color: section.color, cursor: "pointer", fontFamily: "inherit" }}>
                Ask AI Advisor →
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
