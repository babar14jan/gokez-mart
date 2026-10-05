import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const origin = 'https://mart.gokez.com';
const source = readFileSync(join(dist, 'index.html'), 'utf8');

const pages = [
  {
    path: '/about',
    title: 'About Gokez Mart | Shop Local. Support Local.',
    description: 'About Gokez Mart, an online marketplace for ordering everyday essentials from nearby stores.',
    heading: 'About Gokez Mart',
    content: 'Gokez Mart is an online marketplace for ordering everyday essentials from nearby stores.',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy | Gokez Mart',
    description: 'How Gokez Mart collects, uses and protects your personal data when you shop with local stores.',
    heading: 'Privacy Policy',
    content: 'Read how Gokez Mart collects, uses and protects personal data for local shopping and delivery.',
  },
  {
    path: '/terms',
    title: 'Terms of Service | Gokez Mart',
    description: 'The terms that apply when you use Gokez Mart, the platform operated by Gokez Technologies that connects you with local stores.',
    heading: 'Terms of Service',
    content: 'Read the terms that apply when you use Gokez Mart for local shopping and delivery.',
  },
  {
    path: '/grievance',
    title: 'Grievance Redressal | Gokez Mart',
    description: 'Raise a grievance with Gokez Mart about an order, delivery or store, and track the response from the company that operates the platform.',
    heading: 'Grievance Redressal',
    content: 'Raise a grievance with Gokez Mart about an order, delivery, or store.',
  },
  {
    path: '/feedback',
    title: 'Feedback | Gokez Mart',
    description: 'Tell Gokez Mart about your shopping or delivery experience, so the platform connecting you with local stores can be improved.',
    heading: 'Feedback',
    content: 'Share feedback about your Gokez Mart shopping or delivery experience.',
  },
];

const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

for (const page of pages) {
  const url = `${origin}${page.path}`;
  const document = source
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(" \/>)/, `$1${escapeHtml(page.description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(" \/>)/, `$1${escapeHtml(page.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(" \/>)/, `$1${escapeHtml(page.description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(" \/>)/, `$1${url}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(" \/>)/, `$1${escapeHtml(page.title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(" \/>)/, `$1${escapeHtml(page.description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(" \/>)/, `$1${url}$2`)
    .replace(/<div class="seo-static" id="seo-static">[\s\S]*?<\/div>\n    <div id="root">/, `<div class="seo-static" id="seo-static">\n      <h1>${escapeHtml(page.heading)}</h1>\n      <p>${escapeHtml(page.content)}</p>\n      <p><a href="/">Gokez Mart</a> is a product of <a href="https://gokez.com/">Gokez Technologies</a>.</p>\n    </div>\n    <div id="root">`);

  const jsonLdMatch = document.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!jsonLdMatch) throw new Error(`JSON-LD block is missing from ${page.path}`);
  const graph = JSON.parse(jsonLdMatch[1]);
  const webPage = graph['@graph'].find(node => node['@type'] === 'WebPage');
  if (!webPage) throw new Error(`WebPage node is missing from ${page.path}`);
  webPage['@id'] = `${url}#webpage`;
  webPage.name = page.title;
  webPage.url = url;
  webPage.description = page.description;
  const updatedJsonLd = `<script type="application/ld+json">\n    ${JSON.stringify(graph, null, 2)}\n    </script>`;
  const withRouteGraph = document.replace(jsonLdMatch[0], updatedJsonLd);

  const output = join(dist, page.path.slice(1), 'index.html');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, withRouteGraph);
}