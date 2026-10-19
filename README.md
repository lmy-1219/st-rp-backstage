# RP：幕后

为 SillyTavern 增加记忆、角色动机、幕后规划和场面管理。关掉系统后，SillyTavern 仍可正常使用。

## 安装

需要 Git、Node.js 22.13 或以上，以及启用服务端插件的 SillyTavern。

1. 把这个私有仓克隆到一个独立目录，并保留它。后台从这份代码启动。
2. 将 `extension/` 的三个文件放入 SillyTavern 的 `data/default-user/extensions/rp-emergence/`，将 `plugin/` 的两个文件放入 `plugins/rp-emergence/`。
3. 在 SillyTavern 的 `config.yaml` 中启用 `enableServerPlugins: true`。修改前先备份。
4. 为转发插件建立本机 `config.json`，指定独立后台端口、`autoStart.entry` 为本克隆的 `core/main.mjs`，`autoStart.home` 为 SillyTavern 的 `data/rp-emergence/`，`update.follow` 为 `origin/main`。选择的后台端口不能与其他程序冲突。
5. 启动 SillyTavern，在扩展面板打开“RP：幕后”。钥匙由你自己在面板填写，不要写进代码目录。

已有安装请先保留插件配置和数据目录；不要用本仓覆盖自己的卡、书、预设或聊天。

## 更新

下次启动 SillyTavern，插件会跟随这个仓的 `origin/main`。也可以在面板点击“检查更新”。扩展改动可能需要刷新网页，插件改动需要重启 SillyTavern。

设置页显示“正式版 vN”和正在运行的提交号。更新不删除 `data/rp-emergence/` 的记录，也不修改你的卡、书、预设、聊天和钥匙。

版本信息见 `release.json`，变化见 `CHANGELOG.md`。请勿在这份克隆里直接改代码，以免自动更新无法快进。
