# poi-plugin-kc3-replay

poi 插件：自动记录出击（含演习）的战斗数据，一键导出到
[KC3改 Battle Replayer](https://kc3kai.github.io/kancolle-replay/battleplayer.html) 观看战斗回放动画。

灵感来自 [poi-plugin-noro6-export](https://github.com/oooo1111880/poi-plugin-noro6-export)。

## 功能

- 出击后自动记录每个战斗节点的昼战 / 夜战原始报文，回到母港后保存（最多保留 50 次出击）
- 自动附带舰队编成（等级 / 改修 / 士气 / 装备含补强增设）、基地航空队、海域血条 / 难度信息
- 支持普通舰队、联合舰队、演习
- 每条记录提供四种导出方式：
  - **回放**：在 poi 内新窗口直接打开 Battle Replayer
  - **浏览器打开**：在系统默认浏览器中打开
  - **复制链接**：链接使用 `#fromLZString=` 压缩编码，可直接分享
  - **复制JSON**：粘贴到回放页面的 "Load from text" 使用，也可用于
    [KC3 模拟器](https://kc3kai.github.io/kancolle-replay/simulator.html) 的 Import

## 安装

将本目录放入 poi 插件目录并命名为 `poi-plugin-kc3-replay`：

- macOS: `~/Library/Application Support/poi/plugins/node_modules/poi-plugin-kc3-replay`
- Windows: `%APPDATA%/poi/plugins/node_modules/poi-plugin-kc3-replay`
- Linux: `~/.config/poi/plugins/node_modules/poi-plugin-kc3-replay`

无需 `npm install`（lz-string 已内置），重启 poi 或在插件设置中重新载入即可。

## 使用

1. 启用插件后正常出击，插件会在后台自动记录
2. **回到母港**后，出击记录出现在插件面板列表中
3. 点击「回放」即可观看战斗回放

## 数据说明

- 记录保存在 poi 数据目录下的 `kc3-replay-export.json`
- 回放数据格式与 KC3改 的 sortie 导出格式一致：顶层为
  `world / mapnum / fleetnum / combined / fleet1-4 / lbas / battles[]`，
  其中 `battles[].data` 与 `battles[].yasen` 为游戏原始战斗报文
- 出击中途关闭 poi 会丢失当前未完成的记录（已保存的不受影响）

## License

MIT（内置的 `lz-string.js` 版权归 [pieroxy](https://github.com/pieroxy/lz-string) 所有，WTFPL）
