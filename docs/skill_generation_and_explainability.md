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

## 生成、Hash 与版本实现

### “生成完整 Skill”做什么

“生成完整 Skill”调用模型契约编译器，把已发布模型的输入、输出、变量、目标、约束和解释声明编译为可调用的 `SkillDefinition`。生成结果会写入 Skill 注册表，并记录：

- 固定的 `model_id`、模型版本和模型内容/契约 Hash；
- 输入 Schema、输出 Schema、参数采集问题和示例；
- 目标、输出变量、指标函数、约束检查、风险规则、证据引用和人工复核项；
- `generation` 元数据、校验结果、`definition_hash` 和修订号。

预览接口只返回候选定义，不创建修订；持久化生成会创建或更新当前完整定义。人工编辑后，必须先校验，再通过“保存为新修订”保留历史。

### 定义 Hash 与模型契约 Hash

`definition_hash` 是当前 `SkillDefinition` 内容的 SHA-256 指纹，用于完整性校验、修订追踪和审计关联。计算前会对 JSON 做稳定序列化（排序字段、统一分隔符），并排除 `definition_hash` 自身、`validation`、`updated_at` 和 `generation.generated_at`；因此字段顺序、校验结果或生成时间变化不会单独制造新定义版本，但 Schema、绑定、指标、阈值、解释规则或文案变化会改变 Hash。

`model_contract_hash` 是绑定模型契约的指纹，反映模型输入/输出和契约内容。两者用途不同：前者回答“这份 SkillDefinition 是否相同”，后者回答“绑定的模型契约是否相同”。固定绑定下，如果模型契约 Hash 发生变化，Skill 会被标记为不可调用或绑定过期，需要按当前模型契约重新生成，而不能继续沿用旧定义。

### “生成 Agent”做什么

“生成 Agent”以当前完整 `SkillDefinition` 和 API Skill 为输入，创建或更新 `agent_skills/<agent_skill_name>/` 包。包内包括：

- `skill.yaml`：Agent 名称、绑定的 API Skill、状态、执行和安全策略；
- `SKILL.md`：面向 Agent 的能力说明和使用边界；
- `input_schema.json`、`output_schema.json`：从 API Skill 同步的调用契约；
- `examples.json` 和 `prompts/`：触发/不触发示例、参数采集、默认值确认、结果解释和错误处理提示；
- `adapter.py`：把已确认的参数草稿转换为 API Skill 请求；
- `skill_definition.snapshot.json` 和 `tests/`：生成时的定义快照及样例、缺参和期望请求测试数据。

因此，Agent 是自然语言编排和安全确认层，不是新的优化模型。它可以识别意图、收集缺失参数、展示默认值并要求确认，然后调用已有 API Skill；真正的计算、指标和阈值仍由模型契约与 API Skill 执行。Agent 包生成后还要通过结构校验，并在绑定的 API Skill 启用后才能启用。

### 变更后的生效规则

- 只改 Agent 文案、示例或参数采集提示：重新同步/校验 Agent 包即可，不会改变模型计算。
- 修改 SkillDefinition：校验通过后保存为新修订；旧修订保留，新的 `definition_hash` 进入审计记录。
- 修改模型输入输出、变量、约束或目标：先发布新的模型版本，再重新生成完整 Skill，并重新生成或同步 Agent 包。
- 停用 API Skill、模型契约不一致或 Agent 校验失败：Agent 不得进入可调用状态；结果仍可保留用于审计和人工分析。

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

`explanation_structured` 与 `evidence_package` 是当前唯一权威解释契约；顶层 `explanation` 只是同一解释的便捷摘要，不再额外生成或保留旧解释字段。运行时存储升级到 schema v4 后，载入时会一次性清理旧标记，后续保存的新数据不再写入旧标记。

