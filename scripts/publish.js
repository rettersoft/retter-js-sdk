// Publishes to npm, but only after a clean build and a green test suite.
// Run with `bun run release` (optionally `bun run release --dry-run`).
//
// Deliberately not named "publish": npm treats that as a lifecycle script that
// fires after `npm publish`, which would make this recurse.
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dir, '..')

function fail(message) {
    console.error(message)
    process.exit(1)
}

function run(command, args) {
    const result = Bun.spawnSync([command, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
    if (result.exitCode !== 0) fail(`\n\`${command} ${args.join(' ')}\` failed — nothing was published.`)
}

function capture(command, args) {
    return Bun.spawnSync([command, ...args], { cwd: root }).stdout.toString().trim()
}

const dryRun = process.argv.includes('--dry-run')
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const tag = `v${version}`

if (capture('git', ['status', '--porcelain'])) fail('Working tree is not clean — commit or stash your changes first.')
if (!capture('git', ['tag', '--list', tag])) fail(`No ${tag} tag found — run \`bun run bump\` first.`)

console.log(`Preparing ${name}@${version}\n`)
run('bun', ['run', 'build'])
run('bun', ['run', 'test'])

for (const artifact of ['dist/index.js', 'dist/index.d.ts', 'bundle/index.js', 'bundle/index.js.LICENSE.txt']) {
    if (!fs.existsSync(path.join(root, artifact))) fail(`Build finished but ${artifact} is missing.`)
}

run('npm', ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : [])])

console.log(dryRun ? `\nDry run complete — ${name}@${version} was not published.` : `\nPublished ${name}@${version}`)
