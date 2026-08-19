// Builds the standalone browser bundle (bundle/index.js) with bun, plus the
// third-party license file that ships next to it. Run with `bun`, not `node`.
//
// bun strips comments from its output, so the inline license banners webpack
// used to extract cannot be recovered from the bundle. Instead we build once
// with a source map, read back which packages actually made it into the bundle,
// and collect their license texts from node_modules.
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dir, '..')
const entry = path.join(root, 'scripts', 'browser-entry.ts')
const outDir = path.join(root, 'bundle')
const banner = '/*! For license information please see index.js.LICENSE.txt */'

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENSE-MIT', 'COPYING']

function fail(message) {
    console.error(message)
    process.exit(1)
}

async function build(options) {
    const result = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', ...options })
    if (!result.success) fail(result.logs.join('\n'))
    return result
}

// Pass 1: source map only, to discover which packages are in the bundle.
const probe = await build({ sourcemap: 'external' })
const sourcemap = probe.outputs.find(output => output.kind === 'sourcemap')
if (!sourcemap) fail('bun produced no source map, cannot determine bundled packages')

const packages = new Set()
for (const source of JSON.parse(await sourcemap.text()).sources) {
    const index = source.lastIndexOf('node_modules/')
    if (index === -1) continue
    const segments = source.slice(index + 'node_modules/'.length).split('/')
    packages.add(segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0])
}

function licenseFor(name) {
    const dir = path.join(root, 'node_modules', name)
    for (const file of LICENSE_NAMES) {
        const candidate = path.join(dir, file)
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8').trim()
    }
    const { license } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return license ? `Licensed under ${license}. No license file shipped with this package.` : null
}

const sections = []
const missing = []

for (const name of [...packages].sort()) {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
    const text = licenseFor(name)
    if (!text) {
        missing.push(name)
        continue
    }
    sections.push(`${'='.repeat(78)}\n${name}@${version}\n${'='.repeat(78)}\n\n${text}`)
}

if (missing.length) fail(`No license information found for: ${missing.join(', ')}`)

await Bun.write(
    path.join(outDir, 'index.js.LICENSE.txt'),
    `This file lists the licenses of the third-party packages bundled into index.js.\n\n${sections.join('\n\n')}\n`
)

// Pass 2: the shipped bundle.
const bundle = await build({ minify: true, banner })
await Bun.write(path.join(outDir, 'index.js'), bundle.outputs[0])

console.log(`bundle/index.js -> ${(bundle.outputs[0].size / 1024).toFixed(0)} KB, ${packages.size} bundled packages`)
