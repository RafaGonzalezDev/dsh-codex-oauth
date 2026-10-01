import { defineConfig } from 'tsdown';

/** The native lazy-CJS factory contract, without a dependency on repository build scripts. */
export default defineConfig({
  entry: ['src/client/index.ts'], outDir: 'lib', format: 'cjs', platform: 'browser',
  target: 'es2024', clean: false, dts: false, sourcemap: true,
  deps: { neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots'], alwaysBundle: ['zod', 'dsh-chatgpt-plan/remote'], onlyBundle: ['zod'] },
  codeSplitting: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({id: "dsh-chatgpt-plan", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; }});',
  },
});
