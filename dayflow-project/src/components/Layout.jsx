export const R = ({ children, style }) => (
  <div style={{ display: "flex", alignItems: "center", ...style }}>{children}</div>
);

export const C = ({ children, style }) => (
  <div style={{ display: "flex", flexDirection: "column", ...style }}>{children}</div>
);
