
# Memory Skill

AI Agent 记忆管理系统，用于持久化存储任务、对话、用户信息等。

## 功能

- 任务创建与管理
- 步骤保存与追踪
- 决策记录
- 用户信息记忆
- 自动备份到 MinIO（未配置时自动回落到文件系统）
- 版本校验
- 自定义模板

## 使用方法

```bash
# 主入口（仓库根目录）
# ./memory.sh <command> ...
# 兼容旧版本入口：./scripts/memory.sh <command> ...

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

# 升级兼容（迁移旧目录、补旧入口）
bash memory.sh upgrade
```

## 环境变量

- `AGENT_NAME`: Agent 名称（自动检测）
- `AGENT_BACKUP_MODE`: 备份模式 (sync/incremental/lazy)
- `MEMORY_STORAGE_BACKEND`: 存储后端 (auto/minio/filesystem)
- `MEMORY_STORAGE_ROOT`: 文件系统备份目录（默认 `memory-bak/`）

## 存储路径说明

- 本地数据默认写入 **当前 Agent 工作目录** 下的 `memory/` 目录
- 远端备份优先 MinIO；不可用时回落到当前 Agent 工作目录下的 `memory-bak/`

## 升级说明

- 更新 skill 后可执行 `bash memory.sh upgrade` 进行一次显式兼容迁移
- 即使不手动执行，首次运行任意命令也会自动做兼容处理（旧备份目录迁移、旧入口补齐）

