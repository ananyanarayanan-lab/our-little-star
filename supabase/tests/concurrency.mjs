// Requires Node and psql. Refuses non-loopback databases; use disposable LOCAL Supabase.
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const container = process.env.LOCAL_SUPABASE_TEST_CONTAINER
const url = process.env.LOCAL_SUPABASE_DB_URL
if (container && container !== 'supabase_db_star-chore-local-test') {
  throw new Error('Container mode is restricted to the disposable star-chore-local-test database.')
}
if (!container && (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))) {
  throw new Error('Set LOCAL_SUPABASE_DB_URL to a disposable local Supabase PostgreSQL URL.')
}
// Connection credentials stay in the environment, not the process argument list.
const env = { ...process.env, ...(url ? { PGDATABASE: url } : {}) }
function query(sql, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const executable = container ? (process.env.DOCKER_EXE || 'docker') : 'psql'
    const args = container
      ? ['--host', 'npipe:////./pipe/dockerDesktopLinuxEngine', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
      : ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    const childProcess = spawn(executable, args, { env, windowsHide: true })
    let out = '', err = ''
    childProcess.stdout.on('data', data => { out += data; onOutput(out) })
    childProcess.stderr.on('data', data => { err += data })
    childProcess.on('error', reject)
    childProcess.on('close', code => resolve({ code, out, err }))
    childProcess.stdin.end(`set statement_timeout='15s'; set lock_timeout='10s'; ${sql}`)
  })
}
async function success(sql) {
  const result = await query(sql)
  assert.equal(result.code, 0, result.err)
  return result.out.trim()
}
const parent = randomUUID(), family = randomUUID(), child = randomUUID()
const mission = randomUUID(), reward = randomUUID()
const login = `set local role authenticated; select set_config('request.jwt.claim.sub','${parent}',true);`

// A completes an operation and holds its child lock. B starts only after A's marker,
// so this tests real contention rather than relying on process scheduling.
async function race(firstSql, secondSql) {
  let ready
  const marker = new Promise(resolve => { ready = resolve })
  const first = query(`begin; ${login} ${firstSql}; select 'LOCK_HELD'; select pg_sleep(2); commit;`, output => {
    if (output.includes('LOCK_HELD')) ready()
  })
  await Promise.race([marker, first.then(result => { if (result.code !== 0) throw new Error(result.err) })])
  const second = query(`begin; ${login} ${secondSql}; commit;`)
  const results = await Promise.all([first, second])
  assert.equal(results[0].code, 0, results[0].err)
  return results[1]
}

try {
  await success(`begin;
    insert into auth.users(id,email) values('${parent}','${parent}@example.invalid');
    insert into public.families(id,name,time_zone,created_by,request_id) values('${family}','Concurrency test','UTC','${parent}',gen_random_uuid());
    insert into public.family_memberships values('${family}','${parent}','owner',now());
    insert into public.children(id,family_id,name) values('${child}','${family}','Test child');
    insert into public.missions(id,family_id,name,stars,frequency) values('${mission}','${family}','Test mission',10,'once_daily');
    insert into public.rewards(id,family_id,name,star_cost) values('${reward}','${family}','Test reward',7);
    commit;`)
  let loser = await race(
    `select public.award_mission('${child}','${mission}','${randomUUID()}')`,
    `select public.award_mission('${child}','${mission}','${randomUUID()}')`)
  assert.notEqual(loser.code, 0)
  assert.match(loser.err, /already completed today/)
  assert.equal(await success(`select count(*) from public.mission_completions where child_id='${child}';`), '1')

  const redeemRequest = randomUUID()
  loser = await race(
    `select public.redeem_reward('${child}','${reward}','${redeemRequest}')`,
    `select public.redeem_reward('${child}','${reward}','${randomUUID()}')`)
  assert.notEqual(loser.code, 0)
  assert.match(loser.err, /Not enough stars/)
  assert.equal(await success(`select balance from public.child_star_balances where child_id='${child}';`), '3')
  assert.equal(await success(`select count(*) from public.reward_redemptions where child_id='${child}';`), '1')
  await success(`begin; ${login} select public.redeem_reward('${child}','${reward}','${redeemRequest}'); commit;`)
  assert.equal(await success(`select count(*) from public.reward_redemptions where child_id='${child}';`), '1')
  const retry = await race(
    `select public.redeem_reward('${child}','${reward}','${redeemRequest}')`,
    `select public.redeem_reward('${child}','${reward}','${redeemRequest}')`)
  assert.equal(retry.code, 0, retry.err)
  assert.equal(await success(`select count(*) from public.reward_redemptions where child_id='${child}';`), '1')
  await success(`update public.missions set frequency='repeatable' where id='${mission}';`)
  const awardRequest = randomUUID()
  const awardRetry = await race(
    `select public.award_mission('${child}','${mission}','${awardRequest}')`,
    `select public.award_mission('${child}','${mission}','${awardRequest}')`)
  assert.equal(awardRetry.code, 0, awardRetry.err)
  assert.equal(await success(`select count(*) from public.mission_completions where child_id='${child}';`), '2')
  assert.equal(await success(`select balance from public.child_star_balances where child_id='${child}';`), '13')
  console.log('PASS: concurrent daily awards, redemption overspend prevention, and concurrent award/redemption retries.')
} finally {
  // Owner-only cleanup of this run's UUID-scoped fixtures, including if assertions fail.
  await success(`begin;
    delete from public.reward_redemptions where family_id='${family}';
    delete from public.mission_completions where family_id='${family}';
    delete from public.children where family_id='${family}';
    delete from public.missions where family_id='${family}';
    delete from public.rewards where family_id='${family}';
    delete from public.family_memberships where family_id='${family}';
    delete from public.families where id='${family}';
    delete from auth.users where id='${parent}'; commit;`)
}
