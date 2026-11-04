/**
 * Packages locally generated product image variants for a later production import.
 *
 * This script is intentionally local-only: it reads the local PostgreSQL database
 * and mart-backend/uploads/products/, then writes a portable assets directory and manifest.
 * It never uploads files, changes product records, or connects to Supabase.
 *
 * Run:
 *   npm run images:export-local
 *   npm run images:export-local -- --output /absolute/path/to/image-handoff
 */
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '../src/database/db';

type PhotoVariant = {
  thumbnailUrl: string;
  largeUrl: string;
};

type ProductRow = {
  productCode: string;
  name: string;
  photoVariants: unknown;
};

type ExportVariant = {
  index: number;
  thumbnailFile: string;
  largeFile: string;
};

type ExportProduct = {
  productCode: string;
  name: string;
  variants: ExportVariant[];
};

const backendRoot = path.resolve(__dirname, '..');
const uploadsDir = path.join(backendRoot, 'uploads', 'products');
const defaultOutput = path.join(backendRoot, 'artifacts', `product-image-handoff-${new Date().toISOString().replace(/[:.]/g, '-')}`);

function outputDirectory(): string {
  const outputFlag = process.argv.indexOf('--output');
  if (outputFlag === -1) return defaultOutput;
  const requested = process.argv[outputFlag + 1];
  if (!requested || requested.startsWith('-')) throw new Error('Usage: npm run images:export-local -- --output /absolute/path');
  return path.resolve(requested);
}

function localFilename(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/uploads\/products\/([^/]+)$/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function isPhotoVariant(value: unknown): value is PhotoVariant {
  if (!value || typeof value !== 'object') return false;
  const variant = value as Record<string, unknown>;
  return typeof variant.thumbnailUrl === 'string'
    && typeof variant.largeUrl === 'string';
}

async function existingLocalFile(filename: string): Promise<boolean> {
  try {
    const file = await stat(path.join(uploadsDir, filename));
    return file.isFile();
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('This export is local-only and refuses NODE_ENV=production.');
  }

  const destination = outputDirectory();
  const assetsDir = path.join(destination, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const { rows } = await query<ProductRow>(
    `SELECT product_code AS "productCode", name, photo_variants AS "photoVariants"
       FROM mart_products
      WHERE jsonb_array_length(photo_variants) > 0
      ORDER BY product_code`,
  );

  const products: ExportProduct[] = [];
  const copied = new Set<string>();
  let skipped = 0;

  for (const product of rows) {
    const sourceVariants = Array.isArray(product.photoVariants) ? product.photoVariants : [];
    const variants: ExportVariant[] = [];

    for (const [index, rawVariant] of sourceVariants.entries()) {
      if (!isPhotoVariant(rawVariant)) {
        skipped++;
        continue;
      }
      const files = [
        localFilename(rawVariant.thumbnailUrl),
        localFilename(rawVariant.largeUrl),
      ];
      if (files.some((filename): filename is null => filename === null) || !await Promise.all(files.map(filename => existingLocalFile(filename!))).then(results => results.every(Boolean))) {
        skipped++;
        continue;
      }

      const [thumbnailFile, largeFile] = files as [string, string];
      for (const filename of new Set(files)) {
        if (copied.has(filename)) continue;
        await copyFile(path.join(uploadsDir, filename), path.join(assetsDir, filename));
        copied.add(filename);
      }
      variants.push({ index, thumbnailFile, largeFile });
    }

    if (variants.length) products.push({ productCode: product.productCode, name: product.name, variants });
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    purpose: 'Local product-image handoff. Upload assets with these exact filenames, then import this manifest with a production-only reconciliation tool.',
    products,
  };
  await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Exported ${copied.size} image files for ${products.length} products to ${destination}`);
  console.log(`Manifest: ${path.join(destination, 'manifest.json')}`);
  if (skipped) console.warn(`Skipped ${skipped} variant entries because they are legacy URLs or local files are missing.`);
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
