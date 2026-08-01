# Skill 自动生成与结果可解释性

## 结论

平台以模型契约为唯一事实源，自动编译完整、可版本化、可人工修改的 `SkillDefinition`。结果解释统一经过 `EvidencePackage -> 确定性解释 -> 可选大模型改写` 链路。大模型不参与指标计算、阈值推断、风险判定或模型绑定。

## 核心链路

```text
模型输入/输出/变量/约束/目标契约
  -> SkillDefinition 编译与校验
  -> 固定 model_id + version + content/contract hash
  -> Task / Model API / Skill / Agent 调用
  -> EvidencePackage
  -> 确定性结构化解释
  -> 可选 LLM 文案增强（校验失败自动回退）
  -> Skill Center / Task Center / Result Center / Agent
```

## 完整 SkillDefinition

自动生成内容包括：

- 固定版本模型绑定与契约 hash；
- 输入、输出 Schema；
- 使用说明、触发与非触发示例；
- 每个输入参数的采集问题；
- 目标、输出变量、指标函数、约束、风险规则、人工复核项和解释局限；
- 生成方式、LLM 审计、校验结果、定义 hash 和修订历史。

风险阈值只接受模型契约显式声明，生成器不推测业务阈值。没有返回的字段不会按 `0` 参与指标或风险判断。

## 通用性与禁止硬编码

生成与解释主链路不得按模型名、场景名或业务字段名分支。字段发现、维度、单位、默认值策略、变量摘要、约束检查和风险规则均来自模型或 SkillDefinition 声明。

系统级固定规则仅用于安全不变量，例如：禁止自动下发外部动作、必须人工复核、指标函数白名单、证据引用校验。这些规则不包含业务场景知识。

## 人工编辑边界

人工可以在 Skill Center 编辑完整 JSON 并保存为新修订。保存前会校验：

- 输入输出 Schema 与绑定模型的权威调用契约一致；
- 每个输入参数有采集问题；
- 每个输出变量有解释声明和至少一个证据指标；
- 解释约束与模型声明一致；
- 风险规则只引用已声明指标；
- 模型 ID、版本和 hash 不漂移。

若需要改变模型输入输出，应先发布新的模型版本，再重新生成 Skill，而不是在 Skill 中绕过模型契约。

## 大模型信任边界

Skill 生成阶段，大模型只能新增或润色说明、示例和审阅文案，不能删除确定性工作流，也不能修改 Schema、变量、约束、指标、阈值和绑定。新增无来源数字或收益/最优/自动执行保证会被拒绝。

结果解释阶段，大模型只能改写已经生成的 EvidencePackage。所有事实、推断和建议条目必须携带有效 `evidence_refs`；出现无证据数字、未知引用或保证性结论时，平台自动回退到确定性解释并记录审计原因。

## API

- `POST /api/models/{model_id}/skills/preview`：预览，不持久化；
- `POST /api/models/{model_id}/skills/generate`：生成并持久化完整 Skill；
- `POST /api/skills/{skill_name}/validate`：校验当前或待保存定义；
- `PUT /api/skills/{skill_name}`：保存人工修订；
- `GET /api/skills/{skill_name}/versions`：读取修订历史；
- `POST /api/skills/{skill_name}/create-agent-skill`：从完整定义生成 Agent Skill 包。

## 兼容策略

`explanation_structured` 和 `evidence_package` 是新的权威解释契约。旧客户端仍可读取顶层 `explanation`，但新界面和 Agent 优先使用结构化解释。旧场景解释器仅作为兼容输出保留，不参与新证据链的计算与风险判断。

