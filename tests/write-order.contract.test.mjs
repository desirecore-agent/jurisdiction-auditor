import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillPath = path.join(root, 'skills/jurisdiction-audit/SKILL.md')
const readSkill = () => readFile(skillPath, 'utf8')
const section = (text, from, to) => {
  const a = text.indexOf(from)
  const b = text.indexOf(to)
  assert.ok(a > 0 && b > a, `${from} 必须位于 ${to} 之前`)
  return text.slice(a, b)
}

test('落盘次序排在 J1 与 J2 之间：先取 id 写骨架，J1 不在骨架前整份读规则包', async () => {
  const text = await readSkill()
  const j1 = section(text, '### J1 输入闸门', '### 落盘次序')
  assert.match(j1, /J1 只读 O1 回执与 O2 工件/)
  assert.match(j1, /跳过步骤 B–H 直接交回执/)
  const order = section(text, '### 落盘次序', '### J2 识别')
  assert.match(order, /下一次回复只做两步：`GenerateUUID`.*随后 `Write` 骨架/)
  assert.match(order, /`clues`、`governing_law`、`venue`、`jurisdiction`、`rule_pack`、`rule_candidates` 各写 `null` 占位/)
  assert.match(order, /写骨架之前不识别法域、不读规则条目、不拟观察/)
  assert.match(order, /同一次回复里先用 `Edit` 写下上一项的结论，再发起下一项的检索/)
})

test('线索与规则候选都由工具检索给出，并有固定落点', async () => {
  const order = section(await readSkill(), '### 落盘次序', '### J2 识别')
  assert.match(order, /`detection_clues:` 行号，按行号只 Read 这一段/)
  assert.match(order, /中文「GDPR、欧盟、香港、澳门、台湾、境外、跨境、出境」/)
  assert.match(order, /英文正文把线索转义后与英文固定词一起用 `\|` 合成正则，以 `is_regex: true`、`ignore_case: true` 检索；中英混排两条都走/)
  assert.match(order, /把 `clues: null` 换成/)
  assert.match(order, /J2 按 `governing_law` → `venue` → `jurisdiction` 的顺序/)
  assert.match(order, /不整份 Read `rules\.yaml`/)
  assert.match(order, /`conflicts:` 段的条目没有 `mandatory` 与 `keywords`，已在步骤 E 处理，不作候选/)
  assert.match(order, /不是劳动合同时先排除 `category: labor`/)
  assert.match(order, /① `mandatory: true` 且关键词命中/)
  assert.match(order, /② `mandatory: true` 但关键词未命中：按文件顺序逐条只问「O2 事实里有没有这条标题所指的条款」，有就入选，本层最多 2 条/)
  assert.match(order, /③ `mandatory: false` 且关键词命中/)
  assert.match(order, /连同步骤 E 的冲突观察凑满 5 条即停/)
  assert.match(order, /把 `rule_candidates: null` 换成选定的 rule id、所在层与入选理由/)
  assert.match(order, /`governed by\|laws of\|courts\? of\|arbitrat/)
  assert.match(order, /`《中华人民共和国\[\^》\]\{1,20\}法》`/)
  assert.match(order, /`context_lines: 0`/)
  assert.match(order, /按行号 Read 该规则那一段/)
})

test('两种读法写 unknown 并待人工确认，不择一也不比较严宽', async () => {
  const text = await readSkill()
  const order = section(text, '### 落盘次序', '### J2 识别')
  assert.match(order, /`status` 写 `unknown`，`interpretation_note` 两种读法各写一句，并写 `needs_human_confirmation: true`，不择一、也不比较哪种更严/)
  assert.doesNotMatch(text, /按更严的一种记录/)
  const principles = await readFile(path.join(root, 'principles.md'), 'utf8')
  assert.match(principles, /冲突无法判定时输出 `unknown` 并进 `HG-02`，\*\*禁止择一默认\*\*/)
})

test('冲突判定先于选规则，非中国法走转介路径', async () => {
  const order = section(await readSkill(), '### 落盘次序', '### J2 识别')
  const conflict = order.indexOf('**步骤 E 冲突判定（先于选规则）**')
  const select = order.indexOf('**步骤 G 选规则**')
  assert.ok(conflict > 0 && select > conflict, '冲突判定必须排在选规则之前')
  assert.match(order, /中国法与 GDPR 等域外数据制度并存/)
  assert.match(order, /`status: unknown`、`human_gate: HG-02`，列出各声明的条款号、页码与冲突性质/)
  assert.match(order, /只写并存这一事实，不对域外法作实体结论/)
  assert.match(order, /`governing_law`、`venue` 有多处声明时写成列表/)
  assert.match(order, /明确域外：`rule_pack` 写 `\{status: out_of_service_scope\}`，`findings` 追加一条专业转介/)
  // 法域待定不是域外：人设要求「法域待确认」+ 阻断 + 数据对齐建议，O5 据此按 DED-D3-JURIS-UNDETERMINED 计分
  assert.match(order, /`jurisdiction` 为 `unknown`.*`rule_pack` 写 `\{status: unknown\}`，`findings` 追加一条 `status: blocked` 的观察，`reason` 写「法域待确认」并附数据对齐建议，不写转介/)
  assert.match(order, /只对 `category` 为 `labor` 或 `data_protection` 的规则走步骤 G、H/)
})

test('续跑与重跑分开，原则与人设的顺序和 id 名与技能一致', async () => {
  const text = await readSkill()
  assert.match(text, /续跑指同一委派被中断后的 `DelegateControl` resume/)
  assert.match(text, /`clues`、`rule_candidates` 已写就以它为准，不重新检索/)
  assert.match(text, /规则包版本、法域判定或上游受理结论变化属于重跑，用新 id 整套重做/)
  const [principles, persona] = await Promise.all(['principles.md', 'persona.md'].map((f) => readFile(path.join(root, f), 'utf8')))
  assert.match(principles, /固定顺序 J1→J5/)
  assert.doesNotMatch(principles + persona, /`audit_id`/)
})

test('J5 不再重复骨架细则，只引用落盘次序', async () => {
  const j5 = (await readSkill()).split('### J5 交付')[1]
  assert.match(j5, /按上文「落盘次序」逐步写入/)
  assert.doesNotMatch(j5, /立即生成本次唯一的 `jurisdiction_audit_id`/)
})

// 2026-10-30 真机：成员把落盘次序「第 5 步」当成 J5，冲突判定后直接虚报交付完成
test('落盘步骤用字母编号、不与 J1–J5 混淆，人设与原则也不用数字步骤号', async () => {
  const text = await readSkill()
  const order = section(text, '### 落盘次序', '### J2 识别')
  assert.match(order, /步骤用字母编号，与 J1–J5 不是一回事：J5 是最后的交付，只在按适用路径做完步骤 A–H 之后进行/)
  const labels = [...order.matchAll(/^- \*\*步骤 ([A-I]) /gm)].map((m) => m[1])
  assert.deepEqual(labels, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
  const [principles, persona] = await Promise.all(['principles.md', 'persona.md'].map((p) => readFile(path.join(root, p), 'utf8')))
  for (const [name, body] of [['SKILL', text], ['principles', principles], ['persona', persona]]) {
    assert.doesNotMatch(body, /第 ?\d+(–\d+)? ?步|第 \d、\d 步/, `${name} 不应再用数字步骤号`)
  }
  // 各步得不出结论时就地写 unknown/blocked/[]，自检之后不再有「改为 unknown」的兜底
  assert.match(order, /现有证据得不出结论的字段直接写 `unknown` 并说明原因，不留 `null`/)
  assert.match(order, /一条都选不出时写 `\[\]` 并说明原因/)
  assert.doesNotMatch(text.split('### J5 交付')[1], /仍无结论的字段改为 `unknown`/)
})

// 骨架键名取自技能步骤 A，自检正则取自 J5；产物带包裹键（两格缩进）或直接顶层都必须命中
const skeletonKeys = (text) => {
  const order = section(text, '### 落盘次序', '### J2 识别')
  const tail = order.slice(order.indexOf('骨架只含对象身份与 J1 结论；'))
  return [...tail.slice(0, tail.indexOf('各写 `null` 占位')).matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
}
const doc = (keys, nullKey, indent) => [
  ...(indent ? ['jurisdiction_audit:'] : []),
  `${indent}jurisdiction_audit_id: "JUR-test"`,
  ...keys.map((k) => `${indent}${k}: ${k === nullKey ? 'null' : '{status: unknown, reason: "示例"}'}`),
  `${indent}findings:`,
  `${indent}  - {finding_id: "JUR-001", status: unknown, rule_ref: {status: null}}`,
  '',
].join('\n')

test('J5 自检对包裹与顶层两种布局都能抓到未写字段，已写或嵌套的 null 不误判', async () => {
  const text = await readSkill()
  const keys = skeletonKeys(text)
  assert.deepEqual(keys, ['clues', 'governing_law', 'venue', 'jurisdiction', 'rule_pack', 'rule_candidates'])
  const j5 = text.split('### J5 交付')[1]
  assert.match(j5, /删锚点之前先自检：用一次 `Grep`/)
  const pattern = j5.match(/`pattern: "([^"]+)"`/)[1]
  assert.ok(!pattern.includes('\\'), '自检正则不带反斜杠，避免写进 JSON 参数时被转义吞掉')
  const re = new RegExp(pattern, 'm')
  for (const indent of ['', '  ']) {
    assert.ok(!re.test(doc(keys, null, indent)), `全部写完时不应命中（缩进 "${indent}"）`)
    for (const k of keys) assert.ok(re.test(doc(keys, k, indent)), `${k} 仍为 null 时必须命中（缩进 "${indent}"）`)
  }
  assert.ok(!re.test('    rule_pack: null'), '四格缩进的嵌套键不是骨架字段')
  assert.match(j5, /回复中声称已写出的产物与回执，都必须是本会话里实际 `Write` 过并 `Read` 回读过的/)
})

test('规则行提取正则与 CN 规则包的真实行格式一致', async (t) => {
  const rulesPath = path.resolve(root, '../contract-review-team/shared/resources/jurisdiction-packs/jurisdiction-cn/rules.yaml')
  let text
  try { text = await readFile(rulesPath, 'utf8') } catch { t.skip('单独检出成员仓库，缺少团队仓库规则包'); return }
  const doc = parse(text)
  const lines = text.split('\n')
  assert.equal(lines.filter((l) => /^ {2}- id: /.test(l)).length, doc.rules.length + doc.conflicts.length)
  assert.equal(lines.filter((l) => /^ {4}mandatory: /.test(l)).length, doc.rules.length)
  assert.equal(lines.filter((l) => /^ {6}keywords: \[.*\]$/.test(l)).length, doc.rules.length)
  for (const c of doc.conflicts) assert.ok(!('mandatory' in c) && !('keywords' in c), `${c.id} 不应带 mandatory/keywords`)
  assert.equal(lines.filter((l) => /^ {2}- id: cn-conflict/.test(l)).length, doc.conflicts.length)
  assert.equal(lines.filter((l) => /^ {4}trigger: /.test(l)).length, doc.conflicts.length)
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
    '  clues: null',
    '  governing_law: null',
    '  venue: null',
    '  jurisdiction: null',
    '  rule_pack: null',
    '  rule_candidates: null',
    '  findings:',
    '    # <<追加 findings>>',
    '',
  ].join('\n')
  const states = [doc]
  const step = (oldStr, newStr) => { doc = replaceFirst(doc, oldStr, newStr); states.push(doc) }
  step('  clues: null', '  clues: {governing_law: [{text: "示例准据法", line: 12}], foreign: []}')
  step('  governing_law: null', '  governing_law: {value: "示例准据法", clause_ref: "9.1"}')
  step('  venue: null', '  venue: {value: "示例争议机构", clause_ref: "9.2"}')
  step('  jurisdiction: null', '  jurisdiction: cn')
  step('  rule_pack: null', '  rule_pack: {pack_id: jurisdiction-cn, pack_version: cn-v3, layers: [base-v1, cn-v3, custom-v1]}')
  step('  rule_candidates: null', '  rule_candidates: {selected: [{id: cn-example-rule, reason: "关键词命中"}], deferred: []}')
  step('    # <<追加 findings>>', '    - {finding_id: "JUR-001", status: unknown, interpretation_note: ["读法一", "读法二"], needs_human_confirmation: true}\n    # <<追加 findings>>')
  for (const [i, s] of states.entries()) assert.doesNotThrow(() => parse(s), `第 ${i} 个中间态不是合法 YAML`)
  const final = parse(doc).jurisdiction_audit
  assert.equal(final.jurisdiction, 'cn')
  assert.equal(final.rule_pack.layers.length, 3)
  assert.equal(final.findings[0].needs_human_confirmation, true)
})

test('步骤 B 无命中与不可检索都有写法，Lead 点名续写的重新委派按续跑处理', async () => {
  const order = section(await readSkill(), '### 落盘次序', '### J2 识别')
  assert.match(order, /无命中的分组写 `\[\]`，部件不可检索（如非 UTF-8 文本）时 `clues` 写 `\{status: blocked, reason: …\}`/)
  assert.match(order, /续跑（含 Lead 点名续写本产物 id 的重新委派）时跳过本步：不再 `GenerateUUID`、不再 `Write` 骨架/)
  assert.match(order, /续跑指同一委派被中断后的 `DelegateControl` resume（含 Lead 因原运行已正常结束无法 resume、改用重新委派并在任务里点名续写本产物 id 的情形）/)
})
