import { theme } from './designSystem.js';

export function Button(label) {
  return `
    <button style="
      background:${theme.primary};
      border:none;
      padding:12px 20px;
      border-radius:10px;
      color:#000;
      font-weight:bold;
      cursor:pointer;
    ">
      ${label}
    </button>
  `;
}

export function Card(content) {
  return `
    <div style="
      background:${theme.glass};
      border:1px solid ${theme.border};
      padding:20px;
      border-radius:16px;
      backdrop-filter:blur(10px);
    ">
      ${content}
    </div>
  `;
}

export default {
  Button,
  Card,
};
