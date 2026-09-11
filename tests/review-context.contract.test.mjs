// Source-contract test only: it parses Lead's actual template and schema but does not run an Agent.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const here = path.dirname(fileURLToPath(import.meta.url))
const contextDir = process.env.DESIRECORE_REVIEW_CONTEXT_DIR
  ? path.resolve(process.env.DESIRECORE_REVIEW_CONTEXT_DIR)
  : path.resolve(here, '..', '..', 'intake-gate-mapping', 'review-context')
const agentRoot = path.resolve(here, '..')

async function readContextContract() {
  const [templateText, schemaText] = await Promise.all([
    readFile(path.join(contextDir, 'review-context.template.yaml'), 'utf8'),
    readFile(path.join(contextDir, 'review-context.schema.json'), 'utf8'),
  ])
  return { template: YAML.parse(templateText), schema: JSON.parse(schemaText) }
}

test('source-only: parses Lead template and preserves missing-jurisdiction constraints', async () => {
  const { template, schema } = await readContextContract()
  assert.equal(template.jurisdiction.status, 'undetermined')
  assert.equal(template.output_constraints.factual_extraction, 'allowed')
  assert.equal(template.output_constraints.jurisdiction_substantive_conclusion, 'not_issued_missing_jurisdiction')
  assert.equal(schema.definitions.outputConstraints.properties.jurisdiction_substantive_conclusion.enum.includes('not_issued_hg_02_conflict'), true)
  assert.equal(schema.definitions.outputConstraints.properties.jurisdiction_substantive_conclusion.enum.includes('not_issued_rule_source_unavailable'), true)
})

test('source-only: jurisdiction consumer keeps candidate, conflict, and source-failure paths distinct', async () => {
  const [skill, principles, schemaText] = await Promise.all([
    readFile(path.join(agentRoot, 'skills', 'jurisdiction-audit', 'SKILL.md'), 'utf8'),
    readFile(path.join(agentRoot, 'principles.md'), 'utf8'),
    readFile(path.join(contextDir, 'review-context.schema.json'), 'utf8'),
  ])
  for (const field of [
    'review_context_path',
    'review_context_case_id',
    'review_context_revision',
    'review_context_current_manifest',
    'review_context_output_constraints',
    'review_context_echo',
    'actual_output_constraints',
    'REJECT-STALE-REVIEW-CONTEXT',
  ]) assert.ok(skill.includes(field), `missing ${field}`)
  assert.ok(skill.includes('candidate_basis'))
  assert.ok(skill.includes('RULE_SOURCE_UNAVAILABLE'))
  assert.ok(skill.includes('HG-02'))
  assert.ok(principles.includes('不是最终准据法'))
  const schema = JSON.parse(schemaText)
  const candidate = schema.definitions.jurisdiction.oneOf.find(({ properties }) => properties?.status?.const === 'candidate_basis')
  assert.ok(candidate)
  assert.equal(candidate.properties.candidate_basis.$ref, '#/definitions/candidateBasis')
})
