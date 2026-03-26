#!/bin/bash
# Memory Management Script - JSON Format (Full Version)

ACTION=${1:-help}
TASK_ID=${2:-}
PROJECT_ID=${2:-}
DATA_DIR="memory"
INDEX_FILE="$DATA_DIR/index.json"

# 自动检测 AGENT_NAME：从工作目录路径推断
if [ -n "$AGENT_NAME" ]; then
    : # 使用显式设置的环境变量
elif [[ "$PWD" =~ /agents/([^/]+) ]]; then
    AGENT_NAME="${BASH_REMATCH[1]}"
else
    AGENT_NAME="default"
fi

MINIO_BUCKET="hiclaw/hiclaw-storage/agents"

mkdir -p "$DATA_DIR"

# 模板定义（继续使用之前的）
declare -A TEMPLATES
TEMPLATES[bugfix]='{"task_id":"TASK_ID","phase":"phase-1","created_at":"TIMESTAMP","template":"bugfix","completed_steps":[{"step":1,"name":"复现问题","result":"","timestamp":""},{"step":2,"name":"分析根因","result":"","timestamp":""},{"step":3,"name":"修复代码","result":"","timestamp":""},{"step":4,"name":"验证修复","result":"","timestamp":""}],"current_context":{},"key_decisions":[]}'
TEMPLATES[feature]='{"task_id":"TASK_ID","phase":"phase-1","created_at":"TIMESTAMP","template":"feature","completed_steps":[{"step":1,"name":"需求分析","result":"","timestamp":""},{"step":2,"name":"设计实现","result":"","timestamp":""},{"step":3,"name":"编写代码","result":"","timestamp":""},{"step":4,"name":"单元测试","result":"","timestamp":""},{"step":5,"name":"集成测试","result":"","timestamp":""}],"current_context":{},"key_decisions":[]}'
TEMPLATES[research]='{"task_id":"TASK_ID","phase":"phase-1","created_at":"TIMESTAMP","template":"research","completed_steps":[{"step":1,"name":"收集资料","result":"","timestamp":""},{"step":2,"name":"分析方案","result":"","timestamp":""},{"step":3,"name":"对比评估","result":"","timestamp":""},{"step":4,"name":"总结结论","result":"","timestamp":""}],"current_context":{},"key_decisions":[]}'
TEMPLATES[test]='{"task_id":"TASK_ID","phase":"phase-1","created_at":"TIMESTAMP","template":"test","completed_steps":[{"step":1,"name":"编写测试用例","result":"","timestamp":""},{"step":2,"name":"执行测试","result":"","timestamp":""},{"step":3,"name":"修复失败用例","result":"","timestamp":""},{"step":4,"name":"生成测试报告","result":"","timestamp":""}],"current_context":{},"key_decisions":[]}'

# 自定义模板存储文件
CUSTOM_TEMPLATES_FILE="$DATA_DIR/custom-templates.json"

# 加载自定义模板
load_custom_templates() {
    if [ -f "$CUSTOM_TEMPLATES_FILE" ]; then
        while IFS= read -r key value; do
            TEMPLATES["$key"]="$value"
        done < <(jq -r 'to_entries | .[] | "\(.key) \(.value)"' "$CUSTOM_TEMPLATES_FILE" 2>/dev/null)
    fi
}

# 保存自定义模板
save_custom_template() {
    local name=$1
    local steps=$2
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    local json="{\"task_id\":\"TASK_ID\",\"phase\":\"phase-1\",\"created_at\":\"TIMESTAMP\",\"template\":\"$name\",\"completed_steps\":["
    local first=true
    local idx=0
    for step in $(echo "$steps" | tr ',' '\n'); do
        if [ "$first" = true ]; then
            first=false
        else
            json+=","
        fi
        json+="{\"step\":$idx,\"name\":\"$step\",\"result\":\"\",\"timestamp\":\"\"}"
        idx=$((idx+1))
    done
    json+="],\"current_context\":{},\"key_decisions\":[]}"
    
    if [ ! -f "$CUSTOM_TEMPLATES_FILE" ]; then
        echo "{}" > "$CUSTOM_TEMPLATES_FILE"
    fi
    jq --arg n "$name" --arg v "$json" '. + {($n): $v}' "$CUSTOM_TEMPLATES_FILE" > tmp.json && mv tmp.json "$CUSTOM_TEMPLATES_FILE"
    TEMPLATES["$name"]="$json"
    echo "Saved custom template: $name"
}

list_templates() {
    echo "=== 可用模板 ==="
    echo "bugfix  - Bug修复任务"
    echo "feature - 功能开发任务"
    echo "research - 调研任务"
    echo "test    - 测试任务"
    echo ""
    echo "=== 自定义模板 ==="
    if [ -f "$CUSTOM_TEMPLATES_FILE" ]; then
        jq -r 'keys[]' "$CUSTOM_TEMPLATES_FILE" 2>/dev/null || echo "无"
    else
        echo "无"
    fi
}

# 更新索引
update_index() {
    local task_id=$1
    local phase=$2
    local tags=$3
    local keywords=$4
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    if [ ! -f "$INDEX_FILE" ]; then
        echo '{"tasks":{},"projects":{}}' > "$INDEX_FILE"
    fi
    
    jq --arg id "$task_id" --arg phase "$phase" --arg ts "$timestamp" --arg tags "$tags" --arg kw "$keywords" \
        '.tasks[$id] = {"phase": $phase, "updated_at": $ts, "tags": ($tags|split(",")), "keywords": ($kw|split(","))}' \
        "$INDEX_FILE" > tmp.json && mv tmp.json "$INDEX_FILE"
}

# 搜索索引
search_index() {
    local keyword=$1
    local tag=$2
    local date_from=$3
    local date_to=$4
    local phase=$5
    
    if [ ! -f "$INDEX_FILE" ]; then
        echo "索引文件不存在，请先创建任务"
        return 1
    fi
    
    # 按 phase 筛选
    if [ -n "$phase" ]; then
        echo "=== 筛选 Phase: $phase ==="
        jq -r ".tasks | to_entries | .[] | select(.value.phase == \"$phase\") | \"\(.key) | phase: \(.value.phase) | updated: \(.value.updated_at)\"" "$INDEX_FILE" 2>/dev/null
        return 0
    fi
    
    if [ -n "$keyword" ]; then
        echo "=== 搜索关键词: $keyword ==="
        local task_results=$(ls "$DATA_DIR"/task-*.json 2>/dev/null | xargs -I{} basename {} .json | grep -i "$keyword")
        if [ -n "$task_results" ]; then
            for task in $task_results; do
                local phase=$(jq -r '.phase // "unknown"' "$DATA_DIR/${task}.json" 2>/dev/null)
                local updated=$(jq -r '.updated_at // .created_at // "unknown"' "$DATA_DIR/${task}.json" 2>/dev/null)
                echo "- $task | phase: $phase | updated: $updated"
            done
        else
            echo "未找到匹配任务"
        fi
        return 0
    fi
    
    if [ -n "$tag" ]; then
        echo "=== 搜索标签: $tag ==="
        jq -r ".tasks | to_entries | .[] | select(.value.tags | index(\"$tag\")) | \"\(.key) | phase: \(.value.phase) | updated: \(.value.updated_at)\"" "$INDEX_FILE" 2>/dev/null
        return 0
    fi
    
    if [ -n "$date_from" ] && [ -n "$date_to" ]; then
        echo "=== 时间范围: $date_from ~ $date_to ==="
        jq -r ".tasks | to_entries | .[] | select(.value.updated_at >= \"$date_from\" and .value.updated_at <= \"$date_to\") | \"\(.key) | phase: \(.value.phase) | updated: \(.value.updated_at)\"" "$INDEX_FILE" 2>/dev/null
        return 0
    fi
    
    echo "=== 所有任务 ==="
    jq -r '.tasks | to_entries | .[] | "\(.key) | phase: \(.value.phase) | updated: \(.value.updated_at)"' "$INDEX_FILE" 2>/dev/null
}

# 备份模式
BACKUP_MODE=${AGENT_BACKUP_MODE:-sync}

# 版本校验
VERSION_FILE="$DATA_DIR/.version"
get_local_version() { [ -f "$VERSION_FILE" ] && cat "$VERSION_FILE" || echo "0"; }
get_remote_version() { mc stat "${MINIO_BUCKET}/${AGENT_NAME}/memory/.version" 2>/dev/null | grep "Size" | awk '{print $2}' || echo "0"; }
check_version() {
    if [ -z "$AGENT_NAME" ]; then return 1; fi
    local local_ver=$(get_local_version)
    local remote_ver=$(get_remote_version)
    if [ "$local_ver" != "$remote_ver" ]; then
        echo "[version mismatch] local: $local_ver, remote: $remote_ver"
        return 1
    fi
    echo "[version OK] $local_ver"
    return 0
}
update_version() { echo "$(date -u +"%Y%m%d%H%M%S")" > "$VERSION_FILE"; }

# 增量备份：只备份自上次备份后修改的文件
incremental_backup() {
    if [ -z "$AGENT_NAME" ]; then return 1; fi
    
    local last_backup_file="$DATA_DIR/.last_backup"
    local last_backup_ts="0"
    
    # 获取上次备份时间戳
    if [ -f "$last_backup_file" ]; then
        last_backup_ts=$(cat "$last_backup_file")
    fi
    
    # 找到所有自上次备份后修改的文件
    local changed_files=$(find "$DATA_DIR" -type f \( -name "*.json" -o -name "*.md" -o -name "*.log" \) -newer "$DATA_DIR/.version" -printf "%f\n" 2>/dev/null)
    
    if [ -z "$changed_files" ]; then
        echo "[增量备份] 无新文件需要备份"
        return 0
    fi
    
    local count=$(echo "$changed_files" | wc -l)
    echo "[增量备份] 发现 $count 个文件需要备份"
    
    # 逐个上传修改的文件
    for file in $changed_files; do
        mc cp "$DATA_DIR/$file" "${MINIO_BUCKET}/${AGENT_NAME}/memory/" 2>/dev/null
    done
    
    # 更新备份时间戳
    echo "$(date -u +"%Y%m%d%H%M%S")" > "$last_backup_file"
    update_version
    echo "[增量备份] 完成"
}

# 全量备份
full_backup() {
    if [ -z "$AGENT_NAME" ]; then return 1; fi
    mc cp -r "$DATA_DIR/" "${MINIO_BUCKET}/${AGENT_NAME}/memory/" 2>/dev/null
    update_version
    echo "[全量备份] 完成"
}

# 备份（根据模式选择增量或全量）
backup_to_minio() {
    if [ -z "$AGENT_NAME" ]; then return 1; fi
    if [ "$BACKUP_MODE" = "lazy" ]; then
        return 0  # lazy 模式完全跳过备份
    fi
    if [ "$BACKUP_MODE" = "incremental" ]; then
        incremental_backup
    else
        full_backup
    fi
}

restore_from_minio() {
    if [ -z "$AGENT_NAME" ]; then return 1; fi
    mc cp -r "${MINIO_BUCKET}/${AGENT_NAME}/memory/" "$DATA_DIR/" 2>/dev/null
}

# 加载自定义模板
load_custom_templates

case $ACTION in
  templates)
    list_templates
    ;;

  add-template)
    TEMPLATE_NAME=$2
    STEPS=$3
    if [ -z "$TEMPLATE_NAME" ] || [ -z "$STEPS" ]; then
        echo "Usage: $0 add-template <name> <step1,step2,...>"
        exit 1
    fi
    
    # 检测重复模板
    if [ -f "$CUSTOM_TEMPLATES_FILE" ] && jq -e ".${TEMPLATE_NAME}" "$CUSTOM_TEMPLATES_FILE" >/dev/null 2>&1; then
        echo "[错误] 模板 $TEMPLATE_NAME 已存在，使用 'edit-template' 修改或 'delete-template' 删除"
        exit 1
    fi
    
    save_custom_template "$TEMPLATE_NAME" "$STEPS"
    backup_to_minio
    ;;

  edit-template)
    TEMPLATE_NAME=$2
    STEPS=$3
    if [ -z "$TEMPLATE_NAME" ] || [ -z "$STEPS" ]; then
        echo "Usage: $0 edit-template <name> <step1,step2,...>"
        exit 1
    fi
    
    if [ ! -f "$CUSTOM_TEMPLATES_FILE" ] || ! jq -e ".${TEMPLATE_NAME}" "$CUSTOM_TEMPLATES_FILE" >/dev/null 2>&1; then
        echo "[错误] 模板 $TEMPLATE_NAME 不存在，请使用 'add-template' 创建"
        exit 1
    fi
    
    save_custom_template "$TEMPLATE_NAME" "$STEPS"
    echo "Updated template: $TEMPLATE_NAME"
    backup_to_minio
    ;;

  delete-template)
    TEMPLATE_NAME=$2
    if [ -z "$TEMPLATE_NAME" ]; then
        echo "Usage: $0 delete-template <name>"
        exit 1
    fi
    
    if [ ! -f "$CUSTOM_TEMPLATES_FILE" ] || ! jq -e ".${TEMPLATE_NAME}" "$CUSTOM_TEMPLATES_FILE" >/dev/null 2>&1; then
        echo "[错误] 模板 $TEMPLATE_NAME 不存在"
        exit 1
    fi
    
    jq "del(.\"${TEMPLATE_NAME}\")" "$CUSTOM_TEMPLATES_FILE" > tmp.json && mv tmp.json "$CUSTOM_TEMPLATES_FILE"
    echo "Deleted template: $TEMPLATE_NAME"
    backup_to_minio
    ;;

  init-task)
    if [ -z "$TASK_ID" ]; then
      echo "Usage: $0 init-task <task-id> [template] [keywords]"
      exit 1
    fi

    # 检测重复任务
    if [ -f "$DATA_DIR/task-$TASK_ID.json" ]; then
      echo "[错误] 任务 $TASK_ID 已存在，请使用其他 ID 或先删除"
      exit 1
    fi

    TEMPLATE=${3:-}
    KEYWORDS=${4:-}
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    if [ -n "$KEYWORDS" ]; then
        echo "=== 自动检索相关历史 ==="
        ls "$DATA_DIR"/task-*.json 2>/dev/null | xargs -I{} basename {} .json | grep -i "$KEYWORDS" || echo "未找到"
        echo ""
    fi
    
    if [[ "$TEMPLATE" =~ ^(bugfix|feature|research|test)$ ]]; then
        JSON="${TEMPLATES[$TEMPLATE]}"
        JSON="${JSON//TASK_ID/$TASK_ID}"
        JSON="${JSON//TIMESTAMP/$TIMESTAMP}"
        echo "$JSON" > "$DATA_DIR/task-$TASK_ID.json"
        echo "Created task with template '$TEMPLATE'"
        update_index "$TASK_ID" "phase-1" "$TEMPLATE" "$KEYWORDS"
    else
        PHASE=${TEMPLATE:-phase-1}
        cat > "$DATA_DIR/task-$TASK_ID.json" <<EOF
{"task_id":"$TASK_ID","phase":"$PHASE","created_at":"$TIMESTAMP","completed_steps":[],"current_context":{},"key_decisions":[],"keywords":["$KEYWORDS"]}
EOF
        echo "Created task: $TASK_ID"
        update_index "$TASK_ID" "$PHASE" "" "$KEYWORDS"
    fi
    backup_to_minio
    ;;

  init-project)
    PROJECT_ID=${2:-}
    if [ -z "$PROJECT_ID" ]; then exit 1; fi
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat > "$DATA_DIR/project-$PROJECT_ID.json" <<EOF
{"project_id":"$PROJECT_ID","created_at":"$TIMESTAMP","background":"","goals":[],"team":[],"constraints":[]}
EOF
    echo "Created project: $PROJECT_ID"
    backup_to_minio
    ;;

  save-step)
    TASK_ID=$2; STEP=$3; RESULT=$4
    if [ -z "$TASK_ID" ] || [ -z "$STEP" ]; then exit 1; fi
    if [ ! -f "$DATA_DIR/task-$TASK_ID.json" ]; then echo "Not found"; exit 1; fi
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    STEP_DEC=$((10#$STEP))
    jq --arg step "$STEP_DEC" --arg result "$RESULT" --arg ts "$TIMESTAMP" \
        '.completed_steps += [{"step": ($step|tonumber), "result": $result, "timestamp": $ts}]' \
        "$DATA_DIR/task-$TASK_ID.json" > tmp.json && mv tmp.json "$DATA_DIR/task-$TASK_ID.json"
    echo "Saved step $STEP"
    update_index "$TASK_ID" "" "" ""
    backup_to_minio
    ;;

  save-decision)
    TASK_ID=$2; DECISION=$3; REASON=$4
    if [ -z "$TASK_ID" ] || [ -z "$DECISION" ]; then exit 1; fi
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    jq --arg d "$DECISION" --arg r "$REASON" --arg ts "$TIMESTAMP" \
        '.key_decisions += [{"decision": $d, "why": $r, "timestamp": $ts}]' \
        "$DATA_DIR/task-$TASK_ID.json" > tmp.json && mv tmp.json "$DATA_DIR/task-$TASK_ID.json"
    echo "Saved decision"
    backup_to_minio
    ;;

  update-phase)
    TASK_ID=$2; PHASE=$3
    if [ -z "$TASK_ID" ] || [ -z "$PHASE" ]; then exit 1; fi
    jq --arg p "$PHASE" '.phase = $p' "$DATA_DIR/task-$TASK_ID.json" > tmp.json && mv tmp.json "$DATA_DIR/task-$TASK_ID.json"
    update_index "$TASK_ID" "$PHASE" "" ""
    backup_to_minio
    ;;

  update-context)
    TASK_ID=$2; KEY=$3; VALUE=$4
    if [ -z "$TASK_ID" ] || [ -z "$KEY" ]; then exit 1; fi
    jq --arg k "$KEY" --arg v "$VALUE" '.current_context[$k] = $v' "$DATA_DIR/task-$TASK_ID.json" > tmp.json && mv tmp.json "$DATA_DIR/task-$TASK_ID.json"
    backup_to_minio
    ;;

  load-task)
    if [ -z "$TASK_ID" ]; then exit 1; fi
    [ -f "$DATA_DIR/task-$TASK_ID.json" ] && cat "$DATA_DIR/task-$TASK_ID.json" || echo "Not found"
    ;;

  load-project)
    if [ -z "$PROJECT_ID" ]; then exit 1; fi
    [ -f "$DATA_DIR/project-$PROJECT_ID.json" ] && cat "$DATA_DIR/project-$PROJECT_ID.json" || echo "Not found"
    ;;

  list)
    echo "=== Tasks ==="
    ls "$DATA_DIR"/task-*.json 2>/dev/null || echo "No tasks"
    echo "=== Projects ==="
    ls "$DATA_DIR"/project-*.json 2>/dev/null || echo "No projects"
    ;;

  search)
    KEYWORD=$2; TAG=$3; DATE_FROM=$4; DATE_TO=$5; PHASE=$6
    search_index "$KEYWORD" "$TAG" "$DATE_FROM" "$DATE_TO" "$PHASE"
    ;;

  index)
    if [ -f "$INDEX_FILE" ]; then
        if jq -e '.tasks | length > 0' "$INDEX_FILE" >/dev/null 2>&1; then
            cat "$INDEX_FILE"
        else
            echo "索引为空"
        fi
    else
        echo "索引文件不存在，请先创建任务"
    fi
    ;;

  backup)
    if [ "$BACKUP_MODE" = "lazy" ]; then
        echo "执行手动备份..."
    fi
    backup_to_minio
    ;;

  restore)
    restore_from_minio
    ;;

  check)
    check_version
    ;;

  delete-task)
    if [ -z "$TASK_ID" ]; then exit 1; fi
    rm -f "$DATA_DIR/task-$TASK_ID.json"
    jq "del(.\"$TASK_ID\")" "$INDEX_FILE" > tmp.json && mv tmp.json "$INDEX_FILE" 2>/dev/null
    backup_to_minio
    ;;

  delete-project)
    PROJECT_ID=${2:-}
    if [ -z "$PROJECT_ID" ]; then exit 1; fi
    rm -f "$DATA_DIR/project-$PROJECT_ID.json"
    backup_to_minio
    ;;

  help|*)
    echo "Memory Management Script (Auto-detect Agent)"
    echo ""
    echo "当前 Agent: $AGENT_NAME"
    echo "备份模式: $BACKUP_MODE (sync/incremental/lazy)"
    echo ""
    echo "Commands:"
    echo "  templates              - 列出模板（含自定义）"
    echo "  add-template <name> <steps> - 添加自定义模板"
    echo "  edit-template <name> <steps> - 修改自定义模板"
    echo "  delete-template <name> - 删除自定义模板"
    echo "  init-task <id> [tmpl] - 创建任务（检测重复）"
    echo "  init-project <id>    - 创建项目"
    echo "  save-step <id> <s> <r>- 保存进度"
    echo "  save-decision <id> <d> <r> - 保存决策"
    echo "  update-phase <id> <p> - 更新阶段"
    echo "  update-context <id> <k> <v> - 更新上下文"
    echo "  load-task <id>       - 加载任务"
    echo "  load-project <id>   - 加载项目"
    echo "  list                 - 列出所有"
    echo "  search [keyword] [tag] [date] [phase] - 搜索"
    echo "  index                - 查看索引"
    echo "  backup               - 备份 (全量/增量)"
    echo "  restore              - 恢复"
    echo "  check                - 版本校验"
    echo "  delete-task <id>    - 删除任务"
    echo ""
    echo "环境变量:"
    echo "  AGENT_NAME           - Agent 名称"
    echo "  AGENT_BACKUP_MODE    - 备份模式: sync/incremental/lazy"
    ;;
esac
