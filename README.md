# api-panel-layout

TauriTavern / SillyTavern 扩展：把「API 连接配置」面板压到最小，面向**用连接配置（API 预设）切换 API** 的用法。

面板变成这样：

```
API                     [Chat Completion ▾]
Chat Completion Source  [Custom ▾]
当前API预设              [sub2api-gpt4o ▾][详情][新建][保存][改名][重载][删除]
▸ 新建 / 编辑 API         ← 默认折叠，展开后才有下面这些
     端点（基础URL）
     API密钥
     模型名
     模型列表            ← 加载出模型后才出现
     [加载模型][附加参数][Test Message]
```

平时只用「当前API预设」那一行切换 API；只有要新建或改一个 API 时才展开下面那块。

顺手清掉的东西：

- 端点下面的「自定义端点预览 / 不行？在 URL 末尾添加 /v1 试试」新手提示
- API 密钥右边的「管理 API 密钥」小钥匙按钮（用预设保存密钥就不需要它）
- 密钥下面的隐私提示
- 模型列表在没加载出模型前不显示

「当前API预设」用的就是原生 connection-manager 那一整块（下拉框 + 6 个按钮），只是搬到了 API 类型下面，逻辑一行没改：填端点和 key → 加载模型 → 选模型 → 点「新建」存成一个预设，以后直接在下拉框里切。

## 安装

仓库根目录**就是**扩展目录（`manifest.json` + `index.js` + `style.css`），三种装法任选：

**方式 A：应用内用 Git URL 安装**（不用下载文件）

```
https://github.com/tqzbceb/claude-plug-in
```

**方式 B：手动放目录**

新建 `data/default-user/extensions/api-panel-layout/`，把 `manifest.json`、`index.js`、`style.css` 三个文件放进去，刷新前端。

**方式 C：zip**

如果客户端有「从 zip 安装扩展」入口，用仓库里的 `api-panel-layout.zip`。

## 设置

装好后「扩展」面板里出现 **API 面板重排**：

| 开关 | 作用 |
| --- | --- |
| 启用重排 | 关掉即完全还原原生面板 |
| 把端点/密钥/模型折叠起来 | 关掉则这些字段始终展开显示 |
| 使用中文标签 | 关掉则保留原生英文标签 |
| 隐藏新手提示与管理密钥按钮 | 关掉则提示与小钥匙都回来 |
| 模型列表加载后再显示 | 关掉则模型列表一直显示 |
| 调试日志 | 打印找不到的选择器，排障用 |

折叠区的展开状态会被记住。

## 设计原则

1. 只 **移动**（move）原生节点，绝不 clone —— 原生 jQuery 事件绑定全部保留，底层逻辑零改动。
2. 完全可逆：搬走的节点在原位留注释锚点，隐藏与改字单独记账；关掉扩展时 DOM 逐字符还原。
3. 不注入任何颜色 / 字体 / 圆角 / 阴影，只用原生 class，主题美化与第三方扩展不冲突。
4. 找不到某个原生元素时只隐藏该字段并打日志，绝不抛错、绝不破坏面板。

## 兼容性

按 TauriTavern v1.6.5 的真实 DOM 编写（`src/index.html` + `scripts/extensions/connection-manager/settings.html`）。
各 source 的字段选择器集中在 `index.js` 的 `SOURCE_FIELDS`，未列出的 source 按 `#api_key_<source>` / `#model_<source>_select` 惯例推导。

某个字段没出现时：打开**调试日志**，控制台会打印 `[api-panel-layout]` 找不到的选择器，改 `SOURCE_FIELDS` 即可。

排障入口（浏览器控制台）：

```js
apiPanelLayout.apply()     // 手动重排
apiPanelLayout.teardown()  // 完全还原
apiPanelLayout.cfg()       // 当前设置
```

## 测试状态

在按 v1.6.5 真实 DOM 拼出的替身页面上验证通过：

- 「当前API预设」是原生连接配置块且排在第一位，6 个按钮点击后原生处理器照常触发
- 折叠区默认收起、状态被记住
- 新手提示 / 隐私提示 / 小钥匙 三者 `display: none`
- 点「加载模型」拿到模型后模型列表才出现
- custom ↔ claude 切换后，上一个 source 的字段全部归位
- `teardown()` 后 `#rm_api_block` 与加载前**逐字符一致**
- 重复 `apply()` 不堆积节点（44 → 44）

未在真机 TauriTavern 上跑过。
