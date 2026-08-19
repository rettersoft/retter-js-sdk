const fs = require('fs')
const path = require('path')

const { version } = require(path.join(__dirname, '..', 'package.json'))

const content = [
    '// Auto-generated from package.json by scripts/generate-version.js — do not edit manually.',
    '// Regenerated automatically before every `npm run build` (prebuild hook).',
    `export const SDK_VERSION = '${version}'`,
    '',
].join('\n')

fs.writeFileSync(path.join(__dirname, '..', 'src', 'version.ts'), content)
console.log(`generate-version: src/version.ts -> ${version}`)
