/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_TIMESTAMP__: string;

declare module '*.md?raw' {
  const content: string;
  export default content;
}
