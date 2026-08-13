const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { performance } = require('perf_hooks');

// ==================== 默认配置 ====================
const DEFAULT_CONFIG = {
    server: { ip: '127.0.0.1', port: 25565 },
    infinite: false,
    count: 100,
    concurrency: 1,
    // ----- 多版本配置 -----
    versions: ['1.19.2', '1.20.1', '1.20.4'], // 版本列表
    fixed_version: "",                       // 若指定，则固定使用该版本（忽略 versions 列表）
    // ---------------------
    player_name_prefix: "",
    send_brand: true,
    send_hello: false,
    stay_connected: false,
    auto_disconnect_after: 10,
    connection_timeout: 10,
    max_timeouts: 10,
    retry_delay: 8000,
    max_retries: 2,
    interval_between_connections: 5000,
    auto_throttle_adapt: true,
    debug: false,
    log_file: 'logs/bot.log',
    json_log: 'success_log.json',
    stats_file: 'throttle_stats.json',
    log_max_size_mb: 1,
    log_archive_dir: 'logs',
    plugin_dir: 'plugins',
    plugin_config_dir: 'config'
};

function loadConfig() {
    const configPath = path.join(__dirname, 'config.json');
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
        console.log(`[信息] 已生成默认配置文件: ${configPath}`);
        process.exit(0);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// ==================== 工具函数 ====================
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ==================== 日志轮转与归档 ====================
function rotateAndArchive(filePath, maxSizeBytes, archiveDir) {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size < maxSizeBytes) return;
    const dir = path.dirname(filePath);
    ensureDir(archiveDir);
    const ts = new Date().toISOString().replace(/[:\-T]/g, '').slice(0, 15);
    const baseName = path.basename(filePath);
    const archivedName = `${baseName}.${ts}.gz`;
    const archivedPath = path.join(archiveDir, archivedName);
    const content = fs.readFileSync(filePath);
    const gzipped = zlib.gzipSync(content);
    fs.writeFileSync(archivedPath, gzipped);
    fs.writeFileSync(filePath, '');
    console.log(`[日志] 归档 ${filePath} -> ${archivedPath} (${(stats.size/1024).toFixed(1)} KB)`);
}

function createLogger(logFile, maxSizeMB, archiveDir, allowArchive = true) {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    const logDir = path.dirname(logFile);
    ensureDir(logDir);
    if (archiveDir) ensureDir(archiveDir);
    let stream = fs.createWriteStream(logFile, { flags: 'a' });
    const checkAndRotate = () => {
        if (!allowArchive) return;
        if (!fs.existsSync(logFile)) return;
        const stats = fs.statSync(logFile);
        if (stats.size >= maxSizeBytes) {
            if (stream) { stream.end(); stream = null; }
            rotateAndArchive(logFile, maxSizeBytes, archiveDir);
            stream = fs.createWriteStream(logFile, { flags: 'a' });
        }
    };
    const writeLine = (level, msg) => {
        const line = `[${new Date().toISOString().replace('T', ' ').slice(0, -1)}] ${msg}\n`;
        checkAndRotate();
        if (stream) stream.write(line);
        else { stream = fs.createWriteStream(logFile, { flags: 'a' }); stream.write(line); }
        console.log(line.trim());
    };
    return {
        info: (msg) => writeLine('INFO', msg),
        error: (msg) => writeLine('ERROR', msg),
        close: () => { if (stream) { stream.end(); stream = null; } }
    };
}

// ==================== 调试日志 ====================
class DebugLogger {
    constructor(logFile, enabled) {
        this.enabled = enabled;
        this.logFile = logFile;
        if (enabled) { ensureDir(path.dirname(logFile)); this.stream = fs.createWriteStream(logFile, { flags: 'a' }); }
        else this.stream = null;
        this.packetStats = {};
        this.totalPackets = 0;
        this.startTime = Date.now();
    }
    logPacket(packetName, data, direction) {
        if (!this.enabled || !this.stream) return;
        const size = data ? data.length : 0;
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, -1);
        const line = `[${timestamp}] ${direction} ${packetName} size=${size}\n`;
        this.stream.write(line);
        if (!this.packetStats[packetName]) this.packetStats[packetName] = { count: 0, totalSize: 0 };
        this.packetStats[packetName].count++;
        this.packetStats[packetName].totalSize += size;
        this.totalPackets++;
    }
    summary() {
        if (!this.enabled) return;
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
        const lines = [`=== 调试数据包统计 (运行 ${elapsed}s) ===`, `总数据包数: ${this.totalPackets}`, '包类型频率:'];
        const sorted = Object.entries(this.packetStats).sort((a,b) => b[1].count - a[1].count);
        for (const [name, stats] of sorted) lines.push(`  ${name}: ${stats.count} 次, 总大小 ${stats.totalSize} 字节`);
        const content = lines.join('\n') + '\n';
        if (this.stream) this.stream.write(content);
        console.log(content);
    }
    close() { if (this.stream) { this.stream.end(); this.stream = null; } }
}

// ==================== 随机玩家名 ====================
function randomName(prefix = '') {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
    let name = '';
    if (prefix) {
        const maxSuffixLen = Math.max(0, 16 - prefix.length);
        const suffixLen = Math.floor(Math.random() * (maxSuffixLen + 1));
        name = prefix;
        for (let i = 0; i < suffixLen; i++) name += chars[Math.floor(Math.random() * chars.length)];
    } else {
        const length = Math.floor(Math.random() * 16) + 1;
        for (let i = 0; i < length; i++) name += chars[Math.floor(Math.random() * chars.length)];
    }
    if (name.length > 0 && /^[0-9]/.test(name[0])) name = 'A' + name.slice(1);
    name = name.slice(0, 16).replace(/[^a-zA-Z0-9_]/g, '_');
    if (!name) name = 'Bot_' + Date.now().toString(36);
    return name;
}

// ==================== 自适应延迟管理器 ====================
class AdaptiveDelay {
    constructor(config, logger) {
        this.enabled = config.auto_throttle_adapt !== false;
        this.logger = logger;
        this.alpha = 0.2;
        this.emaDuration = null;
        this.minDelay = 8000;
        this.maxDelay = 120000;
        this.currentRetryDelay = Math.max(config.retry_delay || 8000, this.minDelay);
        this.currentInterval = Math.max(config.interval_between_connections || 5000, this.minDelay * 0.6);
        this.totalAttempts = 0; this.successCount = 0; this.throttleCount = 0;
        this.ip = config.server.ip; this.port = config.server.port;
        this.sampleCount = 0; this.consecutiveFailures = 0; this.cooldownUntil = 0;
        if (this.enabled) {
            this.logger.info(`[自适应] 启用，初始重试延迟 ${this.currentRetryDelay}ms，连接间隔 ${this.currentInterval}ms`);
        } else {
            this.logger.info(`[自适应] 禁用，使用固定值 重试延迟 ${this.currentRetryDelay}ms，连接间隔 ${this.currentInterval}ms`);
        }
    }
    addDuration(duration, success = false, isThrottled = false) {
        if (!this.enabled) return;
        this.totalAttempts++;
        if (success) { this.successCount++; this.consecutiveFailures = 0; }
        else { this.consecutiveFailures++; }
        if (isThrottled) { this.recordThrottle(); return; }
        if (duration > 50) {
            if (this.emaDuration === null) this.emaDuration = duration;
            else this.emaDuration = this.alpha * duration + (1 - this.alpha) * this.emaDuration;
            this.sampleCount++;
        }
        let baseDelay = this.emaDuration !== null ? Math.max(this.emaDuration * 1.5, this.minDelay) : this.minDelay;
        baseDelay = Math.min(baseDelay, this.maxDelay);
        const smoothing = 0.6;
        this.currentRetryDelay = Math.round(this.currentRetryDelay * smoothing + baseDelay * (1 - smoothing));
        this.currentInterval = Math.round(this.currentInterval * smoothing + baseDelay * 0.5 * (1 - smoothing));
        if (this.consecutiveFailures >= 3) {
            const multiplier = Math.min(1 + this.consecutiveFailures * 0.3, 3);
            this.currentRetryDelay = Math.min(Math.round(this.currentRetryDelay * multiplier), this.maxDelay);
            this.currentInterval = Math.min(Math.round(this.currentInterval * (1 + this.consecutiveFailures * 0.1)), 30000);
            this.logger.info(`[自适应] 连续 ${this.consecutiveFailures} 次失败，惩罚倍数 ${multiplier.toFixed(1)} → 重试延迟 ${this.currentRetryDelay}ms，连接间隔 ${this.currentInterval}ms`);
        }
        this.currentRetryDelay = Math.min(Math.max(this.currentRetryDelay, this.minDelay), this.maxDelay);
        this.currentInterval = Math.min(Math.max(this.currentInterval, 2000), 30000);
        if (this.sampleCount % 5 === 0) {
            this.logger.info(`[自适应] 基于 ${this.sampleCount} 次连接，平均耗时 ${this.emaDuration ? this.emaDuration.toFixed(0) : 'N/A'}ms → 重试延迟 ${this.currentRetryDelay}ms，连接间隔 ${this.currentInterval}ms`);
        }
    }
    recordThrottle() {
        if (!this.enabled) return;
        this.throttleCount++;
        const factor = 1.5 + Math.random() * 1.0;
        let newDelay = Math.min(Math.round(this.currentRetryDelay * factor), this.maxDelay);
        let newInterval = Math.min(Math.round(newDelay * 0.6), 30000);
        this.currentRetryDelay = Math.max(newDelay, this.minDelay);
        this.currentInterval = Math.max(newInterval, 2000);
        this.cooldownUntil = Date.now() + this.currentRetryDelay * 1.5;
        this.logger.info(`[自适应] 限流惩罚 (×${factor.toFixed(2)}) → 重试延迟 ${this.currentRetryDelay}ms，连接间隔 ${this.currentInterval}ms，冷却 ${(this.currentRetryDelay * 1.5 / 1000).toFixed(1)}s`);
    }
    getRetryDelay() {
        if (this.cooldownUntil > Date.now()) return Math.max(this.currentRetryDelay, this.cooldownUntil - Date.now());
        return this.currentRetryDelay;
    }
    getConnectionInterval() {
        if (this.cooldownUntil > Date.now()) return Math.max(this.currentInterval, this.getRetryDelay() * 0.6);
        return this.currentInterval;
    }
    getStats() {
        return {
            server: `${this.ip}:${this.port}`,
            total_attempts: this.totalAttempts,
            success_count: this.successCount,
            throttle_count: this.throttleCount,
            avg_connection_duration_ms: Math.round(this.emaDuration || 0),
            current_retry_delay_ms: this.currentRetryDelay,
            current_connection_interval_ms: this.currentInterval,
            samples_used: this.sampleCount,
            consecutive_failures: this.consecutiveFailures
        };
    }
    saveStats(filePath) {
        try { fs.writeFileSync(filePath, JSON.stringify(this.getStats(), null, 2)); }
        catch (e) { /* ignore */ }
    }
}

// ==================== 插件管理器 ====================
const BOT_VERSION = '2.0.0';

class PluginManager {
    constructor(pluginsDir = 'plugins', configDir = 'config') {
        this.pluginsDir = pluginsDir;
        this.configDir = configDir;
        this.loadedPlugins = new Map();
        this.hookHandlers = {};
        this.ensureDirectories();
    }
    ensureDirectories() {
        ensureDir(this.pluginsDir);
        ensureDir(this.configDir);
    }
    loadAll() {
        if (!fs.existsSync(this.pluginsDir)) return;
        const items = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        for (const item of items) {
            if (!item.isDirectory()) continue;
            this.loadPlugin(path.join(this.pluginsDir, item.name), item.name);
        }
    }
    loadPlugin(pluginPath, name) {
        try {
            const metaPath = path.join(pluginPath, 'plugin.json');
            if (!fs.existsSync(metaPath)) {
                console.warn(`[插件] 跳过 ${name}：缺少 plugin.json`);
                return;
            }
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            const required = ['name', 'version', 'author', 'description', 'usage'];
            for (const field of required) {
                if (!meta[field]) {
                    console.warn(`[插件] 跳过 ${name}：缺少字段 "${field}"`);
                    return;
                }
            }
            if (meta.name !== name) {
                console.warn(`[插件] 跳过 ${name}：plugin.json 中的 name 与文件夹名不匹配`);
                return;
            }
            if (meta.requires && meta.requires['minecraft-bot']) {
                const range = meta.requires['minecraft-bot'];
                if (!this.satisfiesVersion(BOT_VERSION, range)) {
                    console.warn(`[插件] 跳过 ${name}：需要主程序版本 ${range}，当前 ${BOT_VERSION}`);
                    return;
                }
            }
            if (meta.dependencies && meta.dependencies.length > 0) {
                for (const dep of meta.dependencies) {
                    if (!this.loadedPlugins.has(dep)) {
                        console.warn(`[插件] 跳过 ${name}：缺少依赖插件 ${dep}`);
                        return;
                    }
                }
            }
            const configPath = path.join(this.configDir, `${name}.json`);
            let pluginConfig = {};
            if (fs.existsSync(configPath)) {
                try { pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
                catch (e) { /* ignore */ }
            }
            const entryFile = meta.main || 'index.js';
            const entryPath = path.join(pluginPath, entryFile);
            if (!fs.existsSync(entryPath)) {
                console.warn(`[插件] 跳过 ${name}：找不到入口文件 ${entryFile}`);
                return;
            }
            delete require.cache[require.resolve(entryPath)];
            const pluginModule = require(entryPath);
            if (typeof pluginModule.init !== 'function') {
                console.warn(`[插件] 跳过 ${name}：入口未导出 init 函数`);
                return;
            }
            const hooks = this.createHookRegistrar(name);
            pluginModule.init(pluginConfig, hooks);
            this.loadedPlugins.set(name, { meta, instance: pluginModule, config: pluginConfig });
            console.log(`[插件] ✅ 加载成功: ${name} v${meta.version} (${meta.author})`);
        } catch (err) {
            console.error(`[插件] ❌ 加载插件 ${name} 失败:`, err.message);
        }
    }
    satisfiesVersion(version, range) {
        if (typeof range === 'string') {
            if (range.startsWith('>=')) return version >= range.slice(2);
            else if (range.startsWith('=')) return version === range.slice(1);
            else return version === range;
        }
        return true;
    }
    createHookRegistrar(pluginName) {
        return {
            register: (event, handler) => {
                if (typeof handler !== 'function') {
                    console.warn(`[插件] ${pluginName} 注册钩子 ${event} 失败：处理函数不是函数`);
                    return;
                }
                if (!this.hookHandlers[event]) this.hookHandlers[event] = [];
                this.hookHandlers[event].push({ plugin: pluginName, handler });
            }
        };
    }
    async trigger(event, ...args) {
        if (!this.hookHandlers[event]) return;
        for (const { plugin, handler } of this.hookHandlers[event]) {
            try { await handler(...args); }
            catch (err) { console.error(`[插件] ${plugin} 在钩子 ${event} 中抛出异常:`, err); }
        }
    }
    getPluginInfo() {
        const info = [];
        for (const [name, data] of this.loadedPlugins) {
            info.push({
                name,
                version: data.meta.version,
                author: data.meta.author,
                description: data.meta.description,
                usage: data.meta.usage
            });
        }
        return info;
    }
}

// ==================== 主控制器 ====================
class BotController {
    constructor(config) {
        this.config = config;
        // 验证版本配置
        this.validateVersionConfig();
        // 日志
        const maxSizeMB = config.log_max_size_mb || 1;
        const archiveDir = config.log_archive_dir || 'logs';
        ensureDir(archiveDir);
        const logFilePath = config.log_file || 'logs/bot.log';
        ensureDir(path.dirname(logFilePath));
        this.logger = createLogger(logFilePath, maxSizeMB, archiveDir, true);
        this.debugLogger = new DebugLogger('logs/debug.log', config.debug);
        this.adapter = new AdaptiveDelay(config, this.logger);
        this.pluginManager = new PluginManager(
            config.plugin_dir || 'plugins',
            config.plugin_config_dir || 'config'
        );
        this.pluginManager.loadAll();
        // 统计
        this.successCount = 0;
        this.failureCount = 0;
        this.totalAttempts = 0;
        this.consecutiveTimeouts = 0;
        this.botIdCounter = 0;
        this.activeConnections = 0;
        this.stopped = false;
        this.startTime = performance.now();
        this.running = 0;
        this.concurrentLimit = config.concurrency || 1;
        this.maxTimeouts = config.max_timeouts || 10;
        this.maxRetries = config.max_retries || 2;
        this.retriableErrors = ['ECONNRESET', 'Timeout', 'throttled', 'Throttled', 'Disconnected without login', 'Final timeout'];
    }

    // ----- 多版本支持 -----
    validateVersionConfig() {
        const cfg = this.config;
        const fixed = cfg.fixed_version;
        const versions = cfg.versions;
        // 如果 fixed_version 有值，检查是否在 versions 列表中（可选）
        if (fixed && fixed.trim() !== '') {
            // 如果 versions 为空，自动添加 fixed 版本
            if (!versions || versions.length === 0) {
                this.config.versions = [fixed.trim()];
            }
        } else {
            // 如果没有固定版本，确保 versions 列表非空
            if (!versions || versions.length === 0) {
                this.config.versions = ['1.19.2']; // 默认回退
                console.warn('[警告] versions 列表为空，使用默认版本 1.19.2');
            }
        }
    }

    getVersionForBot() {
        const cfg = this.config;
        const fixed = cfg.fixed_version;
        if (fixed && typeof fixed === 'string' && fixed.trim() !== '') {
            return fixed.trim();
        }
        const versions = cfg.versions;
        if (!versions || versions.length === 0) {
            return '1.19.2';
        }
        return versions[Math.floor(Math.random() * versions.length)];
    }
    // ---------------------

    isRetriable(errorMsg) {
        return this.retriableErrors.some(type => errorMsg && errorMsg.includes(type));
    }

    async start() {
        this.logger.info('=== Minecraft 批量登录客户端启动 (Mineflayer) ===');
        this.logger.info(`目标服务器: ${this.config.server.ip}:${this.config.server.port}`);
        // 版本模式信息
        const fixed = this.config.fixed_version;
        if (fixed && fixed.trim() !== '') {
            this.logger.info(`版本模式: 固定版本 -> ${fixed.trim()}`);
        } else {
            this.logger.info(`版本模式: 随机 (池: ${this.config.versions.join(', ')})`);
        }
        this.logger.info(`无限模式: ${this.config.infinite ? '开启' : '关闭'}`);
        if (!this.config.infinite) this.logger.info(`计划连接次数: ${this.config.count}`);
        this.logger.info(`并发数: ${this.concurrentLimit}`);
        this.logger.info(`玩家名前缀: ${this.config.player_name_prefix || '(无前缀)'}`);
        this.logger.info(`自适应延迟: ${this.config.auto_throttle_adapt ? '开启' : '关闭'}`);
        this.logger.info(`调试模式: ${this.config.debug ? '开启' : '关闭'}`);
        this.logger.info(`登录后保持连接: ${this.config.stay_connected ? '是' : '否'} (自动断开: ${this.config.auto_disconnect_after}s)`);
        this.logger.info(`初始重试延迟: ${this.adapter.getRetryDelay()}ms, 初始连接间隔: ${this.adapter.getConnectionInterval()}ms`);
        this.logger.info(`日志文件大小限制: ${this.config.log_max_size_mb}MB, 归档目录: ${this.config.log_archive_dir}`);

        const plugins = this.pluginManager.getPluginInfo();
        if (plugins.length) {
            this.logger.info(`已加载 ${plugins.length} 个插件:`);
            for (const p of plugins) {
                this.logger.info(`  - ${p.name} v${p.version} by ${p.author}: ${p.description}`);
                if (p.usage) this.logger.info(`    使用方法: ${p.usage}`);
            }
        } else {
            this.logger.info('未加载任何插件');
        }
        await this.runLoop();
    }

    async runLoop() {
        const maxAttempts = this.config.infinite ? Infinity : this.config.count;
        while (this.totalAttempts < maxAttempts && !this.stopped) {
            if (this.consecutiveTimeouts >= this.maxTimeouts) {
                this.logger.info(`连续 ${this.consecutiveTimeouts} 次失败，达到阈值，自动停止`);
                break;
            }
            while (this.running >= this.concurrentLimit) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            this.totalAttempts++;
            this.botIdCounter++;
            const botId = this.botIdCounter;
            const playerName = randomName(this.config.player_name_prefix || '');
            const version = this.getVersionForBot(); // 多版本选择
            this.logger.info(`[Bot ${botId}] 开始连接 (尝试 ${this.totalAttempts})... 版本: ${version}`);
            this.running++;
            this.activeConnections++;
            let attemptCount = 0;
            let success = false;
            let lastError = '';
            while (attemptCount <= this.maxRetries && !success && !this.stopped) {
                attemptCount++;
                const result = await this.connectOnce(botId, playerName, version);
                const duration = result.duration || 0;
                const wasSuccess = result.success || false;
                const errorMsg = result.error || '';
                const isThrottled = /throttle/i.test(errorMsg);
                this.adapter.addDuration(duration, wasSuccess, isThrottled);
                if (wasSuccess) {
                    success = true;
                    this.successCount++;
                    this.consecutiveTimeouts = 0;
                } else {
                    lastError = errorMsg;
                    if (attemptCount <= this.maxRetries && this.isRetriable(errorMsg)) {
                        const delay = this.adapter.getRetryDelay();
                        this.logger.info(`[Bot ${botId}] 重试 ${attemptCount}/${this.maxRetries} (错误类型: ${errorMsg.split(':')[0]})，等待 ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    this.failureCount++;
                    this.consecutiveTimeouts++;
                    break;
                }
            }
            if (!success) this.logger.error(`[Bot ${botId}] 最终失败，错误类型: ${lastError.split(':')[0] || 'Unknown'}`);
            this.running--;
            this.activeConnections--;
            if (this.totalAttempts < maxAttempts) {
                const interval = this.adapter.getConnectionInterval();
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        }
        while (this.activeConnections > 0 || this.running > 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        this.stop();
    }

    async connectOnce(botId, playerName, version) {
        const config = this.config;
        const logger = this.logger;
        const debugLogger = this.debugLogger;
        const pluginManager = this.pluginManager;
        const context = { botId, playerName, version };

        return new Promise((resolve) => {
            const startTime = performance.now();
            let loggedIn = false;
            let disconnectTimer = null;
            let timeoutHandle = null;
            let finalTimeoutHandle = null;
            let resolved = false;

            let botConfig = {
                host: config.server.ip,
                port: config.server.port,
                username: playerName,
                version: version, // 使用传入的版本
                connectTimeout: config.connection_timeout * 1000,
                brand: config.send_brand ? 'vanilla' : undefined,
            };
            pluginManager.trigger('beforeConnect', botConfig, context).then(() => {
                const bot = mineflayer.createBot(botConfig);

                bot.once('connect', () => {
                    pluginManager.trigger('afterConnect', bot, context);
                });

                bot.once('login', () => {
                    loggedIn = true;
                    const elapsed = (performance.now() - startTime).toFixed(0);
                    logger.info(`[Bot ${botId}] ★ 登录成功! 玩家: ${playerName} (版本 ${version}) 耗时 ${elapsed}ms`);
                    const entry = { timestamp: Date.now() / 1000, player: playerName, version, server: `${config.server.ip}:${config.server.port}` };
                    try { fs.appendFileSync(config.json_log || 'success_log.json', JSON.stringify(entry) + '\n'); }
                    catch (e) { /* ignore */ }
                    pluginManager.trigger('onLogin', bot, context);

                    if (config.stay_connected) {
                        const autoDisconnect = config.auto_disconnect_after || 10;
                        if (autoDisconnect > 0) {
                            disconnectTimer = setTimeout(() => {
                                if (bot && bot._client && bot._client.state !== 'closed') {
                                    bot.end();
                                    logger.info(`[Bot ${botId}] 自动断开 (${autoDisconnect}s)`);
                                }
                            }, autoDisconnect * 1000);
                        }
                    } else {
                        if (bot && bot._client && bot._client.state !== 'closed') bot.end();
                    }
                });

                bot.once('kicked', (reason) => {
                    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
                    const isThrottled = /throttle/i.test(reasonStr);
                    const errorType = isThrottled ? 'Throttled' : 'Kicked';
                    logger.error(`[Bot ${botId}] [${errorType}] 被踢出: ${reasonStr}`);
                    pluginManager.trigger('onKick', reason, context);
                    resolveOnce({ success: false, error: `${errorType}: ${reasonStr}` });
                });

                bot.once('error', (err) => {
                    if (!loggedIn) {
                        let errorType = 'Unknown';
                        if (err.code === 'ECONNRESET') errorType = 'ECONNRESET';
                        else if (err.message && /timeout/i.test(err.message)) errorType = 'Timeout';
                        else if (err.code === 'ENOTFOUND') errorType = 'DNS';
                        logger.error(`[Bot ${botId}] [${errorType}] 连接错误: ${err.message}`);
                        pluginManager.trigger('onError', err, context);
                        resolveOnce({ success: false, error: `${errorType}: ${err.message}` });
                    }
                });

                timeoutHandle = setTimeout(() => {
                    if (!loggedIn && !resolved) {
                        logger.error(`[Bot ${botId}] [Timeout] 连接超时 (${config.connection_timeout}s)`);
                        if (bot && bot._client && bot._client.state !== 'closed') bot.end();
                        resolveOnce({ success: false, error: 'Timeout' });
                    }
                }, (config.connection_timeout + 1) * 1000);

                finalTimeoutHandle = setTimeout(() => {
                    if (!resolved) {
                        logger.error(`[Bot ${botId}] [FinalTimeout] 最终超时 (${config.connection_timeout + 3}s)`);
                        if (bot && bot._client && bot._client.state !== 'closed') bot.end();
                        resolveOnce({ success: false, error: 'Final timeout' });
                    }
                }, (config.connection_timeout + 3) * 1000);

                bot.once('end', (reason) => {
                    if (disconnectTimer) clearTimeout(disconnectTimer);
                    if (timeoutHandle) clearTimeout(timeoutHandle);
                    if (finalTimeoutHandle) clearTimeout(finalTimeoutHandle);
                    pluginManager.trigger('onDisconnect', reason, context);
                    if (!loggedIn && !resolved) {
                        logger.error(`[Bot ${botId}] [Disconnected] 连接意外断开 (未登录)`);
                        resolveOnce({ success: false, error: 'Disconnected without login' });
                    } else if (loggedIn && !resolved) {
                        logger.info(`[Bot ${botId}] 连接已断开`);
                        resolveOnce({ success: true, player: playerName, version });
                    }
                });

                const resolveOnce = (result) => {
                    if (!resolved) {
                        resolved = true;
                        const duration = performance.now() - startTime;
                        result.duration = duration;
                        resolve(result);
                    }
                };
            }).catch(err => {
                logger.error(`[Bot ${botId}] 插件 beforeConnect 异常: ${err.message}`);
                resolve({ success: false, error: 'PluginError' });
            });
        });
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.debugLogger.summary();
        this.debugLogger.close();
        if (this.config.auto_throttle_adapt) {
            this.adapter.saveStats(this.config.stats_file || 'throttle_stats.json');
        }
        const elapsed = ((performance.now() - this.startTime) / 1000).toFixed(2);
        const total = this.totalAttempts;
        const success = this.successCount;
        const failure = this.failureCount;
        const rate = total > 0 ? ((success / total) * 100).toFixed(2) : 0;
        this.logger.info('=== 统计报告 ===');
        this.logger.info(`总尝试连接数: ${total}`);
        this.logger.info(`登录成功数: ${success}`);
        this.logger.info(`登录失败数: ${failure}`);
        this.logger.info(`成功率: ${rate}%`);
        this.logger.info(`总耗时: ${elapsed} 秒`);
        this.logger.info('=== 客户端结束 ===');
        this.logger.close();
        process.exit(0);
    }
}

// ==================== 入口 ====================
const config = loadConfig();
const controller = new BotController(config);
controller.start().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});