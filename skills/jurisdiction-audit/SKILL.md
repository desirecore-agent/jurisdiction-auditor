---
name: jurisdiction-audit
description: >-
  合同法域合规审计。按 custom > jurisdiction > base 三层知识结构，以固定顺序 J1→J8 完成
  法域识别、规则包加载与版本矩阵校验、强制性规定匹配、多法域冲突判定、覆盖缺口披露与
  Human Gate 登记，产出带 rule_id、知识层、置信度与页码锚点的法域适用性报告。
  法域未确定或 jurisdiction_pack_version 与法域线索不一致时阻断；只命中 base 层时
  只能输出通用风控观察，不得给出任何合规结论。法条置信度原样转述，禁止编造条文编号与判例。
  用户提到法域、准据法、适用法律、管辖、法域冲突、法域合规、合规稽核、强制性规定、
  规则包、知识包、数据出境、跨境传输、GDPR、PIPL、CCPA、竞业限制上限、仲裁协议效力时使用。
  Use when auditing a contract against jurisdiction knowledge packs: identifies governing
  law from clues, merges custom/jurisdiction/base layers, flags multi-regime conflicts with
  clause numbers and pages, and blocks when the pack version does not match the clues.
version: 1.0.0
type: procedural
risk_level: low
status: enabled
tags:
  - contract-review
  - jurisdiction
  - compliance-audit
  - conflict-of-laws
  - citation-discipline
requires:
  tools:
    - Read
    - Ls
    - Glob
    - Grep
    - Write
    - MathCalc
    - GenerateUUID
metadata:
  author: DesireCore
  version: 1.0.0
  updated_at: '2026-08-31'
  pipeline_stage: 4
  upstream: clause-extractor
  downstream: [contract-review-lead, review-reporter]
  runs_parallel_with: risk-scanner
  ontology_ref: shared/resources/business-ontology/contract.yaml
  packs_ref: shared/resources/jurisdiction-packs/
---

# 合同法域合规审计

## 何时使用

在流水线第 4 步「法域知识注入」执行本技能，输入是 `clause-extractor` 的结构化交接块。
与 `risk-scanner` **并行**执行：输入相同、互不依赖、互不读对方结论。

不在以下情况使用：上游受理结论为 `blocked`（流水线已终止）、上游交接块缺失或未通过核验（J1 拒绝启动）。

## 不可协商的前提

1. **J1→J8 顺序固定**，不得打乱、不得跳步、不得因为「一眼就是中国法」提前结束。
2. **先定法域（J2）→ 再叠 `jurisdiction`（J3）→ 最后叠 `custom`（J3）。**倒序、跳步或「先用 base 出初稿等法域确定了再补」都会复现样本 `TC-004`。
3. **只命中 `base` 层 = 不构成合规结论。**没有 `jurisdiction` 层时只能输出 `general_observation`，禁止写「合规无异常」「未发现异常」「合规稽核通过」及一切等价表述。
4. **法域未确定 → 只报「法域待确认」**（`verdict: jurisdiction_undetermined`），不出任何合规结论，不给「初步」「暂按」「倾向于」版本。
5. **`jurisdiction_pack_version` 与法域线索不一致 → 阻断**（`INV-008` / `rules.md#R-021`），不是警告、不是标注后继续。
6. **不确定的法条写「需人工确认」**，置信度原样转述。**禁止编造条文编号、司法解释文号与判例名称**（`rules.md#R-061`）。
7. **每条结论齐备四元组**：条款编号 + 证据位置（页码）+ 结论等级 + 对应动作。缺任一项该条不合格。
8. **没检查到就显式留白**，`blank` / `unknown` 并写原因，禁止按通过计（`INV-012`）。

---

## 结论上锁机制（本技能的核心，先读这一节）

「base 层不单独成结论」不能只靠自觉。本技能用**四道机器可检查的闸门**实现它：

### 闸门一：结论锁（`conclusion_lock`）

产物顶层有一个锁字段，**初始值为 `locked`**，只有 J3 成功加载了至少一个 `jurisdiction` 层包才置为 `unlocked`：

```yaml
conclusion_lock: locked        # locked | unlocked
compliance_conclusion_allowed: false   # 镜像值，随交接块下传
lock_reason: 未加载任何 jurisdiction 层知识包，仅 base 生效
```

`locked` 状态下**只允许写入 `kind: general_observation` 的条目**，`compliance_findings[]` 必须为空数组。这不是建议，是产物结构约束：`locked` + 非空 `compliance_findings` = 产物不合格，J8 自检必须拦下。

### 闸门二：条目分型（`kind` + `layer`）

每条结论强制带 `kind` 与 `layer` 两个字段，二者的合法组合是**封闭**的：

| `kind` | 允许的 `layer` | 允许的 `conclusion` | 说明 |
|---|---|---|---|
| `general_observation` | `base` | `observation` 一种 | 通用风控视角的观察，不是合规结论 |
| `compliance_finding` | `jurisdiction` / `custom` | `severe` / `important` / `advisory` / `pass` / `unknown` | 需 `conclusion_lock: unlocked` |
| `conflict_finding` | `jurisdiction` | `severe` / `important` / `unknown` | 同上 |
| `layer_conflict` | `custom` | `important` | custom 试图放宽 jurisdiction 强制性规定 |
| `coverage_gap` | 任意 | `blank` 一种 | 已知缺口与未覆盖项 |

**`layer: base` 的条目永远不能取 `severe` / `important` / `advisory` / `pass`。**这一条封死了「用 base 层的观察冒充合规结论」的路径——不是靠措辞审查，是靠取值域。

### 闸门三：禁用措辞表（J8 用 `Grep` 实检）

`conclusion_lock: locked` 时，产物与交接块中不得出现下列字符串（含其英文对应）：

```
合规无异常   未发现异常   合规稽核通过   合规项齐备   适用法律条款完整
无合规风险   符合法律规定   合法有效     未见违规     compliant
```

J8 用 `Grep` 在**已落盘的产物文件**上逐条检索，命中即产物不合格、重写后再落盘。
用 `Grep` 而不是「自己检查一遍」的理由：`TC-004` 的错误形式正是「报告表面看不出来」——
自查会被同一套措辞习惯放过，外部检索不会。

### 闸门四：下传标志

`compliance_conclusion_allowed` 随交接块的 `scope` 段下传，与上游 `consistency_conclusion_allowed`
同构。`review-reporter` 据此把 D3 合规稽核维度记为未覆盖而非满分（`review-scoring#CAP-D3-PACK-MISMATCH`
与 `DED-D3-JURIS-UNDETERMINED`），保证「没检查」不会在下游被洗成「检查通过」。

> 四道闸门是叠加的，不是备选。任何一道被绕过都能单独复现 `TC-004`：
> 闸门一漏 → 空结论有了容器；闸门二漏 → 观察升格成结论；
> 闸门三漏 → 措辞把「没检查」写成「通过」；闸门四漏 → 下游把留白算成满分。

---

## J1 上游核验与启动前置条件

**不满足任一条即拒绝启动**，回报 `contract-review-lead`，不产出任何结论：

| 前置条件 | 不满足时 |
|---|---|
| 上游 `handoff` 块存在，`from: clause-extractor` | 拒绝启动，回报「缺交接块」 |
| 上游链路的受理结论 ∈ {`passed`, `conditional`} | 拒绝启动（`blocked` 时流水线已终止） |
| `object` 三元组齐备（`contract_object_id` + `version_label` + `content_digest`） | 拒绝启动，回报「对象身份不完整」 |
| `artifact_path`（条款抽取产物）可读，`parts[].source` 全部可读 | 拒绝启动，回报缺失的绝对路径 |

**J1 的动作**

1. `Read` 上游交接块与 `artifact_path` 指向的抽取产物。
2. `Ls` 确认有效工作目录，取绝对路径备用。**不要在提示词或产物里写死任何用户主目录字面量。**
3. `GenerateUUID` 生成 `audit_id`，格式 `AUDIT-<YYYYMMDD>-<uuid 前 8 位>`。
4. 原样抄录 `object`、`scope.frozen_baseline`、`scope.consistency_conclusion_allowed`——**逐字复制，不重新校验、不改写**。
5. 把上游 `pending[]` 逐条登记为待兑现项；`must_escalate: true` 的每一条在你的交接块里必须原样出现。

**你从上游拿到什么、不拿什么**

`confirmed[]` 里的事实直接使用，不重复校验（重复校验会得出与上游不同的结论，破坏「同一个对象」）。
上游 `do_not_pass` 列出的内容你不去找：不读对话历史，不读上游的推理过程与中间草稿。

> 上游 `confirmed[]` 里那条**「法域线索：准据法为中国法（16.1，第 6 页），规则包 cn-v3 匹配」**
> 是事实陈述，不是授权。**「上游说匹配」不等于「确实匹配」**——J3 必须自己拿实际加载的
> `pack_version` 与线索重新比对一次。上游写 `cn-v3` 而你手上只有 `cn-v1`，就是版本矩阵不一致，按阻断处理。

---

## J2 法域识别（**必须在加载规则包之前完成**）

这一步回答唯一一个问题：**这份合同受哪个（些）法域约束？**

### 判据：四类线索，按证明力排序

| 序 | 线索类型 | 来源字段 | 证明力 | 说明 |
|---|---|---|---|---|
| ① | **明示准据法** | `governing_law.law_text` + `clause_no` + `evidence` | **决定性** | 合同自己写的「本协议适用 X 法」 |
| ② | 争议解决机构 | `dispute_resolution.forum` / `seat` | 强佐证 | 指名 CIETAC / 深圳国际仲裁院 / AAA / 都柏林法院等 |
| ③ | 数据合规制度 | `jurisdiction_clues.data_regimes_referenced` | **独立成边** | PIPL / GDPR / CCPA；**不是准据法**，是另一类 `governed_by` 边 |
| ④ | 当事方住所地 | `jurisdiction_clues.party_domiciles` | 仅推定用 | 只在①缺失时用于推定，且必须标注 |

线索用 `Grep` 在原文逐类检索，检索词取自各包 `pack.yaml#jurisdiction.detection_clues`
（`governing_law_texts` / `forum_texts` / `data_regimes` / `party_domicile_hints` / `document_type_hints`）。
**检索词只能来自包文件，不得凭记忆补充。**

### 每条线索登记为一条 `governed_by` 边

`declaration_type` 四态取自 `relations.yaml#governed_by`，**必须逐条判定，不得合并**：

```yaml
- id: JUR-CLUE-01
  declaration_type: governing_law     # governing_law | dispute_forum | data_regime | carve_out | unknown
  target: jurisdiction-cn             # 法域包 id 或制度名
  clause_no: "12.1"
  scope_text: 本协议的订立、效力、解释、履行及争议解决
  evidence:
    part: body
    page: 8
    quote: "12.1 本协议的订立、效力、解释、履行及争议解决，均适用中华人民共和国法律（不含港澳台地区法律）。"
```

> **最高频的漏检形态**：把 `governing_law` 与 `data_regime` 混成一类，于是「第 9.4 条提到 GDPR」
> 没有生成独立的边，多制度并存这件事从此不可计算。`TC-004` 的失败链第一环正是这个。
> **准据法条款与数据制度条款分别成边，一条都不许合并。**

### J2 的三态出口

| 出口 | 条件 | 后续 |
|---|---|---|
| `determined` | 有且仅有一条 `governing_law` 边，法域明确 | 进 J3 |
| `presumed` | 无 `governing_law` 边，但当事方住所地一致 | 按住所地推定并加载对应包，**必须标注「准据法未明示，按注册地推定」并触发人工确认**（`rules.md#R-021` 例外） |
| `undetermined` | 有两条及以上互斥的 `governing_law` 边，或线索为空且住所地不一致 | **`verdict: jurisdiction_undetermined`，`conclusion_lock` 保持 `locked`，不出任何合规结论**，直接跳到 J5 做冲突记录，再进 J8 落盘 |

`undetermined` 出口下**仍然要做 J5 冲突判定**——「说不清适用哪个法」本身就是必须报告的事实，
而且它正是 `HG-02` 的触发条件。跳过 J5 会让最严重的问题连同法域一起消失。

**`undetermined` 时唯一允许的结论措辞**：

```
法域判定：待确认。检出 2 条互斥的准据法声明（12.1 第 8 页 / 12.2 第 8 页），
在其中一条被删除或明确界定适用范围之前，本次审查不输出合规结论。
```

---

## J3 规则包加载、版本矩阵校验与三层合并

### J3.1 加载顺序（不可倒置）

```
① base（总是加载）
      ↓
② jurisdiction-<code>（按 J2 判定加载；可能多个）   ← 加载成功才解锁结论
      ↓
③ custom（总是尝试加载，可能全部条目 enabled: false）
```

用 `Read` 逐个读 `shared/resources/jurisdiction-packs/<pack>/pack.yaml` 与 `rules.yaml`。
`base` 层的 `missing-clauses.yaml` 与 `market-benchmarks.yaml` **你不读**——那是 `risk-scanner` 的判据，
读了就会产生双重判定。

### J3.2 版本矩阵校验（阻断闸门）

按 `contract.yaml#INV-008`：**`jurisdiction_pack_version` 声明的法域必须覆盖 `jurisdiction_clues`
中出现的全部法域线索。**校验三件事：

| 校验 | 不通过时 |
|---|---|
| A. 每条 `governing_law` / `dispute_forum` 边都有对应的已加载包 | **阻断** + `HG-02` |
| B. 上游交接块声明的 `pack_version` 与你实际加载的一致（如上游写 `cn-v3`，你加载的是 `cn-v1`） | **阻断** + 数据对齐建议 |
| C. 各包 `knowledge_base_version` 与本体 `ontology_version` 兼容（`compatible_ontology`） | `flag` + 数据对齐建议 |

**阻断流程（B 类不一致的完整走法）**

1. 立刻停止规则匹配，`conclusion_lock` 保持 `locked`。
2. 写一条 `JUR-ALIGN-*` 数据对齐建议：

```yaml
- id: JUR-ALIGN-01
  kind: coverage_gap
  layer: jurisdiction
  dimension: jurisdiction_pack_version
  declared_upstream: cn-v3            # 上游交接块里写的
  actually_loaded: cn-v1              # 你手上真实存在的
  clause_no: "16.1"
  evidence: {part: body, page: 6, quote: "16.1 本协议适用中华人民共和国法律。"}
  conclusion: blank
  action: 阻断本次法域审计；确认 cn-v3 规则包是否已发布并同步到本机知识包目录，
    同步后整套重跑；在 cn-v3 到位前不得以 cn-v1 的结论替代
  human_gate: HG-02
```

3. `verdict: blocked_version_mismatch`，交接块 `to: null`，回报 `contract-review-lead`。
4. **不输出任何以 `cn-v1` 为依据的合规结论**——包括「用现有版本先看一下」。
   规则包与合同法域对不上时，产出的不是「不够准的结论」，是**指向另一个法律体系的结论**。

> 为什么这里必须阻断而不是提示：降级后那行警告会被稀释成报告角落的小字，
> 而正文里「按中国法…」的结论会被当作有效结论使用。下游 `review-scoring` 的
> `CAP-D3-PACK-MISMATCH` 会把合规维度直接封顶为 0 分——但那已经是事后补救，
> 前置阻断才是正解。

### J3.3 三层合并（合并键 = 规则 `id`）

1. **同 `id` 跨层** = 同一条规则的不同层版本，取优先级最高层（`custom` 30 > `jurisdiction` 20 > `base` 10）。
2. 高层覆盖低层**必须**有 `overrides` + `override_reason`；缺任一项**视为新增**，与低层并存。
3. 新增与低层并存时**两条都判，取更保守者**。
4. 同优先级两条判定相反时，取更保守者并记 `JUR-MARK-*` 失败标记，**禁止自行择一**。
5. **强制性下限**：`custom` 条目试图放宽 `jurisdiction` 层 `mandatory: true` 的规则时——
   忽略该条目、按 `jurisdiction` 层执行、记一条 `kind: layer_conflict`、在报告中显示，**不阻断流程**。

```yaml
# 以下为格式示例。随团队分发的 8 条红线全部 enabled: false，且没有一条试图放宽法域强制性规定，
# 因此本条只有在用户自行新增条目后才可能出现。custom_entry 必须写用户实际写入的真实 id。
- id: JUR-LAYER-01
  kind: layer_conflict
  layer: custom
  conclusion: important
  custom_entry: <用户在 redlines.yaml 中新增的条目 id>
  overridden_rule: cn-labor-non-compete
  overridden_rule_mandatory: true
  finding: 该 custom 条目将竞业限制期限放宽至 3 年，超出 cn-labor-non-compete 的二年法定上限
  action: 忽略该 custom 条目，按 cn-labor-non-compete 执行；请红线 owner 修正阈值后递增 custom pack_version
```

### J3.4 `custom` 层的空壳事实

随团队分发的 `custom/redlines.yaml` **8 条红线全部 `enabled: false`**，这是刻意的模板，不是配置遗漏。

- `enabled: false` 的条目**完全不参与判定，也不出现在覆盖矩阵**。
- **你不得启用、修改或替用户填写任何一条**，也不得因为「它看起来合理」就按它判。
- 全部禁用时，`effective_ruleset.layers` 记为 `[base, jurisdiction-xx]`，`custom_entries_enabled: 0`，
  并在报告中如实写明「企业自定义层无启用条目」——**这句话本身是有价值的信息**，
  它告诉法务：这次审查没有用任何企业内部标准。

### J3.5 J3 的出口：解锁与否

```yaml
effective_ruleset:
  layers: [base, jurisdiction-cn, custom]
  base_pack_version: base-v1
  jurisdiction_pack_versions: [cn-v1]
  custom_pack_version: custom-v1
  custom_entries_enabled: 0
  knowledge_base_version: '2026-08-31'
conclusion_lock: unlocked                # ← 仅当 jurisdiction_pack_versions 非空且 J3.2 全过
compliance_conclusion_allowed: true
```

`jurisdiction_pack_versions` 为空数组时，`conclusion_lock` 必须保持 `locked`，
`compliance_conclusion_allowed: false`，并写明 `lock_reason`。**这是本技能唯一的解锁点。**

---

## J4 强制性规定匹配（`conclusion_lock: unlocked` 才执行）

对生效规则集里的**每一条** `jurisdiction` 层规则执行，一条不漏。禁止只挑「看起来相关的」跑。

### 单条规则的处理流水

```
rule.detection.clause_categories / keywords / keywords_en
        ↓  用 Grep 在原文与条款结构表里检索
命中的条款（可能 0 条 / 多条）
        ↓  逐条对照 rule.verdict_rules 的 condition
匹配到的 conclusion（severe / important / advisory / pass）
        ↓  取 rule.confidence（+ 美国法的 state_sensitivity）
JUR-RULE-* 条目（含四元组 + 置信度转述）
```

**未命中任何条款**时也必须留痕：写一条 `conclusion: pass` 的条目并注明检索范围（页码区间 + 检索词），
或在确实无法覆盖时写 `blank`。**「没提到就当通过」是被禁止的**——检索范围写不出来的判定不成立。

### 置信度转述表（`rules.md#R-061` 的执行细则）

| `confidence` | 报告里必须怎么写 | 反例（禁止） |
|---|---|---|
| `high` | 直接引用条文：「《民法典》第五百八十六条」 | —— |
| `content_high_article_uncertain` | 写内容，条文序号注明**「条文序号需人工确认」** | 直接写出一个序号 |
| `needs_human_confirmation` | 原样写出**「需人工确认」**，只陈述规则方向 | 补一个司法解释文号让结论看起来完整 |
| `needs_state_determination`（仅美国） | 写**「需确定适用州法后人工确认」** | 写「按美国法…」 |

规则条目自带的 `needs_human_confirmation[]` 数组里的每一句，**逐句转述到报告**，不得省略、不得压缩成一句。

### 美国法的额外闸门：`state_sensitivity`

| 取值 | 处理 |
|---|---|
| `low` | 跨州基本一致，可直接适用 |
| `medium` | 可给结论，但必须写「多数州一致，存在例外州，需确认适用州」 |
| `high` | **适用州法未确定时不得下结论**，`conclusion: unknown` + 「需确定适用州法后人工确认」 |

`state_sensitivity: high` 的现有规则：`us-indemnification-scope`、`us-perpetual-confidentiality`、
`us-non-compete-landscape`、`us-jury-trial-waiver`、`us-ccpa-service-provider-terms`、
`us-auto-renewal`、`us-efforts-standards`。**以包文件为准，不要背这份清单。**

> 把「跨州通行的惯例」说成「美国法规定」，与只用 base 层出合规结论是同一种错误的两个变体。

### `JUR-RULE-*` 条目的强制格式（结论四元组）

缺任一项该条不合格，不得计入：

```yaml
- id: JUR-RULE-07
  kind: compliance_finding
  layer: jurisdiction                    # base | jurisdiction | custom（闸门二）
  rule_id: cn-personal-info-cross-border # 必须真实存在于包文件
  pack_version: cn-v1
  category: data_protection
  mandatory: true
  confidence: content_high_article_uncertain
  legal_basis:
    instrument: 《中华人民共和国个人信息保护法》
    article: 第三十八条、第四十条
    article_confidence: content_high_article_uncertain
    article_note: 条文序号需人工确认
  clause_no: "8.1"                       # ① 条款编号
  evidence:                              # ② 证据位置
    part: body
    page: 6
    quote: "8.1 本协议项下的全部个人数据仅存储于乙方位于中华人民共和国境内的数据中心，不得跨境传输。"
  conclusion: important                  # ③ 结论等级
  finding: 合同声明适用 GDPR 但全部数据存于境内且禁止跨境传输，未约定任何出境合规路径
  action: 进入谈判项；确认是否存在境外接收方，若存在须补充安全评估 / 认证 / 标准合同三条路径之一   # ④ 对应动作
  human_gate: null
  needs_human_confirmation:
    - 触发安全评估的数量门槛与最新监管口径变动频繁，具体阈值需人工确认
```

**`rule_id` 与 `legal_basis` 都必须能在包文件里 grep 到。**产出前用 `Grep` 反查一次：
搜不到的 `rule_id` = 你在凭记忆造规则，该条必须删除。

> 下游 `review-scoring` 的 `DED-D3-FROM-MEMORY` 对「法条来自模型记忆而非知识包」每条扣 15 分，
> `DED-D3-NO-RULE-ID` 每条扣 5 分。但扣分是事后惩罚，`Grep` 反查是事前拦截——用后者。

---

## J5 法域冲突判定（`DC-006`）

**J2 出口为 `undetermined` 时本步仍然执行**——「说不清适用哪个法」本身就是要报告的冲突。

### 触发条件

同一文档存在**两条及以上** `governed_by` 边（J2 建的边）即触发。判定表来自所加载包的
`rules.yaml#conflicts` 段（`cn-conflict-*` / `us-conflict-*`），**不是你自己归纳的规则**。

### 三种冲突性质，处理完全不同

| 性质 | 含义 | 结论等级 | 动作 |
|---|---|---|---|
| **互斥** | 两条不能同时成立（两个准据法、两个排他管辖、仲裁与诉讼并存） | `severe` | 关键修改后继续 + `HG-02` |
| **需协调** | 可以并存但必须界定边界（中国法 + GDPR、准据法州与管辖州不一致） | `important` | 进入谈判项 + `HG-02` |
| **范围不闭合** | 声明了并存但适用范围没写清，或写了却无适用对象 | `unknown` | `HG-02`，**禁止择一默认** |

**最容易犯的错是把「需协调」判成「无冲突」。**「不是互斥」离「没问题」还差三个判定
（见下方 C05 走查）。三点中任一为否或无法判定，就是 `unknown` 进 Gate，不是通过。

### 输出要求（`actions.yaml#detect_jurisdiction_conflict`）

每条冲突必须写明：**哪两条声明、各自条款号与页码、冲突性质**。
「本合同存在法域冲突」这种没有落点的句子等于没写。

---

### C05 走查：中国法 + GDPR 并存（`TC-004` 的真实形态）

测试语料 `C05-data-processing-agreement.md` 是本技能的头号回归用例。走一遍完整判定。

#### 第一步：J2 建出三条边（不是一条）

```yaml
- id: JUR-CLUE-01
  declaration_type: governing_law
  target: jurisdiction-cn
  clause_no: "12.1"
  scope_text: 本协议的订立、效力、解释、履行及争议解决
  evidence: {part: body, page: 5, quote: "12.1 本协议的订立、效力、解释、履行及争议解决，均适用中华人民共和国法律（不含港澳台地区法律）。"}

- id: JUR-CLUE-02
  declaration_type: data_regime          # ← 不是 governing_law，也不能与 01 合并
  target: GDPR
  clause_no: "12.2"
  scope_text: 本协议项下的数据保护义务、数据主体权利及其救济
  evidence: {part: body, page: 5, quote: "12.2 本协议项下的数据保护义务、数据主体权利及其救济，应受欧盟《通用数据保护条例》（Regulation (EU) 2016/679, GDPR）管辖并依其规定解释；就该等事项产生的任何争议，双方同意提交爱尔兰共和国都柏林法院专属管辖。"}

- id: JUR-CLUE-03
  declaration_type: dispute_forum
  target: 深圳国际仲裁院
  clause_no: "12.3"
  evidence: {part: body, page: 5, quote: "12.3 因本协议引起的或与本协议有关的任何争议，双方应首先友好协商；协商不成的，任何一方均应提交深圳国际仲裁院按其届时有效的仲裁规则在深圳仲裁，仲裁裁决为终局裁决。"}
```

`12.2` 一条同时承载 `data_regime`（GDPR 管辖并依其解释）与 `dispute_forum`（都柏林法院专属管辖）
两种声明——**一条条款可以生成两条边**，按 `declaration_type` 拆，不按条款号拆。

#### 第二步：J5 输出两条冲突，不是一条

**冲突一：两个排他管辖并存（互斥）**——`cn-conflict-arbitration-and-litigation` 的变体：

```yaml
- id: JUR-CONF-01
  kind: conflict_finding
  layer: jurisdiction
  rule_id: cn-conflict-arbitration-and-litigation
  pack_version: cn-v1
  nature: 互斥
  conclusion: severe
  declarations:
    - {clause_no: "12.2", page: 5, statement: 就数据保护事项提交爱尔兰共和国都柏林法院**专属**管辖}
    - {clause_no: "12.3", page: 5, statement: 因本协议引起的**任何**争议提交深圳国际仲裁院仲裁，裁决终局}
  finding: 12.2 与 12.3 各自声明了一个排他性争议解决机制，且 12.3 的范围（任何争议）完全覆盖 12.2 的范围
    （数据保护事项），两个排他机制不可并存；数据保护争议同时落入两个互斥的排他条款
  action: 关键修改后继续；须二者择一，或在 12.3 中明确排除 12.2 已划出的事项范围
  human_gate: HG-02
  confidence: content_high_article_uncertain
  rule_match_note: cn-v1 的该条规则以「仲裁机构与人民法院并存」表述触发条件，
    本例中并存的另一方是外国法院（都柏林法院）；按同一互斥逻辑适用，
    但外国法院专属管辖条款在中国法项下的效力需人工确认
  legal_basis:
    instrument: 《中华人民共和国仲裁法》
    article: 仲裁协议有效要件条款
    article_confidence: content_high_article_uncertain
    article_note: 仲裁法处于修订活跃期，条文序号需人工确认
```

> **只报「适用法律有两个」而不报两个排他管辖并存，只算部分命中。**
> `ground-truth.yaml#C05` 明确要求管辖冲突必须在报告中体现。
> 准据法与争议解决机构是两回事——`governing_law` 与 `dispute_resolution` 在上游就是两个独立对象。

**冲突二：中国法与 GDPR 并列（需协调，但三点判定后落到 `unknown`）**——`cn-conflict-pipl-gdpr-parallel`：

```yaml
- id: JUR-CONF-02
  kind: conflict_finding
  layer: jurisdiction
  rule_id: cn-conflict-pipl-gdpr-parallel
  pack_version: cn-v1
  nature: 需协调（非天然互斥）
  conclusion: unknown                     # ← 三点判定有两点为否，不能判 pass，也不擅自判互斥
  declarations:
    - {clause_no: "12.1", page: 5, statement: 全协议适用中华人民共和国法律}
    - {clause_no: "12.2", page: 5, statement: 数据保护义务与数据主体权利受 GDPR 管辖并依其解释}
  three_point_test:                       # 包文件规定的三点，逐点判定，不得跳过
    - point: GDPR 适用范围是否被界定为闭合表述
      result: 部分闭合
      note: 12.2 限定了事项范围（数据保护义务、数据主体权利及救济），但未限定属地范围（哪些数据主体）
    - point: 是否存在欧盟数据主体
      result: 无法判定
      note: 全文未出现欧盟数据主体、欧盟境内、EEA 等表述；8.1 却要求全部数据仅存于中国境内
    - point: 是否同时满足中国法项下的数据出境要求
      result: 否
      note: 8.1 禁止跨境传输，全文无安全评估 / 保护认证 / 标准合同任一路径的约定（见 JUR-RULE-07）
  finding: 12.1 与 12.2 并列适用两套数据合规制度，但适用对象、属地范围与义务优先级三者均未约定；
    三点判定中两点为否/无法判定，按包文件规定输出 unknown
  action: 进入谈判项；须补充界定 GDPR 的属地适用范围，或在确认无欧盟数据主体后删除 12.2；
    两制度义务冲突时的优先顺序须明确约定
  human_gate: HG-02
```

#### 第三步：「禁止数据导出」与 GDPR 数据可携权的张力（这条最容易漏）

它**不是**一条缺失条款，也**不是**市场标尺偏差——那两项归 `risk-scanner`。
归你的理由只有一个：**它是「声明适用某法域却缺该法域必备机制」的法域内部矛盾。**

```yaml
- id: JUR-CONF-03
  kind: conflict_finding
  layer: jurisdiction
  rule_id: cn-conflict-pipl-gdpr-parallel   # 同一条冲突规则的第二个落点：并列制度下的义务不可履行
  pack_version: cn-v1
  nature: 范围不闭合
  conclusion: important
  declarations:
    - {clause_no: "12.2", page: 5, statement: 数据主体权利及其救济受 GDPR 管辖并依其规定解释}
    - {clause_no: "8.2",  page: 4, statement: 不得以任何形式导出、下载或交付个人数据的批量副本}
    - {clause_no: "8.4",  page: 4, statement: 终止后彻底删除，不提供任何形式的数据返还或导出}
    - {clause_no: "6.2",  page: 3, statement: 乙方应协助甲方响应查阅、更正、删除、限制处理与可携带权请求}
  finding: |
    12.2 把数据主体权利的判断标准指向 GDPR，而 GDPR 项下的可携带权与查阅权要求
    以结构化、通用、机器可读格式提供个人数据副本；8.2 与 8.4 却禁止一切形式的批量导出与返还。
    6.2 承诺协助响应可携带权请求，与 8.2 / 8.4 在同一份文本内自相矛盾——
    承诺协助的义务缺少可执行的技术与合同路径。
  action: 进入谈判项；须在 8.2 中为响应数据主体权利请求开出例外通道，
    或删除 12.2 对 GDPR 的援引并相应修订 6.2 的承诺范围
  human_gate: HG-02
  confidence: needs_human_confirmation
  legal_basis:
    instrument: 欧盟《通用数据保护条例》（GDPR）
    article: 数据可携带权与查阅权条款
    article_confidence: needs_human_confirmation
    article_note: 本知识包未覆盖 GDPR 规则细节，条文序号与具体要件需人工确认
  coverage_note: cn-v1 与 us-v1 均未覆盖 GDPR 实体规则；本条只陈述两组条款在文本内的相互矛盾，
    不对 GDPR 项下义务的成立与范围下结论
```

> **注意最后两个字段。**`cn-v1` 的 `known_gaps` 里没有 GDPR 规则集，本仓库也没有 `jurisdiction-eu` 包。
> 所以你能说的是「12.2 援引了 GDPR，而 8.2/8.4 使 6.2 承诺的可携带权协助无法履行」——
> 这是**同一份文本内部的矛盾**，用原文就能证明；
> 你不能说的是「违反 GDPR 第 20 条」——那需要一个你没有的知识包。
> 想写条文号的冲动，正是 `TC-004` 与 `R-061` 要拦的东西。

#### 第四步：C05 的输出底线

`ground-truth.yaml#C05` 的 `must_detect` 与本步的对应关系：

| ground-truth 项 | 本技能的落点 | 漏掉的后果 |
|---|---|---|
| `governing-law-conflict`（critical） | `JUR-CONF-01` + `JUR-CONF-02` **两条都要有** | 只报其一算部分命中 |
| 两个排他管辖并存 | `JUR-CONF-01` | 报告缺管辖冲突，D3 不得满分 |
| 数据导出禁止 × 可携带权 | `JUR-CONF-03` | 最隐蔽的一条，漏了报告看上去仍然完整 |
| `cross-border-transfer-mechanism-absent` | `JUR-RULE-07`（J4 产出） | 检出加分，漏检不判失败 |

`data-export` 本身报为「条款存在但方向不利」由 `risk-scanner` 负责，**你不要重复报缺失**——
`ground-truth.yaml#C05.must_not_flag` 明确把「把第八条报成条款缺失」列为分类错误。

---

## J6 覆盖缺口披露

**这一步的产出与 J4/J5 同等重要。**没写出来的缺口，在下游会被当成「已检查且通过」。

三类缺口，全部写成 `kind: coverage_gap` + `conclusion: blank`：

| 类型 | 来源 | 写法 |
|---|---|---|
| **包已知缺口** | 所加载包的 `known_gaps` | 逐条对照合同内容，命中的领域写「本包未覆盖」 |
| **未加载的层** | `custom_entries_enabled: 0`、无 `jurisdiction-eu` 包等 | 写明缺哪一层、影响哪些检查项 |
| **无法判定项** | J4 的 `unknown`、J5 的三点判定「无法判定」 | 写明卡在哪一步、需要什么信息才能判 |

```yaml
- id: JUR-GAP-02
  kind: coverage_gap
  layer: jurisdiction
  conclusion: blank
  gap_source: cn-v1#known_gaps
  affected_scope: 欧盟《通用数据保护条例》的实体规则
  finding: 合同 12.2 援引 GDPR，但本次加载的知识包（base-v1 / cn-v1 / custom-v1）均不含 GDPR 规则集，
    仓库内也无 jurisdiction-eu 包；GDPR 项下义务是否成立、范围如何，本次未检查
  action: 需人工确认或引入欧盟法知识包后重跑；在此之前 GDPR 相关结论一律留白
  must_not_count_as_pass: true
```

`gap_policy` 是各包的硬规定：**命中已知缺口领域时留白，禁止按通过计**（`contract.yaml#INV-012`）。
`must_not_count_as_pass: true` 让这条约束在产物结构里可被机器检查，而不只是一句话。

---

## J7 Human Gate 登记与四元组自检

### Gate 登记

按 `actions.yaml#human_gates`，你的产出主要触达两道 Gate：

| Gate | 由你的什么触发 |
|---|---|
| `HG-02` 争议解决机制 | 抽到 `dispute_resolution` / `governing_law` 类条款、`DC-006` 命中法域冲突、`INV-008` 阻断 |
| `HG-03` 责任与违约分配 | `human_gate: HG-03` 的规则命中（如 `cn-liquidated-damages-adjustment`、`us-liability-cap-convention`） |
| `HG-01` / `HG-04` | 规则条目自带（`cn-deposit-cap` → HG-01；`cn-authority-and-seal`、`cn-electronic-signature` → HG-04） |

```yaml
- id: JUR-GATE-01
  gate_id: HG-02
  triggered_by: [JUR-CONF-01, JUR-CONF-02, JUR-CONF-03]
  reason: 同一文本存在互斥的排他管辖，且并列适用两套数据合规制度而未界定范围
  approver_role: 法务
  status: pending                     # 只能是 pending；由人改成其他值
```

**Gate 的通过只能由人给出。**你不得代为确认、不得预填 `approved`、不得设超时自动通过。
未确认即停在该动作——`blocks_action: [release_to_legal, emit_final_report]`。

### 四元组自检（逐条过，不合格的条目删除或补齐）

对每一条 `JUR-RULE-*` / `JUR-CONF-*` / `JUR-LAYER-*`：

- [ ] `clause_no` 非空且非 `unknown`（多条声明的冲突条目用 `declarations[].clause_no`）
- [ ] `evidence.page` 非空非 `unknown`；`evidence.quote` 是逐字原文
- [ ] `conclusion` 取值在闸门二允许的域内
- [ ] `action` 是可执行的祈使句（「须补充界定 GDPR 的属地适用范围」），不是描述句（「范围不清」）
- [ ] `rule_id` 能在包文件里 `Grep` 到
- [ ] `confidence` 已转述；美国法规则的 `state_sensitivity` 已转述

**`quote` 必须能 grep 到**：产出前用 `Grep` 拿 `quote` 的一个片段回原文验一次。
搜不到 = 你在复述而不是引用，该条证据不成立（`INV-011` → `reject_output`）。

---

## J8 落盘与禁用措辞实检

### 落盘位置

```
<有效工作目录>/contract-review/<contract_object_id>/jurisdiction/<audit_id>/jurisdiction.yaml
```

**文件名固定为 `jurisdiction.yaml`**——`review-reporter` 的 `artifacts.jurisdiction_report`
按这个名字取。`<有效工作目录>` 用 `Ls` 实际确认后取绝对路径，
**不要在提示词或产物里写死任何用户主目录字面量**。

旧产物**保留不覆盖**。规则包版本、法域判定或上游受理结论变化时**整套重跑**、生成新的 `audit_id`，
不做增量修补——法域是全局前提，前提变了所有结论一起失效。

### 落盘后的禁用措辞实检（闸门三）

`conclusion_lock: locked` 时，对**已落盘的文件**执行：

```
Grep 固定字符串：合规无异常 / 未发现异常 / 合规稽核通过 / 合规项齐备 /
                适用法律条款完整 / 无合规风险 / 符合法律规定 / 合法有效 / 未见违规 / compliant
```

任一命中 → 产物不合格 → 改写后重新落盘再检，**不得带着命中项交接**。

`conclusion_lock: unlocked` 时同样禁用 `合法有效` / `无法律风险` / `可以签署` 这一组定性表述
（`rules.md#R-060` / `actions.yaml#release_to_legal.forbidden_wording`）——**有法域包也不代表你能做法律定性**。

### 结构一致性实检（闸门一 + 闸门二）

落盘前逐条确认，任一不成立即产物不合格：

| 检查 | 判据 |
|---|---|
| `conclusion_lock == locked` 时 `compliance_findings` 与 `conflict_findings` 均为空数组 | 闸门一 |
| 不存在 `layer: base` 且 `conclusion ∈ {severe, important, advisory, pass}` 的条目 | 闸门二 |
| 不存在 `kind: general_observation` 且 `layer != base` 的条目 | 闸门二 |
| `compliance_conclusion_allowed` 与 `conclusion_lock` 取值一致 | 闸门四 |

---

## 审计产物完整结构

顶层键 `jurisdiction`。

```yaml
jurisdiction:
  # ── 身份与版本 ──
  audit_id: AUDIT-20260331-9d24f1a0
  audited_at: 2026-03-31T11:20:44+08:00
  executed_by: jurisdiction-auditor
  skill: jurisdiction-audit@1.0.0
  ontology_version: onto-v1

  # ── 上游绑定（原样携带，不改写、不重新校验）──
  upstream:
    from: clause-extractor
    extraction_id: EXTRACT-20260331-4b81ce07
    artifact_path: /abs/.../EXTRACT-20260331-4b81ce07.extraction.yaml
    upstream_receipt_path: /abs/.../INTAKE-20260331-7f3a2c9b.receipt.yaml
    parser_revision: 0.8.4
    consistency_conclusion_allowed: false   # 原样透传，不得置 true

  object:                                   # 交接对象编号（三元组，原样承自上游）
    contract_object_id: YCIT-DPA-2025-0311
    object_title: 数据处理协议（DPA）
    version_label: C05-data-processing-agreement
    content_digest: 3a71c9e0f4b8d215
    submission_mode: single

  # ── J2 法域识别 ──
  jurisdiction_determination:
    outcome: determined                     # determined | presumed | undetermined
    primary_jurisdiction: jurisdiction-cn
    basis: 明示准据法（12.1，第 5 页）
    presumption_note: null                  # presumed 时必填「准据法未明示，按注册地推定」
    clues: [JUR-CLUE-01, JUR-CLUE-02, JUR-CLUE-03]

  governed_by_edges: [...]                  # J2 的 JUR-CLUE-* 全量

  # ── J3 生效规则集与结论锁 ──
  effective_ruleset:
    layers: [base, jurisdiction-cn, custom]
    base_pack_version: base-v1
    jurisdiction_pack_versions: [cn-v1]
    custom_pack_version: custom-v1
    custom_entries_enabled: 0
    knowledge_base_version: '2026-08-31'
    merge_notes: []                         # overrides / 取更保守者 / 并存的记录
  conclusion_lock: unlocked
  compliance_conclusion_allowed: true
  lock_reason: null

  version_matrix:                           # 五维 + 本体版本，逐项登记
    skill_version: 1.0.0
    server_version: <运行时给定>
    knowledge_base_version: '2026-08-31'
    jurisdiction_pack_version: cn-v1
    parser_revision: 0.8.4
    ontology_version: onto-v1
    mismatches: []                          # 非空时每条配一条 JUR-ALIGN-*

  # ── 结论条目（按 kind 分列，便于闸门检查）──
  general_observations: [...]               # layer 只能是 base，conclusion 只能是 observation
  compliance_findings:   [...]              # J4 的 JUR-RULE-*
  conflict_findings:     [...]              # J5 的 JUR-CONF-*
  layer_conflicts:       [...]              # J3.3 的 JUR-LAYER-*
  coverage_gaps:         [...]              # J6 的 JUR-GAP-*
  alignment_advice:      [...]              # J3.2 的 JUR-ALIGN-*
  failure_marks:         [...]              # JUR-MARK-*（同优先级判定相反等）
  human_gates:           [...]              # J7 的 JUR-GATE-*

  summary: |                                # ← 下游会剥离本字段，关键事实不得只写在这里
    法域判定：中国法（cn-v1），依据 12.1（第 5 页）明示准据法。
    检出法域冲突 3 条（2 条互斥 / 1 条范围不闭合），全部触发 HG-02。
    覆盖缺口 2 项：GDPR 实体规则未覆盖、企业自定义层无启用条目。

  stats:                                    # 客观计数，不含判断
    clues_detected: 3
    rules_evaluated: 18
    compliance_findings: 6
    conflict_findings: 3
    coverage_gaps: 2
    unknown_conclusions: 1
    gates_triggered: 1

  verdict: audited                          # audited | jurisdiction_undetermined
                                            # | blocked_version_mismatch | blocked_missing_pack
  handoff: {...}
```

### `verdict` 四态与后续动作

| `verdict` | 触发 | `conclusion_lock` | `handoff.to` |
|---|---|---|---|
| `audited` | 正常完成 | `unlocked` | `[contract-review-lead, review-reporter]` |
| `jurisdiction_undetermined` | J2 出口 `undetermined` | `locked` | `[contract-review-lead]`，附冲突与对齐建议 |
| `blocked_version_mismatch` | J3.2 校验 B 不通过 | `locked` | `[contract-review-lead]`，附 `JUR-ALIGN-*` |
| `blocked_missing_pack` | J3.2 校验 A 不通过（线索指向的包不存在） | `locked` | `[contract-review-lead]`，附缺哪个包 |

后三态**一律不向 `review-reporter` 投递合规结论**。组长按 `review-orchestration#O3`
把法域类 `check_id` 全部记 `blocked`，`release_to_legal` 禁止。

---

## 结构化交接

**只发这个块。不发对话历史，不发你的推理过程，不发中间草稿。**
骨架与上游 `contract-intake` / `clause-extractor` 同构（`to` / `from` / `object` / `confirmed` /
`pending` / `scope` / `do_not_pass`），便于全链路统一消费与回放。

### 收件方与投递方式

| 收件方 | 方式 | 内容 |
|---|---|---|
| `contract-review-lead` | `SendMessage` | 完成回报 + 产物绝对路径 + `stats` + `verdict` |
| `review-reporter` | **不投递结论** | 只由组长告知产物路径，它自行从磁盘读取并**重新取证** |
| `risk-scanner` | **不投递** | 并行支线，互不读对方结论 |

> ⚠️ **不得用 `Delegate` / `SendMessage` 把结论直接推给 `review-reporter`。**
> 蓝本第二节要求复核 Agent「基于原文与结构化事实重新判断，**不读前序推理**」。
> 最干净的保证不是发一份贫瘠的交接，而是**根本没有这条通道**。
>
> ⚠️ **禁止用 `Delegate` 的 `subtask` 模式**联系复核环节：它继承完整对话历史，正好违背独立复核约束。

### 交接块结构

```yaml
handoff:
  to: [contract-review-lead]
  from: jurisdiction-auditor
  audit_id: AUDIT-20260331-9d24f1a0
  artifact_path: /abs/.../contract-review/YCIT-DPA-2025-0311/jurisdiction/AUDIT-20260331-9d24f1a0/jurisdiction.yaml
  upstream_artifact_path: /abs/.../EXTRACT-20260331-4b81ce07.extraction.yaml

  object:                                 # 交接对象编号（原样承自上游，不改写）
    contract_object_id: YCIT-DPA-2025-0311
    object_title: 数据处理协议（DPA）
    version_label: C05-data-processing-agreement
    content_digest: 3a71c9e0f4b8d215
    submission_mode: single

  confirmed:                              # 已确认事项（下游可直接当作事实使用）
    - 法域判定：中国法，依据 12.1（第 5 页）明示准据法；jurisdiction_pack_version = cn-v1
    - 生效规则集：base-v1 + cn-v1 + custom-v1；custom 层启用条目 0 条
    - 版本矩阵六维已登记，jurisdiction_pack_version 与法域线索一致，无阻断
    - governed_by 边 3 条：governing_law×1（12.1）、data_regime×1（12.2）、dispute_forum×2（12.2 / 12.3）
    - 法域冲突 3 条已判定并各自锚定条款号与页码，全部触发 HG-02
    - 强制性规定匹配 18 条规则，命中 6 条，其中 needs_human_confirmation 3 条已原样转述
    - compliance_conclusion_allowed = true（jurisdiction 层已加载）

  pending:                                # 待确认项（下游不得自行消化）
    # ① 上游 pending 原样透传，id 与 statement 不改写
    - id: PEND-01
      origin: upstream
      must_escalate: true
      statement: <上游原文，逐字保留>
      required_downstream_action: <上游原文，逐字保留>
      evidence: {part: body, page: 4, quote: "<上游原文>"}
    # ② 本 Agent 新增，用 PEND-JUR-* 编号以示区分
    - id: PEND-JUR-01
      origin: jurisdiction-auditor
      from_finding: JUR-CONF-02
      must_escalate: true
      statement: 12.1 与 12.2 并列适用中国法与 GDPR，三点判定中「是否存在欧盟数据主体」无法判定、
        「中国法出境路径是否落地」为否；按 cn-v1#cn-conflict-pipl-gdpr-parallel 输出 unknown
      required_downstream_action: 属蓝本第十二节「争议解决机制」，须走 HG-02 由法务裁定；
        裁定前该项在覆盖矩阵中留白，不得计入通过率
      evidence: {part: body, page: 5, quote: "12.2 本协议项下的数据保护义务、数据主体权利及其救济，应受欧盟《通用数据保护条例》（Regulation (EU) 2016/679, GDPR）管辖并依其规定解释"}
    - id: PEND-JUR-02
      origin: jurisdiction-auditor
      from_finding: JUR-GAP-02
      must_escalate: true
      statement: 本次加载的知识包均不含 GDPR 实体规则，GDPR 项下义务是否成立与范围如何**未检查**
      required_downstream_action: 相关检查项在覆盖矩阵中留白（status = blank），禁止按通过计（INV-012）
      evidence: {part: body, page: 5, quote: "应受欧盟《通用数据保护条例》（Regulation (EU) 2016/679, GDPR）管辖并依其规定解释"}

  scope:                                  # 本次任务范围
    in_scope_completed:
      - 法域识别与 governed_by 边构建
      - 三层知识包合并与版本矩阵校验
      - jurisdiction 层强制性规定匹配
      - 法域冲突判定（DC-006 + 各包 conflicts）
      - 覆盖缺口披露与 Human Gate 登记
    out_of_scope:
      - 关键缺失条款检查与市场标尺对标（属 risk-scanner）
      - 企业红线命中判定（属 risk-scanner）
      - 风险等级排序、评分、动作建议与放行结论（属 review-reporter）
      - 版本对比与风险变化方向（属 review-reporter）
    frozen_baseline: {...}                # 原样承自上游，未改写
    consistency_conclusion_allowed: false # 原样透传
    compliance_conclusion_allowed: true   # ← 本 Agent 新增，闸门四的下传标志
    coverage_summary:
      rules_evaluated: 18
      findings: 6
      conflicts: 3
      blank: 2                            # 显式欠账，禁止按通过计
      unknown: 1

  do_not_pass:                            # 我没传、你也不要来取
    - 对话历史
    - 本 Agent 的推理过程与中间草稿
    - 我在候选规则之间取舍的过程与被排除的候选
    - 任何风险等级排序、评分、修改建议或放行结论
    - 任何未经 evidence 锚定的判断
    - 任何未在知识包中登记的法条编号、司法解释文号或判例名称
```

**交接方式硬规则**：引用的所有文件必须写**绝对路径**——下游 Agent 的工作目录与你不同。

---

## 自检清单（交接前逐条确认）

**启动与边界**

- [ ] 上游 `handoff` 存在且受理结论 ∈ {`passed`, `conditional`}，未在 `blocked` 下启动
- [ ] `object` 三元组齐备且**逐字**承自上游，未改写
- [ ] 没有读上游的推理过程、中间草稿或对话历史
- [ ] 没有读 `base/missing-clauses.yaml` 与 `base/market-benchmarks.yaml`（那是 `risk-scanner` 的判据）

**顺序与前置（base 层不单独成结论）**

- [ ] J1→J8 全部执行，无跳步；**J2 在 J3 之前完成**
- [ ] `conclusion_lock` 的取值与 `effective_ruleset.jurisdiction_pack_versions` 是否非空严格一致
- [ ] `locked` 时 `compliance_findings` 与 `conflict_findings` 均为空数组
- [ ] 全文没有 `layer: base` 且 `conclusion ∈ {severe, important, advisory, pass}` 的条目
- [ ] 已对落盘文件跑过禁用措辞 `Grep`，零命中
- [ ] `compliance_conclusion_allowed` 已写进交接块 `scope`

**版本矩阵**

- [ ] 六个维度逐项登记，无遗漏
- [ ] 上游声明的 `pack_version` 与实际加载的**自己重新比对过**，不是照抄上游的「匹配」结论
- [ ] 不一致时 `verdict` 为 `blocked_*`，`handoff.to` 不含 `review-reporter`，且附了 `JUR-ALIGN-*`

**引用纪律**

- [ ] 每条 `rule_id` 都用 `Grep` 在包文件里反查过，全部命中
- [ ] 每条 `confidence` 已转述；`content_high_article_uncertain` 的条文序号写了「需人工确认」
- [ ] `needs_human_confirmation[]` 里的每一句都逐句写进了报告，没有压缩、没有省略
- [ ] 美国法规则的 `state_sensitivity` 已转述；`high` 且州法未定的一律 `unknown`
- [ ] 全文没有出现任何包文件里查不到的条文编号、司法解释文号或判例名称

**冲突判定**

- [ ] 每条 `governed_by` 边按 `declaration_type` 独立成边，`governing_law` 与 `data_regime` 没有合并
- [ ] 每条冲突写明了**哪两条声明、各自条款号与页码、冲突性质**
- [ ] 「需协调」类没有被判成「无冲突」；三点判定逐点写了结果
- [ ] 无法判定的输出 `unknown` + `HG-02`，没有择一默认
- [ ] 准据法冲突与管辖冲突**分别成条**，没有合并成一句「适用法律有两个」

**覆盖与留白**

- [ ] 所加载包的 `known_gaps` 已逐条对照，命中的写了 `blank` + 「本包未覆盖」
- [ ] `custom` 层无启用条目时，这个事实写进了报告而不是沉默略过
- [ ] 没有把任何未检查项写成通过

**四元组与证据**

- [ ] 每条结论齐备条款编号 + 页码证据 + 结论等级 + 对应动作
- [ ] 每条 `evidence.quote` 用 `Grep` 回原文验过，能命中
- [ ] `action` 是祈使句，不是描述句

**不越界**

- [ ] 没有给风险等级排序、没有做市场标尺比对、没有算分
- [ ] 没有启用或修改 `custom/redlines.yaml` 的任何条目
- [ ] Human Gate 全部 `status: pending`，没有代为确认或预填
- [ ] 没有出现「合法有效」「无法律风险」「可以签署」这类定性表述
- [ ] `do_not_pass` 列出了「本 Agent 的推理过程与中间草稿」

**可回放**

- [ ] 落盘用的是 `Ls` 实际确认过的绝对路径，没有写死用户主目录字面量
- [ ] 文件名为 `jurisdiction.yaml`，旧产物未被覆盖，本次是新的 `audit_id`
