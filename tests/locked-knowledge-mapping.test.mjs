import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
test('locked jurisdiction rules, boundaries and corrections remain live and mapped',async()=>{
 const persona=await readFile(path.join(root,'persona.md'),'utf8'); const principles=await readFile(path.join(root,'principles.md'),'utf8'); const map=await readFile(path.join(root,'skills/jurisdiction-audit/LOCKED-KNOWLEDGE-MAP.md'),'utf8')
 for(const p of [/base/, /不构成合规结论/, /法域未确定/, /三层顺序/, /jurisdiction_pack_version/, /blank/, /unknown/, /Human Gate/]) assert.match(persona+'\n'+principles,p)
 for(const row of ['base 不构成合规结论','法域线索四维','三层加载顺序','CN-only 边界','固定清单与覆盖欠账','O3 隔离']) assert.match(map,new RegExp(row))
})
test('platform-equivalent frontmatter and live instructions encode O3 Lead isolation once',async()=>{
 const text=await readFile(path.join(root,'skills/jurisdiction-audit/SKILL.md'),'utf8'); const match=text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/); assert.ok(match)
 assert.equal((text.match(/^---\s*\nname:/gm)??[]).length,1); const fm=parse(match[1]); assert.equal(fm.metadata.pipeline_stage,'O3'); assert.equal(fm.metadata.upstream,'contract-review-lead'); assert.deepEqual(fm.metadata.downstream,['contract-review-lead'])
 assert.doesNotMatch(match[2],/上游 clause-extractor|review-reporter|失败.*全案.*停止|只允许一个.*引用/)
})
