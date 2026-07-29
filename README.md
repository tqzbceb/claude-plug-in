# api-panel-layout

TauriTavern / SillyTavern 扩展：接管「API 连接配置」面板。

- 重排 Chat Completion 字段，顺序固定为：当前API预设 → 预设名称 → 端点 → API密钥 → 模型名 → 模型列表 → 加载模型/附加参数 → 最大回复长度+温度 → 附加主体参数(YAML)
- API 密钥默认掩码，右侧「眼睛」按钮切换明文（读取已保存密钥需后端 `allowKeysExposure: true`）
- 「模型列表」默认隐藏，点过「加载模型」且真的拿到模型后才出现
- 左侧面板的预设 / 最大回复长度 / 温度 / YAML 以**镜像控件**形式搬进面板，原生控件与逻辑保持不动

## 安装

仓库根目录**就是**扩展目录（`manifest.json` + `index.js` + `style.css`），三种装法任选：

**方式 A：应用内用 Git URL 安装**（不用下载文件，最省事）

在「扩展」面板的安装入口填：

```
https://github.com/tqzbceb/claude-plug-in
```

**方式 B：手动放目录**

新建 `data/default-user/extensions/api-panel-layout/`，把 `manifest.json`、`index.js`、`style.css` 三个文件放进去，刷新前端。

**方式 C：zip**

如果客户端有「从 zip 安装扩展」入口，用仓库里的 `api-panel-layout.zip`（解压后是同名目录 + 同样三个文件）。

装好后在「扩展」面板里会出现 **API 面板重排**，含 6 个开关：启用重排 / 自定义标签 / 密钥默认隐藏 / 模型列表加载后再显示 / 显示附加主体参数 / 调试日志。

## 设计原则

1. 只 **移动**（move）原生节点，绝不 clone —— 原生 jQuery 事件绑定全部保留，底层逻辑零改动。
2. 完全可逆：每个被搬走的节点在原位留注释锚点，文本/属性改写单独记账；关掉扩展时 DOM 逐字符还原。
3. 不注入任何颜色 / 字体 / 圆角 / 阴影，只用原生 class，主题美化与第三方扩展不冲突。
4. 找不到某个原生元素时只隐藏该字段并打日志，绝不抛错、绝不破坏面板。

## 兼容性

针对 SillyTavern 1.16 系前端（TauriTavern v1.6.5）编写。各 API source 的字段选择器集中在 `index.js` 的 `SOURCE_FIELDS`，未列出的 source 按 `#api_key_<source>` / `#model_<source>_select` 惯例推导。

若某个字段没出现：打开设置里的**调试日志**，控制台会打印 `[api-panel-layout]` 找不到的选择器，改 `SOURCE_FIELDS` 即可。

排障入口（浏览器控制台）：

```js
apiPanelLayout.apply()     // 手动重排
apiPanelLayout.teardown()  // 完全还原
apiPanelLayout.syncAll()   // 只回读原生状态
```

## 测试状态

在模拟的 SillyTavern 面板 DOM 上验证通过：挂载位置、9 个槽位、密钥掩码与明文切换、模型列表懒显示、预设/数值/YAML 镜像驱动原生控件、custom ↔ claude 切换后旧字段归位、`teardown()` 后 DOM 结构与加载前逐字符一致、重复 `apply()` 不堆积节点。

未在真机 TauriTavern 上跑过；如果某些原生 id 有出入，按上面的排障入口调 `SOURCE_FIELDS`。
