name: jurisdiction-audit
description: >-
  有界法域审计：读取上游条款事实和一组匹配规则，在单个成员回合内产出法域识别、适用性、缺口和证据回执。
  只做法域与规则适用性观察，不做最终法律意见；超时或输入不完整就 blocked。
version: 1.3.0
type: procedural
risk_level: low
status: enabled
tags: [contract-review, jurisdiction, bounded-loop, receipt-audit]
requires:
  tools: [Read, Ls, Glob, Grep, Write, GenerateUUID]
metadata:
  author: DesireCore
  updated_at: '2026-09-15'
  pipeline_stage: 4
  upstream: clause-extractor
  downstream: [contract-review-lead, review-reporter]
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

只读取一次上游抽取产物和合同正文中与法域有关的片段。若上游 `verdict` 不是 `passed` 或 `conditional`、对象摘要不一致、路径不可读，立即写一个 `blocked` 回执并停止。

### J2 识别

从标题、适用法律、管辖、争议解决和明确的实体法名称中识别 `jurisdiction`、`governing_law`、`venue`。没有充分证据时使用 `unknown`，不得猜测。

### J3 规则包

只读取一个匹配的 `jurisdiction-packs/<slug>/pack.yaml` 和必要的版本元数据；若没有匹配包或日期不在包的有效区间，状态为 `unknown` 或 `blocked`，说明原因。不要遍历整个资源树，不要重复读取同一文件。

### J4 有界观察

最多 5 条记录，每条必须包含：`finding_id`、`status`（`covered`/`unknown`/`not_applicable`/`blocked`）、`clause_ref`、`evidence_quote`、`location`、`rule_ref`、`reason`。只能引用 Read/Grep 实际看到的原文；没有证据就 `unknown`。

### J5 交付

在 `canonical_artifact_root/<case_id>/jurisdiction-audit/` 写入一个 YAML 产物和一个 `JURISDICTION-RECEIPT.yaml`。写入后完整 Read 回读。回执必须包含：

- `case_id`、`object`、`input_digest`、`status`；
- `jurisdiction`、`governing_law`、`venue`；
- `findings_count`、`unknown_count`、`blocked_reason`（无则 `null`）；
- `artifact_path`、`evidence_refs`、`read_back: passed`。

完成标准是产物和回执都真实存在、能回读、对象身份一致、所有 `covered` 条目都有证据。不要把回执正文只发在消息里；必须给 Lead 绝对路径和统计摘要。收到一个回合内无法完成时，立即写 `blocked`/`capability_debt`，不要等待或自己补写最终结论。
