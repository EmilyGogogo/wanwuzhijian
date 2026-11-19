# 万物之间 · Between All Things

一款以「成为万物」为核心的单人探索游戏。在草叶间、树冠下、河面与河心主岛之间，进入不同的身体，体验它们看见、听见和行动的方式，直到成为脚下的岛屿。

面向电脑浏览器（Chrome / Edge）与键鼠，使用 Three.js 实现。

## 运行

需要 Python 3.9 或更高版本，无需 Node、npm 或联网。

- macOS 双击 `启动游戏.command`，Windows 双击 `启动游戏.bat`；
- 或在本目录执行 `python3 serve.py --open`，浏览器打开 http://127.0.0.1:4173 。

须通过 HTTP 服务打开，不能直接双击 `index.html`。本目录本身就是一个静态站点，也可以整体部署到任何静态托管（例如 GitHub Pages 选择从分支根目录发布）。

所有模型与地形载入完成后才能进入世界。下载中断时会自动重试；仍然失败则显示“世界没有完整载入”，不会用替代模型开始游戏。

## 操作

| 操作 | 按键 / 方式 |
| --- | --- |
| 移动 | WASD 或方向键 |
| 环视 | 鼠标；指针未锁定时按住左键拖动 |
| 加速 | Shift |
| 魂穿 | 看向涟漪标出的目标，按 R |
| 切换第一／第三人称 | V |
| 小地图显示／隐藏、缩放 | M、+／− |
| 暂停 / 继续 | Esc |

鸟与鱼在移动时随视线俯仰升降。暂停菜单可切换环境声、重新开始；进度保存在当前浏览器。

## 目录

| 路径 | 内容 |
| --- | --- |
| `index.html`、`src/` | 页面与游戏代码 |
| `public/config/game.json` | 身体、布局、键位、数值与文字 |
| `public/models/` | 模型与 `manifest.json`（每个身体与装饰使用哪个模型） |
| `public/terrain/`、`public/textures/` | 主岛高度场与地表贴图 |
| `vendor/` | Three.js 0.170.0 |
| `serve.py` | 本地静态服务 |

## 许可

见 [LICENSE](LICENSE)（PolyForm Strict License 1.0.0）与 [第三方内容](THIRD_PARTY.md)。
