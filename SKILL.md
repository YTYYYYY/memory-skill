---
name: memory
description: Use when you need to manage long-running complex tasks that require preserving context across multiple sessions, or when you need to track task progress, key decisions, and important context.
---

# Memory Management Skill

## Features

1. **自动记忆关联** - 任务开始时自动检索相关历史
2. **自动备份** - 每次操作后自动同步到 MinIO（按 Agent 隔离）
3. **记忆模板** - 常见任务类型快速初始化
4. **索引/搜索** - 快速定位任务

## 记忆模板

| 模板 | 用途 | 预设步骤 |
|------|------|---------|
| bugfix | Bug修复 | 复现 → 分析 → 修复 → 验证 |
| feature | 功能开发 | 需求 → 设计 → 编码 → 测试 |
| research | 调研 | 收集 → 分析 → 评估 → 总结 |
| test | 测试 | 用例 → 执行 → 修复 → 报告 |

## 搜索功能

```bash
# 按关键词搜索
memory.sh search "登录"

# 按标签搜索
memory.sh search "" "bug"

# 按时间范围搜索
memory.sh search "" "" "2026-03-01" "2026-03-31"

# 查看索引
memory.sh index
```

## 使用方式

```bash
# 创建任务（带模板）
memory.sh init-task task-001 bugfix

# 创建任务（带关键词，自动检索历史）
memory.sh init-task task-002 phase-1 "登录"

# 搜索
memory.sh search "关键词"
```

## 全部命令

- `templates` - 列出模板
- `init-task <id> [模板]` - 初始化任务
- `save-step <id> <步骤> <结果>` - 保存进度
- `search [关键词] [标签] [开始日期] [结束日期]` - 搜索
- `index` - 查看索引
- `backup` - 备份
- `restore` - 恢复
