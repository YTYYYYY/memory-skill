#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ACTION = process.argv[2] || "help";
const CWD = process.cwd();
const DATA_DIR = path.join(CWD, "memory");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const CUSTOM_TEMPLATES_FILE = path.join(DATA_DIR, "custom-templates.json");
const VERSION_FILE = path.join(DATA_DIR, ".version");

const AGENT_NAME = detectAgentName();
const BACKUP_MODE = (process.env.AGENT_BACKUP_MODE || "sync").toLowerCase();
const STORAGE_BACKEND_PREF = (process.env.MEMORY_STORAGE_BACKEND || "auto").toLowerCase();
const MINIO_BUCKET = process.env.MEMORY_MINIO_BUCKET || "hiclaw/hiclaw-storage/agents";
const FILESYSTEM_REMOTE_DIR = path.resolve(
  process.env.MEMORY_STORAGE_ROOT || path.join(CWD, "memory-bak"),
);

let backendCache = null;
let fallbackWarned = false;

const BUILTIN_TEMPLATES = {
  basic: ["创建", "进行中", "完成"],
  bugfix: ["复现问题", "分析根因", "修复代码", "验证修复"],
  feature: ["需求分析", "设计实现", "编写代码", "单元测试", "集成测试"],
  research: ["收集资料", "分析方案", "对比评估", "总结结论"],
  test: ["编写测试用例", "执行测试", "修复失败用例", "生成测试报告"],
};

ensureDir(DATA_DIR);
ensureUpgradeCompatibility({ verbose: false });

const commands = {
  templates: () => listTemplates(),
  "add-template": () => addTemplate(process.argv[3], process.argv[4]),
  "edit-template": () => editTemplate(process.argv[3], process.argv[4]),
  "delete-template": () => deleteTemplate(process.argv[3]),
  "init-task": () => initTask(process.argv[3], process.argv[4], process.argv[5]),
  "init-project": () => initProject(process.argv[3]),
  "save-step": () => saveStep(process.argv[3], process.argv[4], process.argv[5] || ""),
  "save-decision": () => saveDecision(process.argv[3], process.argv[4], process.argv[5] || ""),
  "update-phase": () => updatePhase(process.argv[3], process.argv[4]),
  "update-context": () => updateContext(process.argv[3], process.argv[4], process.argv[5] || ""),
  "load-task": () => loadTask(process.argv[3]),
  "load-project": () => loadProject(process.argv[3]),
  list: () => listAll(),
  search: () => search(process.argv[3] || "", process.argv[4] || "", process.argv[5] || "", process.argv[6] || "", process.argv[7] || ""),
  index: () => showIndex(),
  backup: () => backupToRemote(true),
  restore: () => restoreFromRemote(),
  upgrade: () => runUpgradeCommand(),
  check: () => {
    process.exitCode = checkVersion() ? 0 : 1;
  },
  "delete-task": () => deleteTask(process.argv[3]),
  "delete-project": () => deleteProject(process.argv[3]),
  help: () => showHelp(),
};

(commands[ACTION] || commands.help)();

function detectAgentName() {
  if (process.env.AGENT_NAME) return process.env.AGENT_NAME;
  const match = CWD.replace(/\\/g, "/").match(/\/agents\/([^/]+)/);
  return match ? match[1] : "default";
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function nowVersion() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return structuredClone(fallback);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`[错误] JSON 解析失败: ${filePath}\n${error.message}`);
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseCsv(input) {
  if (!input) return [];
  return String(input).split(",").map((s) => s.trim()).filter(Boolean);
}

function taskPath(taskId) {
  return path.join(DATA_DIR, `task-${taskId}.json`);
}

function projectPath(projectId) {
  return path.join(DATA_DIR, `project-${projectId}.json`);
}

function ensureIndex() {
  const index = readJson(INDEX_FILE, { tasks: {}, projects: {} });
  if (!index.tasks || typeof index.tasks !== "object") index.tasks = {};
  if (!index.projects || typeof index.projects !== "object") index.projects = {};
  return index;
}

function loadCustomTemplates() {
  const raw = readJson(CUSTOM_TEMPLATES_FILE, {});
  const result = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value && Array.isArray(value.steps)) {
      result[name] = value.steps.map((x) => String(x));
      continue;
    }
    if (value && Array.isArray(value.completed_steps)) {
      result[name] = value.completed_steps.map((step, idx) => String(step.name || `步骤${idx + 1}`));
      continue;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && Array.isArray(parsed.completed_steps)) {
          result[name] = parsed.completed_steps.map((step, idx) => String(step.name || `步骤${idx + 1}`));
        }
      } catch (_e) {}
    }
  }
  return result;
}

function getTemplateSteps(templateName) {
  if (!templateName) return null;
  if (BUILTIN_TEMPLATES[templateName]) return BUILTIN_TEMPLATES[templateName];
  const custom = loadCustomTemplates();
  return custom[templateName] || null;
}

function writeTask(task) {
  writeJson(taskPath(task.task_id), task);
  updateIndexFromTask(task.task_id);
}

function updateIndexFromTask(taskId) {
  const file = taskPath(taskId);
  if (!fs.existsSync(file)) return;
  const task = readJson(file, {});
  const index = ensureIndex();
  const prev = index.tasks[taskId] || {};
  index.tasks[taskId] = {
    phase: task.phase || prev.phase || "phase-1",
    updated_at: task.updated_at || task.created_at || nowIso(),
    tags: task.template ? [task.template] : (prev.tags || []),
    keywords: Array.isArray(task.keywords) ? task.keywords : (prev.keywords || []),
  };
  writeJson(INDEX_FILE, index);
}

function updateIndexFromProject(projectId) {
  const file = projectPath(projectId);
  if (!fs.existsSync(file)) return;
  const project = readJson(file, {});
  const index = ensureIndex();
  index.projects[projectId] = { updated_at: project.updated_at || project.created_at || nowIso() };
  writeJson(INDEX_FILE, index);
}

function listTemplates() {
  console.log("=== 可用模板 ===");
  for (const [name, steps] of Object.entries(BUILTIN_TEMPLATES)) {
    console.log(`${name.padEnd(8, " ")}- ${steps.join(" -> ")}`);
  }
  console.log("");
  console.log("=== 自定义模板 ===");
  const custom = loadCustomTemplates();
  const names = Object.keys(custom).sort();
  if (!names.length) {
    console.log("无");
    return;
  }
  names.forEach((name) => console.log(`${name} - ${custom[name].join(" -> ")}`));
}

function addTemplate(name, stepsCsv) {
  if (!name || !stepsCsv) fail(`Usage: ${invocation()} add-template <name> <step1,step2,...>`);
  if (BUILTIN_TEMPLATES[name] || getTemplateSteps(name)) fail(`[错误] 模板 ${name} 已存在`);
  const steps = parseCsv(stepsCsv);
  if (!steps.length) fail("[错误] 模板步骤不能为空");
  const custom = readJson(CUSTOM_TEMPLATES_FILE, {});
  custom[name] = { steps, updated_at: nowIso() };
  writeJson(CUSTOM_TEMPLATES_FILE, custom);
  console.log(`Saved custom template: ${name}`);
  backupToRemote(false);
}

function editTemplate(name, stepsCsv) {
  if (!name || !stepsCsv) fail(`Usage: ${invocation()} edit-template <name> <step1,step2,...>`);
  if (BUILTIN_TEMPLATES[name]) fail(`[错误] 内置模板 ${name} 不可编辑`);
  const custom = readJson(CUSTOM_TEMPLATES_FILE, {});
  if (!Object.prototype.hasOwnProperty.call(custom, name)) fail(`[错误] 模板 ${name} 不存在`);
  const steps = parseCsv(stepsCsv);
  if (!steps.length) fail("[错误] 模板步骤不能为空");
  custom[name] = { steps, updated_at: nowIso() };
  writeJson(CUSTOM_TEMPLATES_FILE, custom);
  console.log(`Updated template: ${name}`);
  backupToRemote(false);
}

function deleteTemplate(name) {
  if (!name) fail(`Usage: ${invocation()} delete-template <name>`);
  const custom = readJson(CUSTOM_TEMPLATES_FILE, {});
  if (!Object.prototype.hasOwnProperty.call(custom, name)) fail(`[错误] 模板 ${name} 不存在`);
  delete custom[name];
  writeJson(CUSTOM_TEMPLATES_FILE, custom);
  console.log(`Deleted template: ${name}`);
  backupToRemote(false);
}

function initTask(taskId, templateArg, keywordsArg) {
  if (!taskId) fail(`Usage: ${invocation()} init-task <task-id> [template] [keywords]`);
  if (fs.existsSync(taskPath(taskId))) fail(`[错误] 任务 ${taskId} 已存在，请使用其他 ID 或先删除`);
  if (keywordsArg) {
    console.log("=== 自动检索相关历史 ===");
    printSearchResults(findTasks(keywordsArg, "", "", "", ""));
    console.log("");
  }
  const ts = nowIso();
  const steps = getTemplateSteps(templateArg);
  const task = steps
    ? { task_id: taskId, phase: "phase-1", created_at: ts, updated_at: ts, template: templateArg, completed_steps: steps.map((name, i) => ({ step: i + 1, name, result: "", timestamp: "" })), current_context: {}, key_decisions: [], keywords: parseCsv(keywordsArg) }
    : { task_id: taskId, phase: templateArg || "phase-1", created_at: ts, updated_at: ts, completed_steps: [], current_context: {}, key_decisions: [], keywords: parseCsv(keywordsArg) };
  writeTask(task);
  console.log(steps ? `Created task with template '${templateArg}'` : `Created task: ${taskId}`);
  backupToRemote(false);
}

function initProject(projectId) {
  if (!projectId) fail(`Usage: ${invocation()} init-project <project-id>`);
  if (fs.existsSync(projectPath(projectId))) fail(`[错误] 项目 ${projectId} 已存在`);
  const ts = nowIso();
  writeJson(projectPath(projectId), { project_id: projectId, created_at: ts, updated_at: ts, background: "", goals: [], team: [], constraints: [] });
  updateIndexFromProject(projectId);
  console.log(`Created project: ${projectId}`);
  backupToRemote(false);
}

function loadTaskOrFail(taskId) {
  if (!taskId) fail("task id is required");
  const file = taskPath(taskId);
  if (!fs.existsSync(file)) fail("Not found");
  return readJson(file, {});
}

function saveStep(taskId, stepText, result) {
  if (!taskId || !stepText) fail(`Usage: ${invocation()} save-step <task-id> <step> <result>`);
  const step = Number(stepText);
  if (!Number.isInteger(step) || step <= 0) fail("[错误] step 必须是正整数");
  const task = loadTaskOrFail(taskId);
  if (!Array.isArray(task.completed_steps)) task.completed_steps = [];
  const ts = nowIso();
  const existing = task.completed_steps.find((x) => Number(x.step) === step);
  if (existing) {
    existing.result = result;
    existing.timestamp = ts;
  } else {
    task.completed_steps.push({ step, name: `步骤${step}`, result, timestamp: ts });
    task.completed_steps.sort((a, b) => Number(a.step) - Number(b.step));
  }
  task.updated_at = ts;
  writeTask(task);
  console.log(`Saved step ${step}`);
  backupToRemote(false);
}

function saveDecision(taskId, decision, reason) {
  if (!taskId || !decision) fail(`Usage: ${invocation()} save-decision <task-id> <decision> <reason>`);
  const task = loadTaskOrFail(taskId);
  if (!Array.isArray(task.key_decisions)) task.key_decisions = [];
  task.key_decisions.push({ decision, why: reason || "", timestamp: nowIso() });
  task.updated_at = nowIso();
  writeTask(task);
  console.log("Saved decision");
  backupToRemote(false);
}

function updatePhase(taskId, phase) {
  if (!taskId || !phase) fail(`Usage: ${invocation()} update-phase <task-id> <phase>`);
  const task = loadTaskOrFail(taskId);
  task.phase = phase;
  task.updated_at = nowIso();
  writeTask(task);
  backupToRemote(false);
}

function updateContext(taskId, key, value) {
  if (!taskId || !key) fail(`Usage: ${invocation()} update-context <task-id> <key> <value>`);
  const task = loadTaskOrFail(taskId);
  if (!task.current_context || typeof task.current_context !== "object") task.current_context = {};
  task.current_context[key] = value;
  task.updated_at = nowIso();
  writeTask(task);
  backupToRemote(false);
}

function loadTask(taskId) {
  if (!taskId) fail(`Usage: ${invocation()} load-task <task-id>`);
  const file = taskPath(taskId);
  console.log(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "Not found");
}

function loadProject(projectId) {
  if (!projectId) fail(`Usage: ${invocation()} load-project <project-id>`);
  const file = projectPath(projectId);
  console.log(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "Not found");
}

function listAll() {
  console.log("=== Tasks ===");
  const tasks = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((n) => /^task-.*\.json$/.test(n)) : [];
  console.log(tasks.length ? tasks.join("\n") : "No tasks");
  console.log("=== Projects ===");
  const projects = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((n) => /^project-.*\.json$/.test(n)) : [];
  console.log(projects.length ? projects.join("\n") : "No projects");
}

function findTasks(keyword, tag, dateFrom, dateTo, phase) {
  const index = ensureIndex();
  return Object.entries(index.tasks).filter(([taskId, meta]) => {
    if (phase && meta.phase !== phase) return false;
    if (tag && !(meta.tags || []).includes(tag)) return false;
    if (dateFrom && dateTo) {
      const u = meta.updated_at || "";
      if (u < dateFrom || u > dateTo) return false;
    }
    if (!keyword) return true;
    const taskFile = taskPath(taskId);
    const payload = fs.existsSync(taskFile) ? fs.readFileSync(taskFile, "utf8") : "";
    const text = [taskId, ...(meta.tags || []), ...(meta.keywords || []), payload].join("\n").toLowerCase();
    return text.includes(keyword.toLowerCase());
  }).map(([taskId, meta]) => ({ taskId, phase: meta.phase || "unknown", updatedAt: meta.updated_at || "unknown" }));
}

function printSearchResults(results) {
  if (!results.length) {
    console.log("未找到匹配任务");
    return;
  }
  results.forEach((r) => console.log(`- ${r.taskId} | phase: ${r.phase} | updated: ${r.updatedAt}`));
}

function search(keyword, tag, dateFrom, dateTo, phase) {
  if (!fs.existsSync(INDEX_FILE)) {
    console.log("索引文件不存在，请先创建任务");
    return;
  }
  if (phase) console.log(`=== 筛选 Phase: ${phase} ===`);
  else if (keyword) console.log(`=== 搜索关键词: ${keyword} ===`);
  else if (tag) console.log(`=== 搜索标签: ${tag} ===`);
  else if (dateFrom && dateTo) console.log(`=== 时间范围: ${dateFrom} ~ ${dateTo} ===`);
  else console.log("=== 所有任务 ===");
  printSearchResults(findTasks(keyword, tag, dateFrom, dateTo, phase));
}

function showIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    console.log("索引文件不存在，请先创建任务");
    return;
  }
  const index = ensureIndex();
  if (!Object.keys(index.tasks).length && !Object.keys(index.projects).length) {
    console.log("索引为空");
    return;
  }
  console.log(JSON.stringify(index, null, 2));
}

function deleteTask(taskId) {
  if (!taskId) fail(`Usage: ${invocation()} delete-task <id>`);
  fs.rmSync(taskPath(taskId), { force: true });
  const index = ensureIndex();
  delete index.tasks[taskId];
  writeJson(INDEX_FILE, index);
  backupToRemote(false);
}

function deleteProject(projectId) {
  if (!projectId) fail(`Usage: ${invocation()} delete-project <id>`);
  fs.rmSync(projectPath(projectId), { force: true });
  const index = ensureIndex();
  delete index.projects[projectId];
  writeJson(INDEX_FILE, index);
  backupToRemote(false);
}

function commandExists(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function runUpgradeCommand() {
  const changes = ensureUpgradeCompatibility({ verbose: true });
  if (!changes.length) {
    console.log("[upgrade] 无需迁移，当前布局已兼容");
    return;
  }
  console.log(`[upgrade] 完成 ${changes.length} 项兼容处理`);
}

function ensureUpgradeCompatibility({ verbose }) {
  const changes = [];
  ensureDir(path.join(CWD, "scripts"));
  const legacyShimPath = path.join(CWD, "scripts", "memory.sh");
  if (!fs.existsSync(legacyShimPath)) {
    const shim = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
      "exec \"$SCRIPT_DIR/../memory.sh\" \"$@\"",
      "",
    ].join("\n");
    fs.writeFileSync(legacyShimPath, shim, "utf8");
    try {
      fs.chmodSync(legacyShimPath, 0o755);
    } catch (_e) {}
    changes.push(`创建兼容入口: ${legacyShimPath}`);
  }

  const legacyBackupCandidates = [
    path.join(CWD, ".memory-storage", "agents", AGENT_NAME, "memory"),
    path.join(CWD, ".memory-storage", "agents", "default", "memory"),
    path.join(CWD, ".tmp-storage", "agents", AGENT_NAME, "memory"),
    path.join(CWD, ".tmp-storage", "agents", "default", "memory"),
  ];

  for (const sourceDir of legacyBackupCandidates) {
    if (!fs.existsSync(sourceDir)) continue;
    if (path.resolve(sourceDir) === path.resolve(FILESYSTEM_REMOTE_DIR)) continue;
    const migrated = mergeDirIfMissing(sourceDir, FILESYSTEM_REMOTE_DIR);
    if (migrated > 0) {
      changes.push(`迁移历史备份 ${sourceDir} -> ${FILESYSTEM_REMOTE_DIR} (${migrated} 文件)`);
    }
  }

  if (verbose) {
    changes.forEach((line) => console.log(`[upgrade] ${line}`));
  }
  return changes;
}

function mergeDirIfMissing(source, target) {
  ensureDir(target);
  let copied = 0;
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copied += mergeDirIfMissing(src, dst);
      continue;
    }
    if (!fs.existsSync(dst)) {
      ensureDir(path.dirname(dst));
      fs.copyFileSync(src, dst);
      copied += 1;
    }
  }
  return copied;
}

function minioAvailable() {
  if (!commandExists("mc")) return false;
  const result = spawnSync("mc", ["ls", MINIO_BUCKET], { encoding: "utf8" });
  return result.status === 0;
}

function activeBackend() {
  if (backendCache) return backendCache;
  if (STORAGE_BACKEND_PREF === "filesystem") backendCache = "filesystem";
  else if (STORAGE_BACKEND_PREF === "minio") backendCache = minioAvailable() ? "minio" : "filesystem";
  else backendCache = minioAvailable() ? "minio" : "filesystem";
  if (STORAGE_BACKEND_PREF === "minio" && backendCache === "filesystem" && !fallbackWarned) {
    console.warn("[存储] MinIO 不可用，已回退到文件系统");
    fallbackWarned = true;
  }
  return backendCache;
}

function readLocalVersion() {
  return fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, "utf8").trim() || "0" : "0";
}

function readRemoteVersion() {
  if (activeBackend() === "minio") {
    const r = spawnSync("mc", ["cat", `${MINIO_BUCKET}/${AGENT_NAME}/memory/.version`], { encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").trim() || "0" : "0";
  }
  const f = path.join(FILESYSTEM_REMOTE_DIR, ".version");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() || "0" : "0";
}

function warnVersionMismatch(stage) {
  const local = readLocalVersion();
  const remote = readRemoteVersion();
  if (local !== remote && remote !== "0") console.warn(`[version mismatch] ${stage}: local=${local}, remote=${remote}`);
}

function backupToRemote(manual) {
  if (BACKUP_MODE === "lazy" && !manual) return;
  warnVersionMismatch("备份前");
  fs.writeFileSync(VERSION_FILE, `${nowVersion()}\n`, "utf8");
  if (activeBackend() === "minio") {
    const r = spawnSync("mc", ["mirror", "--overwrite", DATA_DIR, `${MINIO_BUCKET}/${AGENT_NAME}/memory`], { encoding: "utf8" });
    if (r.status !== 0) fail(`[错误] MinIO 备份失败: ${(r.stderr || r.stdout || "").trim()}`);
    console.log("[备份] 已同步到 MinIO");
    return;
  }
  ensureDir(FILESYSTEM_REMOTE_DIR);
  mirrorDir(DATA_DIR, FILESYSTEM_REMOTE_DIR);
  console.log(`[备份] 已保存到文件系统: ${FILESYSTEM_REMOTE_DIR}`);
}

function mirrorDir(source, target) {
  ensureDir(target);
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) {
      mirrorDir(src, dst);
      continue;
    }
    if (!fs.existsSync(dst) || fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs + 1 || fs.statSync(src).size !== fs.statSync(dst).size) {
      ensureDir(path.dirname(dst));
      fs.copyFileSync(src, dst);
    }
  }
}

function copyDirOverwrite(source, target) {
  ensureDir(target);
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirOverwrite(src, dst);
      continue;
    }
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function restoreFromRemote() {
  warnVersionMismatch("恢复前");
  if (activeBackend() === "minio") {
    const r = spawnSync("mc", ["mirror", "--overwrite", `${MINIO_BUCKET}/${AGENT_NAME}/memory`, DATA_DIR], { encoding: "utf8" });
    if (r.status !== 0) fail(`[错误] MinIO 恢复失败: ${(r.stderr || r.stdout || "").trim()}`);
    console.log("[恢复] 已从 MinIO 恢复");
    return;
  }
  if (!fs.existsSync(FILESYSTEM_REMOTE_DIR)) {
    console.log("[恢复] 未找到文件系统备份");
    return;
  }
  ensureDir(DATA_DIR);
  copyDirOverwrite(FILESYSTEM_REMOTE_DIR, DATA_DIR);
  console.log("[恢复] 已从文件系统恢复");
}

function checkVersion() {
  const local = readLocalVersion();
  const remote = readRemoteVersion();
  console.log(`存储后端: ${activeBackend()}`);
  console.log(`本地版本: ${local}`);
  console.log(`远端版本: ${remote}`);
  if (local !== remote) {
    console.log(`[version mismatch] local: ${local}, remote: ${remote}`);
    return false;
  }
  console.log(`[version OK] ${local}`);
  return true;
}

function invocation() {
  return path.basename(process.argv[1] || "memory-cli.js");
}

function showHelp() {
  console.log("Memory Management Script");
  console.log(`当前 Agent: ${AGENT_NAME}`);
  console.log(`本地数据目录: ${DATA_DIR}`);
  console.log(`文件系统备份目录: ${FILESYSTEM_REMOTE_DIR}`);
  console.log(`备份模式: ${BACKUP_MODE} (sync/incremental/lazy)`);
  console.log(`存储后端: ${activeBackend()} (auto/minio/filesystem)`);
  console.log("Commands: templates, add-template, edit-template, delete-template, init-task, init-project, save-step, save-decision, update-phase, update-context, load-task, load-project, list, search, index, backup, restore, upgrade, check, delete-task, delete-project");
  console.log("环境变量: AGENT_NAME, AGENT_BACKUP_MODE, MEMORY_STORAGE_BACKEND, MEMORY_STORAGE_ROOT, MEMORY_MINIO_BUCKET");
}
