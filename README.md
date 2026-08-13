# mcJAVA-bot-

🚀 Minecraft 批量登录客户端 (Mineflayer)
https://img.shields.io/badge/node-%253E%253D18.0.0-brightgreen
https://img.shields.io/badge/license-MIT-blue
https://img.shields.io/badge/PRs-welcome-brightgreen

一个基于 Mineflayer 的强大、可扩展的 Minecraft Java 版批量登录客户端。支持多版本、自适应限流、插件系统和完整的日志管理。

📖 项目简介
本项目是一个高度可配置的 Minecraft 机器人客户端，专为服务器压力测试、自动化测试或模拟多玩家场景设计。它支持：

✅ 批量登录 – 可配置并发数、总次数或无限循环模式

✅ 多版本支持 – 支持 Minecraft 1.8 至 1.21+ 版本（由 Mineflayer 驱动）

✅ 自适应限流 – 智能动态调整连接间隔和重试延迟，避免被服务器限流

✅ 插件系统 – 轻松扩展功能，无需修改核心代码

✅ 详细日志 – 自动轮转、压缩归档，便于长期运行和调试

✅ 数据持久化 – 成功登录记录保存为 JSON，方便后续分析

✅ 跨平台 – 在 Windows、Linux、macOS 上均可运行

✨ 功能特性
功能	说明
🔄 循环模式	有限次数 / 无限循环（通过 infinite 开关）
🎲 随机玩家名	自动生成 1~16 位字母数字下划线组合，支持自定义前缀
📦 多版本支持	固定版本或随机从版本池中选择
🛡️ 自适应限流	基于连接耗时和限流事件的动态指数退避算法
🔌 插件系统	通过钩子（onLogin, onKick, onError 等）扩展功能
📝 日志管理	自动轮转（可设置大小），超出自动压缩归档为 .gz
💾 JSON 持久化	成功登录记录保存为 success_log.json（每行一个 JSON）
🧪 调试模式	记录所有收发数据包，生成统计报告
🛠️ 安装与使用
前置要求
Node.js 18.0 或更高版本

npm 或 yarn

1. 克隆项目
bash
git clone https://github.com/yourname/minecraft-bulk-login.git
cd minecraft-bulk-login
2. 安装依赖
bash
npm install mineflayer
3. 运行程序
首次运行会自动生成 config.json 配置文件：

bash
node index.js
根据提示修改 config.json 中的服务器地址、端口、版本、并发数等参数，然后再次运行。

4. 启动
bash
node index.js
⚙️ 配置说明
config.json 是程序的核心配置文件，所有参数均可按需调整。

字段	类型	默认值	说明
server.ip	string	"127.0.0.1"	服务器 IP 地址
server.port	number	25565	服务器端口
infinite	boolean	false	是否无限循环（true 则忽略 count）
count	number	100	有限模式下的总连接尝试次数
concurrency	number	1	同时保持的最大连接数
versions	string[]	["1.19.2"]	可用的版本列表（随机选择）
fixed_version	string	""	若设置，则固定使用该版本（优先级高于 versions）
player_name_prefix	string	""	玩家名前缀（空则完全随机）
send_brand	boolean	true	是否发送 minecraft:brand 包
send_hello	boolean	false	是否发送 minecraft:hello 包（Fabric 兼容）
stay_connected	boolean	false	登录成功后是否保持连接
auto_disconnect_after	number	10	保持连接时自动断开秒数（0 表示无限）
connection_timeout	number	10	连接超时（秒）
max_timeouts	number	10	连续失败次数阈值，达到后自动停止
retry_delay	number	8000	重试延迟（毫秒，自适应时会动态调整）
max_retries	number	2	每个 Bot 的最大重试次数
interval_between_connections	number	5000	连接间隔（毫秒，自适应时会动态调整）
auto_throttle_adapt	boolean	true	是否启用自适应限流
debug	boolean	false	是否启用调试模式（记录所有数据包）
log_file	string	"logs/bot.log"	日志文件路径
json_log	string	"success_log.json"	成功记录 JSON 文件路径
stats_file	string	"throttle_stats.json"	自适应统计输出文件
log_max_size_mb	number	1	日志文件大小上限（MB），超过自动压缩
log_archive_dir	string	"logs"	日志归档目录
plugin_dir	string	"plugins"	插件目录
plugin_config_dir	string	"config"	插件配置目录
🔌 插件开发
插件结构
每个插件位于 plugins/ 下的独立文件夹，包含：

plugin.json – 元数据（必需）

index.js – 入口文件（导出 init 函数）

plugin.json 示例
json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "登录后发送欢迎消息",
  "usage": "在 config/my-plugin.json 中设置 message 字段",
  "main": "index.js",
  "dependencies": [],
  "requires": {
    "minecraft-bot": ">=2.0.0"
  }
}
index.js 示例
javascript
module.exports.init = (config, hooks) => {
  // config 来自 config/my-plugin.json
  hooks.register('onLogin', (bot, context) => {
    const msg = config.message || 'Hello!';
    bot.chat(msg);
    console.log(`[插件 my-plugin] 发送: ${msg}`);
  });
};
可用钩子
钩子	参数	触发时机
beforeConnect	(botConfig, context)	创建 Bot 前，可修改 botConfig
afterConnect	(bot, context)	TCP 连接建立后，登录前
onLogin	(bot, context)	登录成功，进入游戏
onKick	(reason, context)	被服务器踢出
onError	(err, context)	发生错误（网络等）
onDisconnect	(reason, context)	连接断开（主动或被动）
context 包含 { botId, playerName, version }。

📁 项目结构
text
minecraft-bulk-login/
├── index.js               # 主程序入口
├── config.json            # 配置文件（自动生成）
├── package.json           # 项目元数据
├── README.md              # 本文档
├── logs/                  # 日志目录（自动创建）
│   ├── bot.log            # 当前日志
│   ├── bot.log.*.gz       # 归档压缩包
│   └── debug.log          # 调试日志（若开启调试模式）
├── plugins/               # 插件目录
│   └── my-plugin/
│       ├── plugin.json
│       └── index.js
├── config/                # 插件配置目录
│   └── my-plugin.json     # 可选
├── success_log.json       # 成功登录记录
└── throttle_stats.json    # 自适应统计信息
🤝 贡献
欢迎提交 Issue 和 Pull Request！请确保代码风格一致，并添加必要的测试和文档。

📄 许可证
本项目基于 MIT License 开源，可自由使用、修改和分发。

🧩 相关链接
Mineflayer 官方文档
https://github.com/PrismarineJS/mineflayer
Minecraft 协议 Wiki
https://wiki.vg/Protocol
Node.js 官网
https://nodejs.org/
⭐ 支持
如果这个项目对你有帮助，欢迎给一个 Star ⭐，让更多人看到！
