export const theme = {
  background: '#0A0A0A',
  primary: 'linear-gradient(135deg, #00FFC6, #7B61FF)',
  glass: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.1)',
  text: '#FFFFFF',
};

export function container(children) {
  return `
    <div style="
      background:${theme.background};
      color:${theme.text};
      padding:20px;
      font-family:Inter, sans-serif;
    ">
      ${children}
    </div>
  `;
}

export default {
  theme,
  container,
};
