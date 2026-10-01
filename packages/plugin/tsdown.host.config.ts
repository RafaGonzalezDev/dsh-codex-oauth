import { defineConfig } from 'tsdown';
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown';

export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/types.js'], outDir: 'lib', format: 'esm', platform: 'node',
  target: 'es2024', fixedExtension: false, clean: false, dts: false, sourcemap: true,
  // Generate this package through the native Host analysis graph.
  plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
});
