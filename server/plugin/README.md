# plugin — ST 服务端转发插件

装在 ST 的 `plugins/rp-emergence/`，需要 ST 的 `config.yaml` 里 `enableServerPlugins: true`。

- 把浏览器发来的 `/api/plugins/rp-emergence/<route>` 原样转给本机后台 `http://127.0.0.1:<port>/v1/<route>`。浏览器只跟 ST 同一个地址说话，远程或手机玩也能用，并继承 ST 自己的登录保护（白皮书 §9.1-1）。
- ST 启动时如果后台没在跑，就把它作为独立进程拉起来（`config.json` 里的 `autoStart`）。后台挂了 ST 不受影响，只是这些接口返回 503。
- `config.json` 由安装脚本生成，不进仓：`{ "port": 8019, "autoStart": { "entry": "<仓库>/core/main.mjs", "home": "<数据目录>" } }`。
