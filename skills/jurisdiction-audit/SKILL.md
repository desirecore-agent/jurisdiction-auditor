---
name: jurisdiction-audit
description: >-
  有界法域审计：读取上游条款事实和一组匹配规则，在单个成员回合内产出法域识别、适用性、缺口和证据回执。
  只做法域与规则适用性观察，不做最终法律意见；超时或输入不完整就 blocked。
version: 1.4.0
type: procedural
risk_level: low
status: enabled
tags: [contract-review, jurisdiction, bounded-loop, receipt-audit]
requires:
  tools: [Read, Ls, Glob, Grep, Write, Edit, GenerateUUID]
metadata:
  author: DesireCore
  updated_at: '2026-10-30'
  pipeline_stage: O3
  upstream: contract-review-lead
  downstream: [contract-review-lead]
---

# 有界法域审计

## 目标与边界

你是合同审查流水线的法域成员。输入是 Lead 传来的案件对象、正文/附件路径、O2 条款事实和 `canonical_artifact_root`。只回答：

1. 合同明确或可引用地指向哪个法域/准据法/争议解决地；
2. 规则包是否与该法域匹配；
3. 最多 5 个与已抽取条款直接相关的适用性观察或缺口。

你不做最终风险评级、合同是否合规、版本对比、修订建议，也不读取 risk-scanner 的结论。

## 单回合协议（J1→J5）

### J1 输入闸门

只接受 Lead 转交的有效 O1 回执、O2 工件与冻结来源，并按有界批次回源。J1 只读 O1 回执与 O2 工件；规则包留到下文对应步骤按需检索，不在骨架前整份 Read。若 verdict 非 `passed|conditional`，本支 blocked：骨架照写，各字段写 `blocked` 并说明原因，跳过第 2–6 步直接交回执。对象摘要不一致或单一路径不可读时记录对应 `blocked/capability_debt`，但一个局部失败不得自动阻断其他可核验事实。

### 落盘次序（先于 J2–J4）

按下列次序推进，不要先在思考里把法域识别、规则核对和全部观察规划完再动手。「一次回复只处理一项」指：同一次回复里先用 `Edit` 写下上一项的结论，再发起下一项的检索。

1. J1 结束（含 blocked）后的下一次回复只做两步：`GenerateUUID` 取本次 `jurisdiction_audit_id`（续跑沿用会话里已有的 id，新委派一律用新 id，不读、不改其他 id 的产物），随后 `Write` 骨架到 `<canonical_artifact_root>/jurisdiction-audit/<jurisdiction_audit_id>.yaml`。骨架只含对象身份与 J1 结论；`clues`、`governing_law`、`venue`、`jurisdiction`、`rule_pack`、`rule_candidates` 各写 `null` 占位；`findings` 段下一行留锚点注释 `# <<追加 findings>>`。骨架不含任何判读：写骨架之前不识别法域、不读规则条目、不拟观察。
2. 线索交给工具：用 `Grep` 定位 `jurisdiction-cn/pack.yaml` 与 `jurisdiction-us/pack.yaml` 的 `detection_clues:` 行号，按行号只 Read 这一段；再加固定的域外词「GDPR、欧盟、香港、澳门、台湾、境外、跨境、出境」，对原件检索：中文正文用 `literals`（每批不超过 64 项），英文正文把线索转义后用 `|` 合成正则，以 `is_regex: true`、`ignore_case: true` 检索。检索完用一次 `Edit` 把 `clues: null` 换成按准据法、争议机构、数据制度、当事方住所、援引法律、域外词分组的命中词与行号。
3. J2 按 `governing_law` → `venue` → `jurisdiction` 的顺序，一次回复写一个字段：据 `clues` 与 `Grep` 回源取证，再用 `Edit` 改写该字段（`old_string` 带键名，如 `venue: null`）。
4. J3 按行号 Read 匹配包 `pack.yaml` 的版本元数据，用一次 `Edit` 写 `rule_pack`：`{pack_id, pack_version, layers: [base 层版本, 法域层版本, custom 层版本]}`。
5. 选规则：用一次 `Grep`（`pattern: "^  - id: |^    title: |^    category: |^    mandatory: |^      keywords: "`，`is_regex: true`，`path` 为匹配包的 `rules.yaml`）取出各规则的标题、类别、强制性与关键词，不整份 Read `rules.yaml`；`conflicts:` 段的条目没有 `mandatory` 与 `keywords`，是冲突判定，不作候选。再用 `literals` 查各规则关键词在原件中的命中。结合命中与 O2 条款事实选最多 5 条规则：`mandatory: true` 优先；不是劳动合同时不选 `category: labor`；关键词没命中但 O2 已抽取到对应条款的规则也可入选。选取只看标题、类别、命中和 O2 条款，不读规则正文、不推演结论。选定后用一次 `Edit` 把 `rule_candidates: null` 换成选定的 rule id 与入选理由（关键词命中或对应的 O2 条款），未入选的命中规则另列为 `deferred`。
6. J4 一次回复只写一条观察：按行号 Read 该规则那一段（`statement`、`legal_basis`、`verdict_rules`），回源、对照、判定，再用 `Edit` 把锚点替换成该条记录加原锚点（`old_string` 取锚点整行，含行首缩进）。不在思考里先拟定全部观察。规则条件与事实之间有两种读法时，`status` 写 `unknown`，`interpretation_note` 两种读法各写一句，并写 `needs_human_confirmation: true`，不择一、也不比较哪种更严。
7. `new_string` 每行写完整缩进，写完核对 diff 落在目标段。不攒到最后一次写整份产物，也不在思考里重审已写入的条目。
8. 续跑指同一委派被中断后的 `DelegateControl` resume：先回读本次产物，`clues`、`rule_candidates` 已写就以它为准，不重新检索；其余从仍为 `null` 或未写入的下一项接着做。规则包版本、法域判定或上游受理结论变化属于重跑，用新 id 整套重做。

### J2 识别

从标题、适用法律、管辖、争议解决和明确的实体法名称中识别 `jurisdiction`、`governing_law`、`venue`，依据是第 2 步写入的 `clues` 与回源原文。没有充分证据时使用 `unknown`，不得猜测。

### J3 规则包

只读取一个匹配的 `jurisdiction-packs/<slug>/pack.yaml` 的版本元数据与 `detection_clues` 段，规则正文按第 5、6 步从 `rules.yaml` 按需取；若没有匹配包或日期不在包的有效区间，状态为 `unknown` 或 `blocked`，说明原因。不要遍历整个资源树，不要重复读取同一文件。

### J4 有界观察

最多 5 条记录，每条必须包含：`finding_id`、`status`（`covered`/`unknown`/`not_applicable`/`blocked`）、`clause_ref`、`evidence_quote`、`location`、`rule_ref`、`reason`；两种读法并存时另写 `interpretation_note` 与 `needs_human_confirmation: true`。只能引用 Read/Grep 实际看到的原文；没有证据就 `unknown`。

### J5 交付

`canonical_artifact_root` 是 Lead 已核验的本次 case/object/version/run 绝对根，不再拼接 case_id 或对象身份；缺根或未授权时返回路径欠账。产物按上文「落盘次序」逐步写入 `<canonical_artifact_root>/jurisdiction-audit/<jurisdiction_audit_id>.yaml`。交付前可用一次 `Grep` 的 `literals` 批量回查全部引文。全部完成后删去锚点、把空段改成 `[]`、仍无结论的字段改为 `unknown` 并说明原因，再写 `<canonical_artifact_root>/jurisdiction-audit/<jurisdiction_audit_id>.receipt.yaml`，两份文件都完整 Read 回读。回执必须包含：

- `case_id`、`object`、`input_digest`、`status`；
- `jurisdiction`、`governing_law`、`venue`；
- `findings_count`、`unknown_count`、`blocked_reason`（无则 `null`）；
- `artifact_path`、`evidence_refs`、`read_back: passed`。

完成标准是产物和回执都真实存在、能回读、对象身份一致、所有 `covered` 条目都有证据。只向 Lead 返回绝对路径、统计与欠账；不向 reporter 直送，也不读风险支路。一次委派内无法完成的行分别写 `deferred`、`blocked` 或 `capability_debt`，不等待、不自己补写最终结论，也不要求所有业务动作成功。

---
