# RP：幕后（st-rp-backstage）

挂在 SillyTavern 旁边的长篇角色扮演后台：

- **记得准**：聊过的事、说定的约、欠的钱都每条总结；删稿、改稿，记下的也跟着撤回。
- **不串知**：谁知道什么按在场的人算，角色不会知道他没听见的事。
- **世界会动**：后台按剧情排事，不在场的人会来找你，角色有自己的打算。你多数时候只管接戏。
- **场面**：谁在场、谁走了、镜头在哪，面板上看得见，错了点一下就能改。

**关掉它，SillyTavern 照常能用。** 后台挂了也不影响聊天。

交流 QQ 群：1131373686

素材包可以单独导入（选 zip 或贴 git 地址），入口在“设置 → 高级 → 这一局的细节 → 导入素材包”。

## 开局包怎么导

开局包在面板“这一局 → 导入开局包”里选下载的 `.zip`，不用自己解压；QQ、微信收到的先保存到下载。也可以贴无账号密码的 HTTPS git 地址拉取，再点一次就是更新；本机文件夹入口留在电脑进阶里。先预览资源和同名覆盖清单，再确认导入新群。只认 zip（普通 store／deflate），rar、7z 请转 zip；最多 300MB 解压内容、5000 项。新装素材进后台数据目录，代码仓原有素材照读，不自动搬迁。

## 需要什么

- SillyTavern 1.16 或以上，开启服务端插件（安装器会帮你打开）。
- 要原版 SillyTavern（电脑，或手机 Termux）。TauriTavern 这类不跑 Node 的酒馆 App 不支持服务端插件，用不了。
- Node.js 22.13 或以上（后台用 Node 自带的数据库）。
- Git（自动更新要用）。
- 一把你自己的模型钥匙。后台按你在面板里选的型号调模型，费用你自己付；面板上能看到今天花了多少，也能设每天的上限。

## 安装

酒馆要先启动过一次以生成配置，然后关掉酒馆再装。下面的 `<ST>` 是含 `server.js` 的 SillyTavern 根目录；配置可在根目录或 `config/config.yaml`。安装不需要 `npm install`。

### A. 安装器（推荐）

下载本仓并解压，Windows 双击 `安装.bat`；手机 Termux、Mac、Linux 在解压目录运行 `sh install.sh`。放在酒馆目录里运行会自动找；不在里面会问一句酒馆路径，也可以传 `--st "<ST>"`。安装器会检查 Node.js 22.13 和 Git，装好扩展与后台，只打开服务端插件开关，原 YAML 留一份备份。完成后重启酒馆。

### 手机（Termux 里跑酒馆的）

用 Termux 一键脚本或工具箱装的酒馆也能用，扩展、插件和后台都在手机里跑，不需要电脑。

1. 退出酒馆。在 Termux 里运行下面几行（`node -v` 要 22.13 以上；已经装过 git 和 nodejs 的跳过第一行）：

   ```
   pkg install git nodejs
   git clone https://github.com/lmy-1219/st-rp-backstage ~/st-rp-backstage
   sh ~/st-rp-backstage/install.sh ~/SillyTavern
   ```

   酒馆不在 `~/SillyTavern` 的，把最后的路径换成你的酒馆目录（工具箱一般会显示）。
2. 照常用脚本或工具箱启动酒馆，浏览器里打开面板。

几点注意：

- 后台跟着酒馆在手机里跑。被系统杀掉以后，重新启动酒馆就会自动拉起；工具箱的"保活"有帮助。
- 工具箱"更新酒馆"不影响本插件。恢复备份、重装酒馆以后，面板如果提示"还差一步"，重跑上面第三行就好；数据在酒馆的 `data/rp-emergence/` 里。

### 云服务器／Docker

安装器必须在**运行酒馆的机器**上执行，电脑浏览器里装扩展只装了面板。已有下载目录就用那份 `install.sh`，不用反复克隆。

**有 SSH、直接跑 Node 的云服务器**：登录服务器，进入含 `server.js` 的酒馆目录，运行：

```sh
cd <酒馆目录>
git clone https://github.com/lmy-1219/st-rp-backstage /tmp/st-rp-installer
sh /tmp/st-rp-installer/install.sh "$PWD"
```

然后用平时的方式重启酒馆，例如 `pm2 restart <名称>`、`systemctl restart <服务名>`，或关掉再开。第一次安装前，先启动过一次酒馆以生成配置。

**Docker**：先 `docker exec -it <容器名> sh` 进入容器，再运行：

```sh
cd /home/node/app
git clone https://github.com/lmy-1219/st-rp-backstage /tmp/st-rp-installer
sh /tmp/st-rp-installer/install.sh "$PWD"
```

官方镜像的酒馆目录是 `/home/node/app`，自定义镜像按实际目录替换。退出容器 shell 后在宿主机运行 `docker restart <容器名>`。安装器同时识别根目录的 `config.yaml` 和 `config/config.yaml`，两份都有时优先根目录。配置原件备份在所用文件旁边。按官方 compose 挂载 `config/`、`data/`、`plugins/`、扩展目录后，插件和数据留在挂载卷里，重建容器不会丢；未挂载的目录要先配置持久化。

**没有命令行的托管服务**用不了：后台需要在酒馆所在机器运行。没有终端且不能放服务端插件的一体化酒馆 App 也不支持。

装完暂时灰灯“后台正在启动……”会自动重查，最多等两分钟。“后台插件还没装上”请补服务器端安装；“插件装好了，但后台没起来”请重启，并查看 `data/rp-emergence/后台日志.txt` 最后几十行。自定义 `autoStart.home` 时日志就在那个数据目录里。两种故障都能点“再查一次”；`Directory already exists` 只说明面板已经装过，不用再点“安装扩展”。日志分享前遮住私人路径等信息，不要贴钥匙或整份配置。

### B. 酒馆自带“安装扩展”

在扩展 → 安装扩展填 `https://github.com/lmy-1219/st-rp-backstage`，刷新页面。扩展文件就在仓根。然后运行上面的安装器补上后台，重启酒馆；已有扩展会更新，不重复装一份。

### C. 手动（备用）

1. 关闭酒馆，克隆本仓到 `<ST>/plugins/st-rp-backstage/`，再克隆一份到 `<ST>/data/default-user/extensions/st-rp-backstage/`。
2. 备份 `<ST>/config.yaml`，只把 `enableServerPlugins` 改成 `true`。
3. 在插件那份仓根的 `config.json` 配后台端口（从8030起选空闲端口），`autoStart.home` 指向 `<ST>/data/rp-emergence/`，`update.follow` 为 `origin/main`。后台入口默认是本仓 `server/core/main.mjs`，通常不用填。
4. 重启酒馆，在扩展面板找“RP：幕后”。“设置 → 钥匙和模型”填自己的钥匙和型号。
5. 打开聊天，点“接入这个窗口”。不要另外复制旧的 `rp-emergence` 扩展目录，避免加载两个面板。

同一个仓装两处：一份扩展、一份插件和后台。数据在酒馆的 `data/rp-emergence/`，不在代码仓里。安装器能重复运行，保留你改过的插件配置，只补缺项；不动卡、书、预设、聊天和任何 `secrets.json`。钥匙由你在面板填写。

若你用过旧版手动安装，先备份并将旧的 `extensions/rp-emergence/` 和 `plugins/rp-emergence/` 移到酒馆外，再装新版，避免两个面板或两个同名插件。安装器遇到旧目录会停下来，不会替你删除或搬走。保留原 `data/rp-emergence/`，并按原端口和数据路径配置新插件。

## 更新

在面板“设置 → 高级 → 检查更新”里点“更新”。一般不用关酒馆：后台自己重启，按提示刷新网页用上新面板；只有提示“这次改到了转发插件”时，才关掉酒馆再开一次。设置和数据不动。

安装器仍可用于修复，两份代码没对上或面板连不上时可以重跑：

- Windows：双击插件文件夹 `<ST>/plugins/st-rp-backstage/` 里的 `安装.bat`。
- 手机 Termux、Mac、Linux：运行 `sh ~/SillyTavern/plugins/st-rp-backstage/install.sh ~/SillyTavern`（酒馆不在这儿就换成你的目录）。

更新只快进干净的发布仓克隆；扩展那份有改动、来源不对或不是 git 安装时，面板会说明未更新的原因，请按提示修复。

连 GitHub 报 `HTTP2 framing layer` 之类的错，先运行一次 `git config --global http.version HTTP/1.1` 再试。

面板显示“正式版 vN”和运行版本；每版变化见 `CHANGELOG.md`。不要直接改代码仓里的跟踪文件，以免更新不能快进。插件自己的 `config.json` 已忽略，数据、钥匙、用户内容不会随代码更新覆盖。

## 内容档位

每一局可以选 **SFW / 剧情向NSFW / 纯NSFW**：

- **SFW**：不排亲密内容。
- **剧情向NSFW**：亲密线是剧情的一部分。
- **纯NSFW**：要另装口味包，见下。

亲密内容只在开局单里写了亲密线、而且确认这条线里**每个人都已成年**时才会生效。没确认就不生效。这条门槛、随时能喊停的 `/停`，还有"只排每个人都愿意的"这条边界，都写在系统代码里，口味包改不掉。

纯NSFW 档的口味文字不在这个仓里，放在单独的口味包里，仅限成年人。导入方法：面板"设置 → 高级（创作者用）→ 口味 → 看／改口味包 · 导入／导出"，导入后在这一局选上它。没导入时，纯NSFW 和剧情向一样。

## 反馈

在本仓的 Issues 里提，或者到 QQ 群（1131373686）说。提的时候请写清：

- SillyTavern 版本；
- 面板上显示的版本号；
- 你做了什么、看到了什么。

截图请先把聊天正文和钥匙遮掉。

## 许可证

AGPL-3.0，见 `LICENSE`。可以用、改、分发；拿去改了再提供给别人用（包括做成网上的服务），也要按同样的许可证公开源码。

玩法可选“完整”或“只记忆”：只记忆保留总结、召回与知情隔离，停剧情安排和推演，省钱；全局设默认，每局可单独选。
