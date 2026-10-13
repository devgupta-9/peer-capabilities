import { readFileSync } from 'node:fs';

// dist/ and src/ share the same package root, including npm-installed artifacts.
export const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
