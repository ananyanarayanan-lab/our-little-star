// Windows Docker Desktop: run against ONLY the disposable local test container.
// psql comes from the Supabase container; no host PostgreSQL install is needed.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const container = 'supabase_db_star-chore-local-test'
const docker = process.env.DOCKER_EXE || 'docker'
const sql = await readFile(new URL('./invariants.sql', import.meta.url), 'utf8')
await new Promise((resolve, reject) => {
  const child = spawn(docker, ['--host', 'npipe:////./pipe/dockerDesktopLinuxEngine',
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null'], { windowsHide: true })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  child.on('error', reject)
  child.on('close', code => {
    try { assert.equal(code, 0, 'SQL invariants failed'); resolve() }
    catch (error) { reject(error) }
  })
  child.stdin.end(sql)
})
process.env.LOCAL_SUPABASE_TEST_CONTAINER = container
await import('./concurrency.mjs')
