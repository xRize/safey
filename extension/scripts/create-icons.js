// Create simple placeholder PNG icons
// These are minimal valid PNG files (1x1 transparent pixel)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal 1x1 transparent PNG (base64)
// This is the smallest valid PNG file
const minimalPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const iconSizes = [16, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');
const distIconsDir = path.join(__dirname, '..', 'dist', 'icons');

// Create icons directory if it doesn't exist
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

if (!fs.existsSync(distIconsDir)) {
  fs.mkdirSync(distIconsDir, { recursive: true });
}

// Create icons
iconSizes.forEach(size => {
  const iconPath = path.join(iconsDir, `icon-${size}.png`);
  const distIconPath = path.join(distIconsDir, `icon-${size}.png`);
  
  if (!fs.existsSync(iconPath)) {
    fs.writeFileSync(iconPath, minimalPNG);
    console.log(`Created: icons/icon-${size}.png`);
  }
  
  // Always write to dist (ensure it's not empty)
  fs.writeFileSync(distIconPath, minimalPNG);
});

console.log('✅ Icons created successfully!');
