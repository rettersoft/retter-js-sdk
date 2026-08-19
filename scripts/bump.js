// Bumps the package version, regenerates src/version.ts, then commits and tags.
// Does not push. Run with `bun run bump [patch|minor|major|X.Y.Z]`.
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dir, '..')
const packageFile = path.join(root, 'package.json')

function fail(message) {
    console.error(message)
    process.exit(1)
}

function run(command, args) {
    const result = Bun.spawnSync([command, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
    if (result.exitCode !== 0) fail(`\`${command} ${args.join(' ')}\` failed`)
}

function capture(command, args) {
    const result = Bun.spawnSync([command, ...args], { cwd: root })
    if (result.exitCode !== 0) fail(`\`${command} ${args.join(' ')}\` failed`)
    return result.stdout.toString().trim()
}

const release = process.argv[2] ?? 'patch'
const source = fs.readFileSync(packageFile, 'utf8')
const current = JSON.parse(source).version

function nextVersion() {
    if (/^\d+\.\d+\.\d+$/.test(release)) return release
    const [major, minor, patch] = current.split('.').map(Number)
    if (release === 'major') return `${major + 1}.0.0`
    if (release === 'minor') return `${major}.${minor + 1}.0`
    if (release === 'patch') return `${major}.${minor}.${patch + 1}`
    return fail(`Unknown release type "${release}" — expected patch, minor, major, or an explicit X.Y.Z`)
}

const version = nextVersion()
const tag = `v${version}`

if (capture('git', ['status', '--porcelain'])) fail('Working tree is not clean — commit or stash your changes first.')
if (capture('git', ['tag', '--list', tag])) fail(`Tag ${tag} already exists.`)

// Rewrite only the version line so the file's formatting is left untouched.
const updated = source.replace(/"version": "[^"]+"/, `"version": "${version}"`)
if (updated === source) fail('Could not find a version field to update in package.json')
fs.writeFileSync(packageFile, updated)

run('bun', ['scripts/gen-version.js'])
run('git', ['add', 'package.json', 'src/version.ts'])
run('git', ['commit', '-m', tag])
run('git', ['tag', tag])

console.log(`\n${current} -> ${version}, committed and tagged as ${tag}`)
console.log(`Next: git push && git push origin ${tag}, then bun run release`)
