import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillPath = path.join(root, 'skills/jurisdiction-audit/SKILL.md')

test('落盘次序排在 J2 之前：先取 id 写骨架，再一次写一个字段或一条观察', async () => {
  const text = await readFile(skillPath, 'utf8')
  const j1 = text.indexOf('### J1 输入闸门')
  const order = text.indexOf('### 落盘次序')
  const j2 = text.indexOf('### J2 识别')
  assert.ok(j1 > 0 && order > j1 && j2 > order, '落盘次序必须位于 J1 与 J2 之间')
  const section = text.slice(order, j2)
  assert.match(section, /下一次回复只做两步：`GenerateUUID`.*随后 `Write` 骨架/)
  assert.match(section, /写骨架之前不识别法域、不读规则条目、不拟观察/)
  assert.match(section, /J2 一次回复只写一个字段/)
  assert.match(section, /`Grep` 的 `literals` 批量检索/)
  assert.match(section, /J4 一次回复只写一条观察/)
  assert.match(section, /按更严的一种记录，写一句 `interpretation_note`，并把该点列为待人工确认/)
  assert.match(section, /被续跑时先回读本次产物/)
})

test('J5 不再重复骨架细则，只引用落盘次序', async () => {
  const text = await readFile(skillPath, 'utf8')
  const j5 = text.slice(text.indexOf('### J5 交付'))
  assert.match(j5, /按上文「落盘次序」逐步写入/)
  assert.doesNotMatch(j5, /立即生成本次唯一的 `jurisdiction_audit_id`/)
})

const replaceFirst = (doc, oldStr, newStr) => {
  const i = doc.indexOf(oldStr)
  assert.ok(i >= 0, `old_string 未命中：${oldStr}`)
  return doc.slice(0, i) + newStr + doc.slice(i + oldStr.length)
}

test('骨架与带键名的逐项 Edit 每个中间态都可解析', () => {
  let doc = [
    'jurisdiction_audit:',
    '  jurisdiction_audit_id: "JUR-test"',
    '  case_id: "C00"',
    '  j1: {verdict: passed}',
    '  jurisdiction: null',
    '  governing_law: null',
    '  venue: null',
    '  rule_pack: null',
    '  findings:',
    '    # <<追加 findings>>',
    '',
  ].join('\n')
  const states = [doc]
  doc = replaceFirst(doc, '  governing_law: null', '  governing_law: {value: "中华人民共和国法律", clause_ref: "16.1"}')
  states.push(doc)
  doc = replaceFirst(doc, '  venue: null', '  venue: {value: "仲裁", clause_ref: "16.2"}')
  states.push(doc)
  doc = replaceFirst(doc, '  jurisdiction: null', '  jurisdiction: cn')
  states.push(doc)
  doc = replaceFirst(doc, '  rule_pack: null', '  rule_pack: {pack_id: jurisdiction-cn, pack_version: cn-v3}')
  states.push(doc)
  doc = replaceFirst(doc, '    # <<追加 findings>>', '    - {finding_id: "JUR-001", status: unknown, interpretation_note: "两种读法取更严"}\n    # <<追加 findings>>')
  states.push(doc)
  for (const [i, s] of states.entries()) assert.doesNotThrow(() => parse(s), `第 ${i} 个中间态不是合法 YAML`)
  const final = parse(doc).jurisdiction_audit
  assert.equal(final.jurisdiction, 'cn')
  assert.equal(final.rule_pack.pack_version, 'cn-v3')
  assert.equal(final.findings.length, 1)
})
