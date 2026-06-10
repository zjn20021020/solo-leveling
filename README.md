# Solo Leveling

**Solo Leveling** 是一个 OpenClaw 插件。它在每轮对话结束后静默观察:如果用户纠正了助手、或语气变得不耐烦/恼火,它就把"哪里出了偏差、最终怎么做对的"提炼成一条可复用的 Skill,存进 `~/.openclaw/.../skills/`。下次遇到类似情境,这条经验会被自动复用。

Skill 采用"**情境 → 方法**"结构,语言随对话走——中文对话生成中文 Skill,英文对话生成英文。

---

## 工作原理

```
每轮对话结束 (agent_end)
  ↓
[friction 扫描] 只看本轮用户原话,分两个维度打分:
    - corrections: 明确纠错次数
    - tone: calm / annoyed / agitated / hostile
  ↓
  未达阈值 → 结束
  达到阈值 ↓
[distill 蒸馏] 模型看对话 + friction 读数 + 已记录的 Skill 目录:
    - skip:   一次性,不值得沉淀
    - new:    写一条新 Skill
    - revise: 整条重写一条已有 Skill
  ↓
[vault 落盘] 临时文件 + 原子 rename 写入 SKILL.md
[registry 索引] 把 slug/摘要/时间写进 index.json
```

会话第一轮还会通过 `before_prompt_build` 注入一段 **recap**(自上次以来学到了什么),并可选生成一个删除脚本。

整个过程在对话结束后异步执行,**不干预当轮回复**。

---

## 架构要点

- **索引派,非扫描派**:用 `<stateDir>/index.json` 作为"学过哪些 Skill"的单一事实源,不每次扫目录、不解析 frontmatter。
- **原子写入**:SKILL.md 先写到 `.staging` 临时文件,校验通过后 `rename` 就位。写失败不留半成品,改写失败时原文件分毫未动——没有"回滚"这一步,因为原文件根本没被打开。
- **预算贪心上下文**:转录从最新消息往回取,累计到字符预算为止,整条消息保留或丢弃,不做中段截断。
- **括号深度扫描提取 JSON**:从模型回复里定位第一个配对完整的 `{...}`,比贪婪正则更稳(多个对象时不会误并)。
- **状态文件比对判定"新增"**:recap 用 `index.json` 里的 `lastRecapAt` 和每条 Skill 的 `touchedAt` 直接比对,不扫日志找标记。

---

## 安装

```bash
cd /path/to/solo-leveling
npm install
npm run build          # 编译 src → dist(安装时需要)
openclaw plugins install --link /path/to/solo-leveling
```

> **必须开启对话访问。** 非 bundled 插件读取对话内容需在 `openclaw.json` 显式授权:
>
> ```bash
> openclaw config set plugins.entries.solo-leveling.hooks.allowConversationAccess true
> ```
>
> 不开此项,插件仍正常加载、不报错,但 `agent_end` 拿不到消息,每轮静默跳过。

安装后重启网关:

```bash
openclaw gateway restart
```

---

## 配置

所有字段都有默认值,**最简配置是空 `{}`**。

```json
{
  "plugins": {
    "entries": {
      "solo-leveling": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "triggers": {
            "minTone": "annoyed",
            "modelOverride": null
          },
          "vault": {
            "author": "solo-leveling",
            "stateDirName": ".solo-leveling"
          },
          "recap": {
            "enabled": true,
            "writePurgeScript": true
          },
          "diagnostics": {
            "verbose": false
          }
        }
      }
    }
  }
}
```

| 字段 | 默认 | 说明 |
|------|------|------|
| `triggers.minTone` | `"annoyed"` | 触发复盘的最低语气强度。`annoyed` 最宽松,`hostile` 最严格。 |
| `triggers.modelOverride` | 跟随 agent 主模型 | 插件自身模型调用用的模型,格式 `"provider/model"`。用小模型可降延迟/成本。 |
| `vault.author` | `"solo-leveling"` | 写入每条 Skill `owner` frontmatter 的值。 |
| `vault.stateDirName` | `".solo-leveling"` | 存放 `index.json` 和删除脚本的目录(位于 skills 根下)。 |
| `recap.enabled` | `true` | 会话首轮是否展示"新学经验"摘要。 |
| `recap.writePurgeScript` | `true` | 是否同时生成可删除新 Skill 的脚本。 |
| `diagnostics.verbose` | `false` | 开启后在网关日志输出 trace 级诊断。 |

> 触发条件:`tone ≥ minTone` **或** `corrections ≥ 1`,满足其一即进入蒸馏。

---

## 模块一览

| 文件 | 职责 |
|------|------|
| `index.ts` | 入口;挂 `agent_end` + `before_prompt_build`,串联流水线 |
| `friction.ts` | 友好度扫描(纠错次数 + 语气) |
| `distill.ts` | 判定 skip/new/revise 并撰写 Skill 正文 |
| `recap.ts` | 会话首轮的"新学经验"摘要 + 删除脚本 |
| `registry.ts` | `index.json` 索引:已学 Skill 的元数据与时间线 |
| `vault.ts` | SKILL.md 的组装与原子写入 |
| `util/transcript.ts` | 用户原话提取 + 预算贪心转录 |
| `util/json-carve.ts` | 括号扫描提取 JSON |
| `util/reply-text.ts` | 从嵌入式 agent 回复中取文本 |

---

## 本地开发

```bash
npm run build       # 编译
npx tsc --noEmit    # 类型检查
npm test            # 跑测试(vitest)

# 改完代码后让网关加载新版本:
npm run build && openclaw gateway restart
```

---

## 授权

MIT
