import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';

export default defineConfig({
  define: {
    'BACKEND_URL_INJECTED': JSON.stringify(process.env.BACKEND_URL || 'http://localhost:3005')
  },
  plugins: [
    react(),
    {
      name: 'ensure-icons',
      buildStart() {
        // Create icons directory and icons BEFORE build starts
        if (!existsSync('dist')) {
          mkdirSync('dist', { recursive: true });
        }
        if (!existsSync('dist/icons')) {
          mkdirSync('dist/icons', { recursive: true });
        }
        
        const minimalPNG = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
        
        const iconSizes = [16, 48, 128];
        for (const size of iconSizes) {
          const distIcon = resolve(__dirname, `dist/icons/icon-${size}.png`);
          if (!existsSync(distIcon)) {
            writeFileSync(distIcon, minimalPNG);
          }
        }
      }
    },
    {
      name: 'copy-manifest',
      closeBundle() {
        if (!existsSync('dist')) {
          mkdirSync('dist', { recursive: true });
        }
        
        // Copy manifest
        copyFileSync('manifest.json', 'dist/manifest.json');
        
        // Create icons directory
        if (!existsSync('dist/icons')) {
          mkdirSync('dist/icons', { recursive: true });
        }
        
        // Copy icons from icons/ to dist/icons/ (ALWAYS recreate to ensure they exist)
        const iconSizes = [16, 48, 128];
        const minimalPNG = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
        
        for (const size of iconSizes) {
          const sourceIcon = resolve(__dirname, `icons/icon-${size}.png`);
          const distIcon = resolve(__dirname, `dist/icons/icon-${size}.png`);
          
          // Always write the icon (either from source or create minimal)
          if (existsSync(sourceIcon)) {
            const sourceData = readFileSync(sourceIcon);
            if (sourceData.length > 0) {
              copyFileSync(sourceIcon, distIcon);
            } else {
              writeFileSync(distIcon, minimalPNG);
            }
          } else {
            // Create minimal PNG if source doesn't exist
            writeFileSync(distIcon, minimalPNG);
          }
          
          // Final check - ensure file exists and is not empty
          if (!existsSync(distIcon)) {
            writeFileSync(distIcon, minimalPNG);
          } else {
            const fileData = readFileSync(distIcon);
            if (fileData.length === 0) {
              writeFileSync(distIcon, minimalPNG);
            }
          }
        }
        
        // Move HTML files to root and fix script references
        const popupHtmlSrc = resolve(__dirname, 'dist/src/popup/index.html');
        const optionsHtmlSrc = resolve(__dirname, 'dist/src/options/index.html');
        const popupHtml = resolve(__dirname, 'dist/popup.html');
        const optionsHtml = resolve(__dirname, 'dist/options.html');
        
        // Move and fix popup.html
        if (existsSync(popupHtmlSrc)) {
          let content = readFileSync(popupHtmlSrc, 'utf-8');
          content = content.replace(/src="[^"]*\.tsx?"/g, 'src="./popup.js"');
          content = content.replace(/src="\/popup\.js"/g, 'src="./popup.js"');
          content = content.replace(/href="\/chunks\//g, 'href="./chunks/');
          writeFileSync(popupHtml, content);
        } else if (existsSync(popupHtml)) {
          let content = readFileSync(popupHtml, 'utf-8');
          content = content.replace(/src="\/popup\.js"/g, 'src="./popup.js"');
          content = content.replace(/href="\/chunks\//g, 'href="./chunks/');
          writeFileSync(popupHtml, content);
        }
        
        // Move and fix options.html
        if (existsSync(optionsHtmlSrc)) {
          let content = readFileSync(optionsHtmlSrc, 'utf-8');
          content = content.replace(/src="[^"]*\.tsx?"/g, 'src="./options.js"');
          content = content.replace(/src="\/options\.js"/g, 'src="./options.js"');
          content = content.replace(/href="\/chunks\//g, 'href="./chunks/');
          writeFileSync(optionsHtml, content);
        } else if (existsSync(optionsHtml)) {
          let content = readFileSync(optionsHtml, 'utf-8');
          content = content.replace(/src="\/options\.js"/g, 'src="./options.js"');
          content = content.replace(/href="\/chunks\//g, 'href="./chunks/');
          writeFileSync(optionsHtml, content);
        }
        
        // Clean up src directory
        const srcDir = resolve(__dirname, 'dist/src');
        if (existsSync(srcDir)) {
          rmSync(srcDir, { recursive: true, force: true });
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        contentScript: resolve(__dirname, 'src/contentScript/index.ts'),
        background: resolve(__dirname, 'src/background/index.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // HTML files should be at root with their input name
          if (assetInfo.name && assetInfo.name.endsWith('.html')) {
            const name = assetInfo.name.replace('.html', '');
            return `${name}.html`;
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
    // Use relative paths for extension
    base: './'
  }
});
