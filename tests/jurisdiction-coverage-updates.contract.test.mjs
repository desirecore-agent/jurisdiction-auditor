import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import YAML from 'yaml'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = path.resolve(testDirectory, '..')
const fixtureDirectory = path.join(testDirectory, 'fixtures')
const schemaPath = path.join(sourceRoot, 'skills', 'jurisdiction-audit', 'references', 'jurisdiction-coverage-updates.schema.json')
const skillPath = path.join(sourceRoot, 'skills', 'jurisdiction-audit', 'SKILL.md')
const agentPath = path.join(sourceRoot, 'agent.json')

async function readYaml(name) {
  return YAML.parse(await readFile(path.join(fixtureDirectory, name), 'utf8'))
}

async function loadValidator() {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  return new Ajv({ allErrors: true, strict: true }).compile(schema)
}

function updateKey(update) {
  return `${update.rule_id}\u0000${update.section}\u0000${update.check_source}`
}

// This is a source-contract helper, not a production validator. J6.5 requires the
// installed Skill to perform the same dynamic source-set and in-artifact ref checks.
function assertRuntimeCoverageContract(envelope, discovered, collections) {
  const updates = envelope.jurisdiction.coverage_updates
  assert.equal(updates.length, discovered.length, 'one update is required per discovered rule/conflict')
  const actual = new Set()
  for (const update of updates) {
    const key = updateKey(update)
    assert(!actual.has(key), `duplicate coverage update: ${key}`)
    actual.add(key)
    const expected = `${update.section}/${update.rule_id}`
    assert(update.check_source.endsWith(`#${expected}`), `source mismatch: ${update.check_source}`)
    if (update.status === 'blank' && update.evidence_refs.length === 0) {
      assert.match(update.reason, /locked|unknown|unassessed|pending/i, 'blank without evidence needs an explicit unresolved reason')
    } else {
      assert(update.evidence_refs.length > 0, `${update.status} needs evidence`)
    }
    for (const ref of update.evidence_refs) {
      assert(collections[ref.collection]?.has(ref.id), `unresolved evidence ref: ${ref.collection}/${ref.id}`)
    }
  }
  assert.deepEqual(actual, new Set(discovered.map(updateKey)), 'updates must be the exact discovered set')
}

test('coverage updates envelope accepts local legacy fields but closes each update', async () => {
  const validate = await loadValidator()
  const envelope = await readYaml('jurisdiction-coverage-updates-valid.yaml')
  assert.equal(validate(envelope), true, JSON.stringify(validate.errors))
  assert.equal(envelope.jurisdiction.legacy_unchecked_field, 'retained-by-envelope')

  assertRuntimeCoverageContract(envelope, [
    { rule_id: 'cn-rule-a', section: 'rules', check_source: '/team/shared/resources/jurisdiction-packs/jurisdiction-cn/rules.yaml#rules/cn-rule-a' },
    { rule_id: 'cn-conflict-b', section: 'conflicts', check_source: '/team/shared/resources/jurisdiction-packs/jurisdiction-cn/rules.yaml#conflicts/cn-conflict-b' },
  ], {
    compliance_findings: new Set(['JUR-RULE-01']),
    conflict_findings: new Set(),
    governed_by_edges: new Set(['JUR-CLUE-01']),
    coverage_gaps: new Set(),
    human_gates: new Set(),
  })
})

test('schema rejects an unknown update field and a disposition without evidence', async () => {
  const validate = await loadValidator()
  assert.equal(validate(await readYaml('jurisdiction-coverage-updates-invalid-extra-key.yaml')), false)
  assert.equal(validate(await readYaml('jurisdiction-coverage-updates-invalid-disposition.yaml')), false)
})

test('source-contract helper rejects duplicate, foreign, source-mismatched and unjustified blank updates', async () => {
  const envelope = await readYaml('jurisdiction-coverage-updates-valid.yaml')
  const discovered = [
    { rule_id: 'cn-rule-a', section: 'rules', check_source: '/team/shared/resources/jurisdiction-packs/jurisdiction-cn/rules.yaml#rules/cn-rule-a' },
    { rule_id: 'cn-conflict-b', section: 'conflicts', check_source: '/team/shared/resources/jurisdiction-packs/jurisdiction-cn/rules.yaml#conflicts/cn-conflict-b' },
  ]
  const collections = { compliance_findings: new Set(['JUR-RULE-01']) }
  const clone = () => structuredClone(envelope)

  const duplicate = clone()
  duplicate.jurisdiction.coverage_updates[1] = structuredClone(duplicate.jurisdiction.coverage_updates[0])
  assert.throws(() => assertRuntimeCoverageContract(duplicate, discovered, collections), /duplicate|exact discovered/)

  const foreign = clone()
  foreign.jurisdiction.coverage_updates[0].evidence_refs[0].id = 'JUR-NOT-THERE'
  assert.throws(() => assertRuntimeCoverageContract(foreign, discovered, collections), /unresolved evidence/)

  const sourceMismatch = clone()
  sourceMismatch.jurisdiction.coverage_updates[0].check_source = '/team/shared/resources/jurisdiction-packs/jurisdiction-cn/rules.yaml#conflicts/cn-rule-a'
  assert.throws(() => assertRuntimeCoverageContract(sourceMismatch, discovered, collections), /source mismatch/)

  const unjustifiedBlank = clone()
  unjustifiedBlank.jurisdiction.coverage_updates[1].reason = '未触发'
  assert.throws(() => assertRuntimeCoverageContract(unjustifiedBlank, discovered, collections), /explicit unresolved/)
})

test('published agent and skill bind the v1 schema and SFV local-only semantics', async () => {
  const [agent, skill, schema] = await Promise.all([
    readFile(agentPath, 'utf8').then(JSON.parse),
    readFile(skillPath, 'utf8'),
    readFile(schemaPath, 'utf8').then(JSON.parse),
  ])
  assert.equal(agent.version, '1.2.3')
  assert(agent.tool_permissions.allowed.includes('StructuredFileValidate'))
  assert.match(skill, /version: 1\.2\.2/)
  assert.match(skill, /jurisdiction-coverage-updates\.schema\.json/)
  assert.match(skill, /不证明整个 artifact、动态集合\/引用、法律判断或结论锁正确/)
  assert.match(skill, /精确三元组 `\(rule_id, section, check_source\)`/)
  assert.match(skill, /少项、多项或外来项，均不得落盘交接，直接 `HOLD`/)
  assert.match(skill, /同一产物中现有的 `governed_by_edges`、`compliance_findings`、`conflict_findings`、`coverage_gaps` 或 `human_gates` 集合及其 id/)
  assert.match(skill, /只有原因明确是 `locked`、`unknown`、`unassessed` 或 `pending` 的留白，才可 `evidence_refs: \[\]`/)
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#')
  assert.equal(schema.properties.jurisdiction.properties.coverage_updates.maxItems, 8000)
})