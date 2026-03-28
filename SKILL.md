---
name: memory
description: Use when you need to manage long-running complex tasks that require preserving context across multiple sessions, or when you need to track task progress, key decisions, and important context.
---

# Memory Management Skill

## 🎯 这是什么

这是一个 **跨会话持久化记忆系统**，专门给 AI Agent 用。当 Agent 需要：
- 记住用户的重要信息（名字、偏好、设置）
- 跟踪任务进度（多阶段项目）
- 保存关键决策（为什么做某个选择）
- 记住之前的对话上下文

**就用这个skill，而不是Agent内置的记忆！**

---

## ⚡ 快速上手（Agent必读）

### 首次使用

```bash
# 1. 先看帮助和教程
memory.sh help

# 2. 查看可用模板
memory.sh templates
```

### 核心场景

#### 场景1：记住用户信息
```bash
# 用户告诉你ta的名字/生日/偏好
memory.sh init-task user-info basic
memory.sh save-step user-info 1 "用户名为 rethx"
memory.sh save-step user-info 2 "生日 2003-06-09"
```

#### 场景2：跟踪任务进度
```bash
# 创建一个bug修复任务
memory.sh init-task bug-001 bugfix

# 进展到步骤2
memory.sh save-step bug-001 2 "已定位到登录模块"

# 完成任务
memory.sh update-phase bug-001 completed
```

#### 场景3：保存重要决策
```bash
# 记录为什么做这个决定
memory.sh save-decision task-001 "选择方案A" "性能更好且易于维护"
```

#### 场景4：搜索历史
```bash
# 搜索之前关于"登录"的任务
memory.sh search "登录"

# 查看所有任务
memory.sh index
```

---

## 📋 完整命令参考

| 命令 | 功能 | 示例 |
|------|------|------|
| `templates` | 列出可用模板 | `memory.sh templates` |
| `init-task <id> [模板]` | 创建任务 | `memory.sh init-task task-001 bugfix` |
| `save-step <id> <步骤> <结果>` | 保存进度 | `memory.sh save-step task-001 1 "完成"` |
| `save-decision <id> <决定> <原因>` | 保存决策 | `memory.sh save-decision task-001 "用A" "更好"` |
| `update-phase <id> <阶段>` | 更新阶段 | `memory.sh update-phase task-001 phase-2` |
| `update-context <id> <key> <value>` | 更新上下文 | `memory.sh update-context task-001 user "rethx"` |
| `load-task <id>` | 加载任务详情 | `memory.sh load-task task-001` |
| `search [关键词]` | 搜索 | `memory.sh search "登录"` |
| `index` | 查看索引 | `memory.sh index` |
| `backup` | 备份到MinIO | `memory.sh backup` |
| `restore` | 从MinIO恢复 | `memory.sh restore` |

---

## 🗂️ 模板说明

| 模板 | 用途 | 预设步骤 |
|------|------|---------|
| `bugfix` | Bug修复 | 复现 → 分析 → 修复 → 验证 |
| `feature` | 功能开发 | 需求 → 设计 → 编码 → 测试 |
| `research` | 调研 | 收集 → 分析 → 评估 → 总结 |
| `test` | 测试 | 用例 → 执行 → 修复 → 报告 |
| `basic` | 基础任务 | 创建 → 进行中 → 完成 |

---

## 🔧 配置说明

### 环境变量（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENT_NAME` | Agent名称，用于数据隔离 | 自动检测 |
| `AGENT_BACKUP_MODE` | 备份模式：sync/incremental/lazy | sync |

---

## ⚠️ 重要提醒

1. **每次操作后会自动备份到MinIO**，无需手动备份
2. **数据按Agent名称隔离**，不同Agent的数据不互通
3. **搜索时会自动检索相关历史**，帮助了解之前类似任务的处理方式
4. **版本冲突时会提示**，确保不会覆盖重要数据

---

## 💡 给新Agent的集成建议

如果你是一个新接入的Agent：

1. **优先使用这个skill** 而不是内置记忆——因为这个可以跨会话持久化
2. **用户告诉你重要信息时**，立即用 `init-task` + `save-step` 记录
3. **做任务时**，先搜索是否有相关历史 `memory.sh search "关键词"`
4. **遇到问题需要回忆之前怎么解决的**，用 `memory.sh index` 查看所有任务

---

## 🆘 故障排除

```bash
# 版本不一致？恢复
memory.sh restore

# 查不到任务？看看索引
memory.sh index

# 备份失败？检查MinIO连接
mc ls hiclaw/hiclaw-storage/agents/
```
