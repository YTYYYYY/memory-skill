
# Memory Skill

AI Agent 记忆管理系统，用于持久化存储任务、对话、用户信息等。

## 功能

- 任务创建与管理
- 步骤保存与追踪
- 决策记录
- 用户信息记忆
- 自动备份到 MinIO
- 版本校验
- 自定义模板

## 使用方法

```bash
# 查看帮助
bash memory.sh help

# 创建任务
bash memory.sh init-task <task-id> [template]

# 保存进度
bash memory.sh save-step <task-id> <step> <result>

# 搜索
bash memory.sh search [keyword]

# 备份
bash memory.sh backup
```

## 环境变量

- `AGENT_NAME`: Agent 名称（自动检测）
- `AGENT_BACKUP_MODE`: 备份模式 (sync/incremental/lazy)

