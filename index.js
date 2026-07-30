/**
 * API 面板重排 (API Panel Layout)  v2
 * ------------------------------------------------------------------
 * 面向「用连接配置（API 预设）切换 API」的用法，把 TauriTavern 的
 * 「API 连接配置」面板压到最小：
 *
 *   当前API预设   [下拉框][详情][新建][保存][改名][重载][删除]   ← 原生 connection-manager
 *   ▸ 新建 / 编辑 API                                          ← 默认折叠
 *       端点（基础URL） / API密钥 / 模型名 / 模型列表 / 加载模型
 *
 * 平时只用最上面那一行切换预设；只有要新建或改一个 API 时才展开下面那块。
 *
 * 同时清掉这些占地方的东西：
 *   - 端点下面的「自定义端点预览 / 不行？在 URL 末尾添加 /v1 试试」新手提示
 *   - 密钥右边的「管理 API 密钥」小钥匙按钮（用预设保存就不需要它了）
 *   - 密钥下面的隐私提示
 *   - 模型列表在没加载出模型前不显示
 *
 * 设计原则：
 *   1. 只做 DOM 搬移 (move)，绝不 clone —— 原生 jQuery 事件绑定全部保留。
 *   2. 所有搬移 / 隐藏 / 改字都可逆：搬走的节点在原位留注释锚点，改写单独记账，
 *      关掉扩展时 DOM 逐字符还原。
 *   3. 不注入任何颜色 / 字体 / 圆角 / 阴影，只用原生 class，主题美化不冲突。
 *   4. 找不到某个原生元素时只隐藏该字段并打日志，绝不抛错破坏面板。
 */

const MODULE_NAME = 'apiPanelLayout';
const LOG = '[api-panel-layout]';
const ROOT_ID = 'ttal_root';

const DEFAULT_SETTINGS = {
    enabled: true,
    collapseEditor: false,   // 端点/密钥/模型名/模型列表 收进折叠区（用户要常显，默认关）
    editorOpen: false,       // 折叠区当前是否展开（记住上次状态）
    customLabels: true,      // 用中文新标签替换原生标签
    hideHints: true,         // 隐藏新手提示与「管理 API 密钥」按钮
    hideTestButton: true,    // 隐藏「发送测试信号」按钮（会真的花钱，用户明确不要）
    keyReveal: true,         // 密钥框右边加「小眼睛」，点一下看明文
    slimProfileButtons: true,// 连接配置那排只留「新建」「删除」，「保存」挪到按钮行
    profileNameField: true,  // 加一个「预设名称」输入框，新建时自动填进命名弹窗
    lazyModelList: true,     // 模型列表默认隐藏，加载成功后显示（只对另有「模型名」输入框的 source 生效）
    adoptExtras: true,       // 各家自己的额外字段也收进面板（Azure 部署名、Vertex 区域…）
    slimApiList: true,       // API 下拉只留「文本补全 / 聊天补全」
    debug: false,
};

/** 折叠区内部的槽位顺序（自上而下） */
const EDITOR_SLOTS = ['profileName', 'endpoint', 'key', 'modelName', 'modelList', 'extras', 'buttons'];

/**
 * 「Custom (OpenAI Responses / Claude Messages / Gemini Interactions)」在下拉框里是
 * 独立选项，但客户端内部把它们都算作 custom（openai.js: applyChatCompletionSourceSelection
 * 只改 custom_api_format），字段用的还是 custom 那一套 markup。
 * 不做这个归一化，选中它们时面板会一个字段都找不到。
 */
const SOURCE_ALIASES = {
    custom_openai_responses: 'custom',
    custom_claude_messages: 'custom',
    custom_gemini_interactions: 'custom',
};

/**
 * 各 chat completion source 的字段选择器。
 * key 一律是 #api_key_<source>，modelList 一律是 #model_<source>_select，
 * 只有对不上的、或者额外有端点 / 模型名输入框的才写在这里。
 */
const SOURCE_FIELDS = {
    custom: {
        endpoint: '#custom_api_url_text',
        modelName: '#custom_model_id',
    },
    azure_openai: {
        endpoint: '#azure_base_url',
        modelName: '#azure_deployment_name',
        modelList: '#azure_openai_model',
        // 这两个字段名跟通用叫法差得远，别把原生标签改成「端点」「模型名」
        labels: { endpoint: ['端点（Azure Base URL）', 'Endpoint (Azure Base URL)'], modelName: ['部署名（Deployment）', 'Deployment Name'] },
    },
    zai: {
        endpoint: '#zai_endpoint',
        labels: { endpoint: ['端点（Z.AI 接口）', 'Endpoint (Z.AI)'] },
    },
    makersuite: { modelList: '#model_google_select' },
};

const LABELS = {
    profile: ['当前API预设', 'Connection Profile'],
    editor: ['新建 / 编辑 API', 'Create / edit an API'],
    endpoint: ['端点（基础URL）', 'Endpoint (Base URL)'],
    key: ['API密钥', 'API Key'],
    modelName: ['模型名', 'Model Name'],
    modelList: ['模型列表', 'Model List'],
    loadModels: ['加载模型', 'Load Models'],
    additionalParams: ['附加参数', 'Additional Parameters'],
    profileName: ['预设名称', 'Profile Name'],
    profileNameHint: ['留空则用客户端默认名', 'Leave empty to use the default name'],
    keyHint: ['sk-...', 'sk-...'],
    saveProfile: ['保存预设', 'Save Profile'],
    showKey: ['显示密钥明文', 'Show key'],
    hideKey: ['隐藏密钥', 'Hide key'],
};

/* ------------------------------------------------------------------ utils */

function ctx() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function cfg() {
    const store = ctx()?.extensionSettings;
    if (!store) return { ...DEFAULT_SETTINGS };
    if (!store[MODULE_NAME]) store[MODULE_NAME] = {};
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (store[MODULE_NAME][k] === undefined) store[MODULE_NAME][k] = v;
    }
    return store[MODULE_NAME];
}

function saveCfg() {
    try {
        ctx()?.saveSettingsDebounced?.();
    } catch { /* ignore */ }
}

function dbg(...args) {
    if (cfg().debug) console.log(LOG, ...args);
}

function warn(...args) {
    console.warn(LOG, ...args);
}

function isZh() {
    try {
        const lang = String(localStorage.getItem('language') || document.documentElement.lang || navigator.language || '');
        return lang.toLowerCase().startsWith('zh');
    } catch {
        return false;
    }
}

function t(key) {
    const pair = LABELS[key];
    if (!pair) return key;
    return isZh() ? pair[0] : pair[1];
}

/**
 * 解析原生元素。TauriTavern 的 panel-runtime 会在抽屉关闭时把面板子树从文档里
 * 摘下来（parking），此时 querySelector 找不到元素，因此做一层引用缓存：
 * 拿到过就一直复用，即使暂时 detached 也能继续驱动它。
 */
const nativeCache = new Map();

function native(selector) {
    if (!selector) return null;
    const live = document.querySelector(selector);
    if (live) {
        nativeCache.set(selector, live);
        return live;
    }
    const cached = nativeCache.get(selector);
    return cached && cached.nodeType === 1 ? cached : null;
}

/* -------------------------------------------------- 可逆搬移（锚点记账） */

/** el -> { anchor: Comment } */
const moved = new Map();

function isSynthetic(el) {
    return el?.dataset?.ttalSynthetic === '1';
}

function markSynthetic(el) {
    if (el && el.nodeType === 1) el.dataset.ttalSynthetic = '1';
    return el;
}

/** 记账：在原位插入注释锚点，便于精确还原 */
function track(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isSynthetic(el) || moved.has(el)) return true;
    if (!el.parentNode) return false;
    const anchor = document.createComment(`ttal:${el.id || el.tagName.toLowerCase()}`);
    el.parentNode.insertBefore(anchor, el);
    moved.set(el, { anchor });
    return true;
}

/** 还原回原位（合成节点直接摘掉） */
function restoreNode(el) {
    const record = moved.get(el);
    if (!record) {
        if (isSynthetic(el)) el.remove();
        return;
    }
    try {
        if (record.anchor.parentNode) record.anchor.parentNode.insertBefore(el, record.anchor);
        else el.remove();
        record.anchor.remove();
    } catch (error) {
        warn('restore failed', el, error);
    }
    moved.delete(el);
}

function releaseAll() {
    for (const el of Array.from(moved.keys())) restoreNode(el);
    moved.clear();
}

/** 属性 / 文本改写的还原记录 */
const patched = new Map();

/** 我们挂在原生节点上的监听：tag 去重，teardown 时精确解绑 —— 不往真实 DOM 写任何标记属性 */
const hooks = new Map();

function hook(el, tag, type, fn, capture = true) {
    if (!el) return;
    let list = hooks.get(el);
    if (!list) hooks.set(el, (list = []));
    if (list.some((h) => h.tag === tag)) return;
    el.addEventListener(type, fn, capture);
    list.push({ tag, type, fn, capture });
}

function unhookAll() {
    for (const [el, list] of hooks) {
        for (const h of list) {
            try { el.removeEventListener(h.type, h.fn, h.capture); } catch { /* ignore */ }
        }
    }
    hooks.clear();
}

function patchRecord(el) {
    if (!patched.has(el)) patched.set(el, {});
    return patched.get(el);
}

function patchText(el, text) {
    if (!el || !text) return;
    const record = patchRecord(el);
    if (record.html === undefined) {
        record.html = el.innerHTML;
        record.i18n = el.getAttribute('data-i18n');
    }
    if (el.textContent === text && !el.hasAttribute('data-i18n')) return;
    el.removeAttribute('data-i18n'); // 防止 i18n 重新翻译时覆盖新标签
    el.textContent = text;
}

function patchAttr(el, name, value) {
    if (!el) return;
    const key = `${name}@`;
    const record = patchRecord(el);
    if (record[key] === undefined) record[key] = el.getAttribute(name);
    if (value === null) el.removeAttribute(name);
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** 可逆地补 class；幂等 —— 已经有的不再重复追加（否则每次 apply 都会把 class 越写越长） */
function addCls(el, ...names) {
    if (!el) return;
    const missing = names.filter((n) => n && !el.classList.contains(n));
    if (!missing.length) return;
    patchAttr(el, 'class', `${el.className} ${missing.join(' ')}`.replace(/\s+/g, ' ').trim());
}

/** 可逆隐藏 */
function hideNode(el) {
    addCls(el, 'ttal-hidden');
}

function unpatchAll() {
    for (const [el, rec] of patched) {
        try {
            if (rec.html !== undefined) el.innerHTML = rec.html;
            if (rec.i18n) el.setAttribute('data-i18n', rec.i18n);
            for (const [k, v] of Object.entries(rec)) {
                if (!k.endsWith('@')) continue;
                const name = k.slice(0, -1);
                if (v === null) el.removeAttribute(name);
                else el.setAttribute(name, v);
            }
        } catch (error) {
            warn('unpatch failed', el, error);
        }
    }
    patched.clear();
}

/* ------------------------------------------------ 原生「字段组」的识别 */

const HEADINGS = 'h1,h2,h3,h4,h5,h6,label,.standoutHeader,.range-block-title';

/** 说明性节点：小字提示、隐私警告等 */
function isNoteNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches('small, .neutral_warning, .info-block, .toggle-description')) return true;
    if (el.hasAttribute('data-for')) return true;
    if (el.tagName === 'DIV' && el.children.length === 1 && el.firstElementChild.tagName === 'SMALL') return true;
    return false;
}

/**
 * 标签和控件之间的夹层：一句说明、一个「去拿 key / 看用量 / 看余额」的链接。
 * 里面一旦有真控件就不算，免得把别人的字段吞掉。
 */
function isSideNote(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.querySelector('input, select, textarea, .menu_button')) return false;
    if (el.matches('span, small, p')) return true;
    return !!el.querySelector('a') && (el.textContent || '').trim().length < 200;
}

/** 控件所属的 source 容器（最近的 [data-source] 祖先） */
function sourceHostOf(el) {
    let node = el;
    while (node && node !== document.body) {
        if (node.nodeType === 1 && node.hasAttribute?.('data-source')) return node;
        if (node.id === 'openai_api') return null;
        node = node.parentElement;
    }
    return null;
}

/**
 * 把一个原生控件展开成「标签 + 主体 + 补充说明」三段，方便整组搬移。
 * @returns {{label: Element|null, body: Element, extras: Element[]}|null}
 */
/**
 * 已经在槽位里的字段，直接沿用上一轮的分组。
 * 不这么做的话，第二次装配时控件的 [data-source] 祖先已经换成了我们的槽位，
 * groupOf 会重新判定出一个更小的主体（比如只剩那个 select），
 * 原来一起搬过来的外层容器就被 sweepSlots 塞回原处 —— 面板下面于是多出一堆散件。
 */
function groupInSlot(ctrl) {
    const slot = ctrl.closest?.('.ttal-slot');
    if (!slot || !slot.dataset?.ttalSlot) return null;
    let body = ctrl;
    while (body.parentElement && body.parentElement !== slot) body = body.parentElement;
    if (body.parentElement !== slot) return null;

    const kids = Array.from(slot.children).filter(kid => !isSynthetic(kid));
    const index = kids.indexOf(body);
    if (index < 0) return null;
    let label = null;
    const leading = [];
    for (const kid of kids.slice(0, index)) {
        if (!label && kid.matches(HEADINGS)) label = kid;
        else leading.push(kid);
    }
    return { label, body, leading, extras: kids.slice(index + 1) };
}

function groupOf(ctrl) {
    if (!ctrl) return null;
    const settled = groupInSlot(ctrl);
    if (settled) return settled;
    const host = sourceHostOf(ctrl);
    let body = ctrl;

    if (host && host.contains(ctrl) && ctrl !== host) {
        // 提升到 source 容器的直接子节点，保证 <h4> 与输入框是兄弟关系
        while (body.parentElement && body.parentElement !== host) body = body.parentElement;
    } else {
        // 注意：绝不能用 ctrl.closest(...)，因为输入框自己就常带 wide100p，
        // 会匹配到自身，导致第二次装配时把外层容器和标签丢回原处（曾经的 bug）。
        // 从父节点开始找，且跳过我们自己的合成槽位。
        const parent = ctrl.parentElement;
        const wrapper = parent && !isSynthetic(parent)
            ? parent.closest('.flex-container, .wide100p, .range-block')
            : null;
        body = wrapper && !isSynthetic(wrapper) ? wrapper : ctrl;
    }
    if (!body || body === document.body) return null;

    // 往上找标签。标签和输入框之间常常还夹着一两行说明或一个链接
    // （OpenAI 的「查看用量」、Claude 的「去控制台拿 key」、Chutes 的「看余额」……），
    // 以前一碰到这种夹层就判定「没有标签」，于是原生标签留在原地、我们又造一个，
    // 同一个字段出现两个标题。现在把夹层收进这一组，继续往上找真正的标签。
    let label = null;
    const leading = [];
    let prev = body.previousElementSibling;
    while (prev) {
        if (prev.nodeType !== 1 || prev.tagName === 'INPUT' || prev.tagName === 'DATALIST') {
            prev = prev.previousElementSibling;
            continue;
        }
        if (prev.matches(HEADINGS)) { label = prev; break; }
        if (isNoteNode(prev) || isSideNote(prev)) {
            leading.unshift(prev);
            prev = prev.previousElementSibling;
            continue;
        }
        break;
    }

    const extras = [];
    let next = body.nextElementSibling;
    while (next && isNoteNode(next) && !next.matches(HEADINGS)) {
        extras.push(next);
        next = next.nextElementSibling;
    }
    return { label, body, leading, extras };
}

/* ------------------------------------------------------- 合成控件构造 */

function makeLabel(text) {
    const h4 = document.createElement('h4');
    h4.className = 'margin0 ttal-label';
    h4.textContent = text;
    return markSynthetic(h4);
}

/** 合成控件单例 / 槽位 */
const ui = {};

/** 本轮 apply 用过的节点，用于回收上一轮残留 */
let passUsed = null;
/** slot -> 下一个待写入位置；位置已正确时不产生任何 DOM 变更 */
const slotCursor = new Map();
/** 合成标签缓存：同槽位同文本复用同一节点，避免反复 apply 时堆积 */
const labelCache = new Map();

function cachedLabel(slot, text) {
    const key = `${slot?.dataset?.ttalSlot || '?'}|${text}`;
    let el = labelCache.get(key);
    if (!el || el.nodeType !== 1) {
        el = makeLabel(text);
        labelCache.set(key, el);
    }
    return el;
}

/**
 * 把节点搬到槽位的「下一个位置」。已在正确位置时不做任何 DOM 操作，
 * 因此可以反复调用而不会自激 MutationObserver。
 */
function adopt(slot, el) {
    if (!slot || !el || el.nodeType !== 1) return null;
    passUsed?.add(el);
    track(el);
    const cursor = slotCursor.get(slot) ?? 0;
    const seat = slot.children[cursor] ?? null;
    if (seat !== el) slot.insertBefore(el, seat);
    slotCursor.set(slot, cursor + 1);
    return el;
}

/** 把整组搬进槽位；hideHints 打开时顺手隐藏说明性节点 */
function adoptGroup(slot, ctrl, labelText) {
    const group = groupOf(ctrl);
    if (!group) return null;
    if (group.label) {
        adopt(slot, group.label);
        if (labelText && cfg().customLabels) patchText(group.label, labelText);
    } else if (labelText) {
        adopt(slot, cachedLabel(slot, labelText));
    }
    // 夹层跟着一起搬：纯说明按 hideHints 隐藏，带链接的（看用量 / 拿 key）留着
    for (const lead of group.leading || []) {
        adopt(slot, lead);
        if (cfg().hideHints && isNoteNode(lead)) hideNode(lead);
    }
    adopt(slot, group.body);
    for (const extra of group.extras) {
        adopt(slot, extra);
        if (cfg().hideHints) hideNode(extra);
    }
    return group;
}

/** 回收槽位里本轮没用到的残留节点 */
function sweepSlots() {
    for (const slot of Object.values(ui.slots || {})) {
        const keep = slotCursor.get(slot) ?? 0;
        for (const child of Array.from(slot.children).slice(keep)) {
            if (!passUsed?.has(child)) restoreNode(child);
        }
        slot.classList.toggle('ttal-empty', slot.children.length === 0);
    }
}

/* ------------------------------------------------------------ 根节点结构 */

function buildRoot() {
    if (ui.root && ui.root.nodeType === 1) return ui.root;

    const root = markSynthetic(document.createElement('div'));
    root.id = ROOT_ID;
    root.className = 'flex-container flexFlowColumn ttal-root';
    ui.slots = {};

    const makeSlot = (name) => {
        const slot = markSynthetic(document.createElement('div'));
        slot.className = `flex-container flexFlowColumn ttal-slot ttal-slot-${name}`;
        slot.dataset.ttalSlot = name;
        ui.slots[name] = slot;
        return slot;
    };

    root.appendChild(makeSlot('profile'));

    // 折叠区：标题行 + 内容
    const editor = markSynthetic(document.createElement('div'));
    editor.className = 'ttal-editor';

    const header = markSynthetic(document.createElement('div'));
    header.className = 'ttal-editor-header flex-container alignItemsCenter';
    const caret = document.createElement('div');
    caret.className = 'fa-solid fa-circle-chevron-down fa-fw ttal-caret';
    const title = document.createElement('b');
    title.textContent = t('editor');
    header.append(caret, title);
    header.addEventListener('click', () => {
        const c = cfg();
        c.editorOpen = !c.editorOpen;
        saveCfg();
        applyEditorState();
    });

    const body = markSynthetic(document.createElement('div'));
    body.className = 'ttal-editor-body flex-container flexFlowColumn';
    for (const name of EDITOR_SLOTS) body.appendChild(makeSlot(name));

    editor.append(header, body);
    root.appendChild(editor);

    ui.root = root;
    ui.editor = editor;
    ui.editorHeader = header;
    ui.editorBody = body;
    return root;
}

/** 折叠状态：collapseEditor 关掉时永远展开、不显示标题行 */
function applyEditorState() {
    if (!ui.editor) return;
    const collapse = cfg().collapseEditor;
    const open = !collapse || cfg().editorOpen;
    ui.editorHeader.classList.toggle('ttal-hidden', !collapse);
    ui.editorBody.classList.toggle('ttal-hidden', !open);
    ui.editor.classList.toggle('ttal-open', open);
}

/* --------------------------------------------------------- source / 字段 */

/** 下拉框里选的那一项（可能是 custom 的变体） */
function rawSource() {
    return native('#chat_completion_source')?.value || '';
}

/** 客户端内部真正生效的 source，字段查找一律用这个 */
function currentSource() {
    const raw = rawSource();
    return SOURCE_ALIASES[raw] || raw;
}

function isChatCompletion() {
    const main = native('#main_api')?.value;
    return !main || main === 'openai';
}

/** SOURCE_FIELDS 里显式写了就用，否则按 SillyTavern 命名惯例推导 */
function fieldsFor(source) {
    const base = SOURCE_FIELDS[source] || {};
    const pick = (slot, fallback) => {
        const override = base.labels?.[slot];
        return override ? (isZh() ? override[0] : override[1]) : fallback;
    };
    return {
        endpoint: base.endpoint ?? null,
        key: base.key ?? (source ? `#api_key_${source}` : null),
        modelName: base.modelName ?? null,
        modelList: base.modelList ?? (source ? `#model_${source}_select` : null),
        label: {
            endpoint: pick('endpoint', t('endpoint')),
            key: pick('key', t('key')),
            modelName: pick('modelName', t('modelName')),
            modelList: pick('modelList', t('modelList')),
        },
    };
}

/** 面板容器：Chat Completion 区块，退化到整个 API 抽屉 */
function panelHost() {
    return document.querySelector('#openai_api') || document.querySelector('#rm_api_block');
}

/**
 * 给整个 API 抽屉打上 .ttal-panel，让统一的尺寸规则也覆盖到面板里
 * 不归我们管的原生控件（API / Chat Completion Source / Prompt Post-Processing）。
 * 这里故意用 classList 而不是 patchAttr：#rm_api_block 的 class 会被客户端
 * 反复改（closedDrawer / openDrawer），记录旧值再还原会把抽屉状态弄坏。
 */
function markPanel(on) {
    const panel = document.querySelector('#rm_api_block');
    if (!panel) return;
    panel.classList.toggle('ttal-panel', !!on);
}

/** 根节点插到「Chat Completion Source」下拉框之后 */
function ensureMounted(root) {
    const host = panelHost();
    if (!host) return false;

    let anchor = native('#chat_completion_source');
    if (anchor) {
        while (anchor.parentElement && anchor.parentElement !== host) anchor = anchor.parentElement;
        if (anchor.parentElement !== host) anchor = null;
    }
    const seat = anchor ? anchor.nextElementSibling : host.firstElementChild;
    if (root.parentElement === host && seat === root) return true;
    host.insertBefore(root, seat);
    return true;
}

/* --------------------------------------------------------- 逐槽位装配 */

/**
 * 当前API预设：把原生 connection-manager 的整块（下拉框 + 6 个按钮）搬进来。
 * 它原本被插在 #rm_api_block 最顶部，这里只是换个位置，逻辑一行没动。
 */
function layoutProfile(slot) {
    const select = native('#connection_profiles');
    const block = select?.closest('.wide100p') || select?.parentElement?.parentElement;
    if (!block) {
        slot.classList.add('ttal-hidden');
        dbg('connection profile block not found — 连接管理器未加载？');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adopt(slot, block);
    if (cfg().customLabels) {
        const heading = block.querySelector('h3 span[data-i18n], h3 span');
        if (heading) patchText(heading, t('profile'));
    }
    // 那排图标是原生「连接配置」的功能，一个都不删，只把用不上的隐藏掉。
    // 「保存」（#update_connection_profile）会被 layoutButtons 挪到按钮行去。
    if (cfg().slimProfileButtons) {
        for (const id of PROFILE_EXTRA_BUTTONS) hideNode(native(`#${id}`));
    }
}

/** 连接配置那排里，日常用不上的按钮：详情 / 改名 / 重载 */
const PROFILE_EXTRA_BUTTONS = [
    'view_connection_profile',
    'edit_connection_profile',
    'reload_connection_profile',
];

/* ---------------- 预设名称：自己加的输入框，喂给原生命名弹窗 ---------------- */

function profileNameInput() {
    if (ui.nameInput) return ui.nameInput;
    const input = markSynthetic(document.createElement('input'));
    input.id = 'ttal_profile_name';
    input.type = 'text';
    input.className = 'text_pole wide100p ttal-profile-name';
    input.autocomplete = 'off';
    input.placeholder = t('profileNameHint');
    ui.nameInput = input;
    return input;
}

/**
 * 原生「新建 / 改名」都是弹一个 INPUT 弹窗、里面预填一个建议名字。
 * 这里在点击后把我们输入框里的名字塞进那个弹窗，省得每次手打。
 * 找不到弹窗就什么都不做 —— 原生流程照旧。
 */
function feedNameToPopup() {
    const wanted = ui.nameInput?.value?.trim();
    if (!wanted) return;
    const deadline = Date.now() + 2000;
    const tick = () => {
        const dialogs = Array.from(document.querySelectorAll('dialog.popup[open], dialog[open] .popup-body, .popup:not(.ttal-hidden)'));
        for (const scope of dialogs.reverse()) {
            const field = scope.querySelector('textarea.popup-input, input.popup-input, .popup-input, textarea.text_pole, input.text_pole');
            if (field) {
                field.value = wanted;
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
                field.focus?.();
                field.select?.();
                dbg('profile name fed to popup:', wanted);
                return;
            }
        }
        if (Date.now() < deadline) setTimeout(tick, 60);
        else dbg('命名弹窗没找到，跳过预填');
    };
    setTimeout(tick, 60);
}

function layoutProfileName(slot) {
    if (!cfg().profileNameField) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adopt(slot, cachedLabel(slot, t('profileName')));
    adopt(slot, profileNameInput());

    for (const id of ['create_connection_profile', 'edit_connection_profile', 'update_connection_profile']) {
        hook(native(`#${id}`), 'nameHook', 'click', () => feedNameToPopup());
    }
}

/** 端点 / 模型名 / 模型列表：把原生字段组搬过来 */
function layoutNativeField(slot, selector, labelText) {
    const ctrl = selector ? native(selector) : null;
    if (!ctrl) {
        slot.classList.add('ttal-hidden');
        return null;
    }
    slot.classList.remove('ttal-hidden');
    return adoptGroup(slot, ctrl, labelText);
}

/**
 * 密钥框右边的「小眼睛」。
 * 原生的密钥框是 type="text"（明文），所以本插件默认把它遮成圆点，点眼睛才看明文。
 * - 单例合成节点，每轮装配跟着当前 source 的密钥框走
 * - type 的改写走 patchAttr，teardown() 还原成原生的 text
 * - 框里是空的（存过密钥后客户端会清空输入框）就直接开原生「查看隐藏的 API 密钥」弹窗
 */
function maskKey(input) {
    if (input && input.type !== 'password') patchAttr(input, 'type', 'password');
}

function setEyeState(reveal) {
    const eye = ui.eye;
    if (!eye) return;
    ui.eyeRevealed = reveal;
    eye.classList.toggle('fa-eye-slash', reveal);
    eye.classList.toggle('fa-eye', !reveal);
    eye.title = reveal ? t('hideKey') : t('showKey');
}

function keyEye() {
    if (ui.eye) return ui.eye;
    const eye = markSynthetic(document.createElement('div'));
    eye.className = 'menu_button fa-solid fa-eye fa-fw ttal-eye';
    eye.title = t('showKey');
    eye.addEventListener('click', () => {
        const input = ui.eyeInput;
        if (!input) return;
        const reveal = !ui.eyeRevealed;
        patchAttr(input, 'type', reveal ? 'text' : 'password');
        setEyeState(reveal);
        if (reveal && !input.value) {
            // 框里没东西：明文也看不到什么，直接开原生的已存密钥弹窗
            document.querySelector('#viewSecrets')?.click();
        }
    });
    ui.eye = eye;
    return eye;
}

/** 把小眼睛放到密钥输入框右边（同一行内，不占独立一行） */
function mountKeyEye(input) {
    if (!cfg().keyReveal) {
        ui.eye?.remove();
        ui.eyeInput = null;
        ui.eyeRevealed = false;
        return;
    }
    const eye = keyEye();
    const switched = ui.eyeInput !== input;
    ui.eyeInput = input;
    if (input.nextElementSibling !== eye) input.after(eye);
    passUsed?.add(eye); // 万一它成了槽位的直接子节点，别被 sweepSlots 当残留清掉
    if (switched) {
        // 换了 source：新框一律先遮上，图标复位
        maskKey(input);
        setEyeState(false);
    } else if (!ui.eyeRevealed) {
        maskKey(input);
    }
}

/** API 密钥：搬组 + 干掉右边的「管理 API 密钥」小钥匙 */
function layoutKey(slot, fields) {
    const input = fields.key ? native(fields.key) : null;
    if (!input) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adoptGroup(slot, input, fields.label?.key || t('key'));
    // 空的密钥框给个占位提示，跟端点框一样有个小虚字。
    // 客户端自己往 placeholder 里写东西时（比如提示密钥已保存）不覆盖它。
    if (cfg().customLabels && !input.placeholder) patchAttr(input, 'placeholder', t('keyHint'));
    if (cfg().hideHints) {
        for (const btn of slot.querySelectorAll('.manage-api-keys')) hideNode(btn);
    }
    mountKeyEye(input);
}

/* ------------------------------------------------- 各家自己的额外字段 */

/**
 * 当前 source 生效的原生表单块（[data-source] 顶层容器）。
 * 判断规则照抄客户端 openai.js：逗号分隔白名单，data-source-mode="except" 时取反。
 */
function sourceHosts(source) {
    const host = panelHost();
    if (!host) return [];
    return Array.from(host.querySelectorAll('[data-source]'))
        .filter(el => !el.parentElement?.closest('[data-source]'))
        .filter(el => {
            const list = String(el.dataset.source || '').split(',').map(s => s.trim());
            const matches = list.includes(source);
            return el.dataset.sourceMode === 'except' ? !matches : matches;
        });
}

/**
 * 端点 / 密钥 / 模型之外，这一家还有的字段（Azure 的部署名与 API 版本、
 * Vertex 的认证方式与区域、OpenRouter 的排序与服务商、反向代理抽屉……）
 * 按原生顺序收进「其它」槽位，位置在模型列表之后、按钮行之前。
 * 一个都不删、不改字，只是让它们也待在面板里，跟着同一套尺寸与间距走。
 */
function layoutExtras(slot) {
    if (!cfg().adoptExtras) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    const hosts = new Set(sourceHosts(currentSource()));

    // 第一步：上一轮已经搬进来、老家还是当前 source 的节点，原位留着。
    // 少了这一步，第二次装配时原生容器已经空了，sweepSlots 会把它们全塞回去，
    // 于是「重排一次好使、再重排一次就散架」。
    for (const child of Array.from(slot.children)) {
        if (isSynthetic(child)) continue;
        const home = moved.get(child)?.anchor?.parentNode;
        if (home && hosts.has(home)) adopt(slot, child);
    }
    // 第二步：还留在原生容器里的，按原生顺序补上
    for (const host of hosts) {
        for (const child of Array.from(host.children)) {
            if (isSynthetic(child) || passUsed?.has(child)) continue;
            adopt(slot, child);
        }
    }
}

/** 按钮行：整行搬过来，只改「Connect」「Additional Parameters」的字 */
function layoutButtons(slot) {
    const connect = native('#api_button_openai');
    if (!connect) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    const row = connect.parentElement;
    if (row && row !== slot && !row.id) adopt(slot, row);
    else adopt(slot, connect);

    // 「保存预设」= 原生 #update_connection_profile，从连接配置那排挪到这里，
    // 位置在「加载模型」和「附加参数」之间。逻辑还是原生的。
    if (cfg().slimProfileButtons) {
        const save = native('#update_connection_profile');
        const buttonRow = connect.parentElement;
        if (save && buttonRow) {
            const extra = native('#customize_additional_parameters');
            const seat = extra && extra.parentElement === buttonRow ? extra : null;
            if (save.parentElement !== buttonRow || (seat && save.nextElementSibling !== seat)) {
                track(save);
                buttonRow.insertBefore(save, seat);
            }
            passUsed?.add(save);
            if (cfg().customLabels) {
                addCls(save, 'menu_button_icon', 'ttal-save-profile');
                patchText(save, t('saveProfile'));
            }
        }
    }

    if (cfg().customLabels) {
        patchText(connect, t('loadModels'));
        const extra = native('#customize_additional_parameters');
        if (extra) patchText(extra, t('additionalParams'));
    }
    hook(connect, 'modelLoad', 'click', () => beginModelLoad());
}

/**
 * 隐藏「发送测试信号」（#test_api_button）。
 * 它被搬进折叠区后，原本靠 CSS 路径隐藏它的第三方插件会失配，所以这里自己隐藏。
 * 走 hideNode → patchAttr，teardown() 时原样还原。
 */
function hideTestButton() {
    if (!cfg().hideTestButton) return;
    for (const btn of document.querySelectorAll('#test_api_button, .test_api_button')) hideNode(btn);
}

/**
 * API 下拉（#main_api）里只留「文本补全 / 聊天补全」，
 * NovelAI / AI Horde / KoboldAI 隐藏起来（不删，teardown 时原样还原）。
 */
const HIDDEN_MAIN_APIS = ['novel', 'koboldhorde', 'kobold'];

function slimApiList() {
    const select = native('#main_api');
    if (!select || !cfg().slimApiList) return;
    for (const option of select.options) {
        if (HIDDEN_MAIN_APIS.includes(option.value) && option.value !== select.value) hideNode(option);
    }
}

/* ---------------------- 模型列表：加载成功后才显示 */

/** 已成功加载过模型的 source 集合 */
const modelsLoaded = new Set();
let modelWatch = null;

function modelListSelect() {
    const selector = fieldsFor(currentSource()).modelList;
    return selector ? native(selector) : null;
}

function selectHasModels(select) {
    if (!select) return false;
    return Array.from(select.options).some(option => option.value && option.value !== 'none');
}

function updateModelListVisibility() {
    const slot = ui.slots?.modelList;
    if (!slot || slot.children.length === 0) return;
    const select = modelListSelect();
    if (selectHasModels(select)) modelsLoaded.add(currentSource());
    // 只有另外还有「模型名」输入框的 source（custom、azure）才值得先藏起来：
    // 别家的下拉框是唯一的模型入口，藏了就比原生少东西了。
    const hasNameField = !!fieldsFor(currentSource()).modelName;
    const shouldShow = !cfg().lazyModelList || !hasNameField || modelsLoaded.has(currentSource());
    slot.classList.toggle('ttal-hidden', !shouldShow);
}

/** 点「加载模型」后观察模型下拉框，拿到模型就显示出来 */
function beginModelLoad() {
    const source = currentSource();
    const select = modelListSelect();
    if (!select) return;

    modelWatch?.observer?.disconnect();
    clearTimeout(modelWatch?.timer);

    const finish = (success) => {
        modelWatch?.observer?.disconnect();
        clearTimeout(modelWatch?.timer);
        modelWatch = null;
        if (success) {
            modelsLoaded.add(source);
            updateModelListVisibility();
            dbg('model list revealed for', source);
        }
    };

    const observer = new MutationObserver(() => {
        if (selectHasModels(select)) finish(true);
    });
    observer.observe(select, { childList: true, subtree: true });
    modelWatch = { observer, timer: setTimeout(() => finish(selectHasModels(select)), 45000), source };

    if (selectHasModels(select)) finish(true);
}

/* --------------------------------------------------- apply / teardown */

let applying = false;
let applyTimer = null;
let panelObserver = null;
let syncTimer = null;

function schedule(immediate = false) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(apply, immediate ? 0 : 200);
}

function apply() {
    if (!cfg().enabled) {
        teardown();
        return;
    }
    if (!panelHost()) return;
    // 主 API 不是 Chat Completion 时，客户端会把整个 #openai_api 藏起来。
    // 「连接配置（API 预设）」原本挂在 #rm_api_block 顶部、对所有 API 都可见，
    // 被我们搬进 #openai_api 后会跟着一起消失 —— 所以这时要完整还原，
    // 等切回 Chat Completion 再重新装配（#main_api 的 change 已经监听了）。
    if (!isChatCompletion()) {
        if (ui.root && document.contains(ui.root)) {
            dbg('主 API 不是 Chat Completion，先还原，避免连接配置被一起隐藏');
            teardown();
        }
        return;
    }

    applying = true;
    try {
        const root = buildRoot();
        if (!ensureMounted(root)) return;
        markPanel(true);

        const fields = fieldsFor(currentSource());
        passUsed = new Set();
        slotCursor.clear();

        layoutProfile(ui.slots.profile);
        layoutProfileName(ui.slots.profileName);
        layoutNativeField(ui.slots.endpoint, fields.endpoint, fields.label.endpoint);
        layoutKey(ui.slots.key, fields);
        layoutNativeField(ui.slots.modelName, fields.modelName, fields.label.modelName);
        layoutNativeField(ui.slots.modelList, fields.modelList, fields.label.modelList);
        layoutExtras(ui.slots.extras);
        layoutButtons(ui.slots.buttons);
        hideTestButton();
        slimApiList();

        sweepSlots();
        passUsed = null;
        applyEditorState();
        updateModelListVisibility();
    } catch (error) {
        warn('apply failed', error);
    } finally {
        setTimeout(() => { applying = false; }, 50);
    }
}

/** 完全还原：搬移归位、改写回滚、合成节点摘除 */
function teardown() {
    applying = true;
    try {
        modelWatch?.observer?.disconnect();
        clearTimeout(modelWatch?.timer);
        modelWatch = null;

        markPanel(false);
        ui.eye?.remove();
        ui.eyeInput = null;
        ui.eyeRevealed = false;
        ui.nameInput?.remove();
        unhookAll();
        releaseAll();
        unpatchAll();
        ui.root?.remove();
        for (const slot of Object.values(ui.slots || {})) slot.replaceChildren();
        slotCursor.clear();
        dbg('torn down');
    } catch (error) {
        warn('teardown failed', error);
    } finally {
        setTimeout(() => { applying = false; }, 50);
    }
}

/* ------------------------------------------- 事件绑定与观察器 */

const EVENT_NAMES = [
    'APP_READY',
    'SETTINGS_UPDATED',
    'ONLINE_STATUS_CHANGED',
    'CONNECTION_PROFILE_LOADED',
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
    'CHATCOMPLETION_SOURCE_CHANGED',
];

function bindEvents() {
    const jq = globalThis.jQuery || globalThis.$;
    if (jq) {
        // 委托挂在 document 上：面板被 parking（摘下重挂）后依然有效
        jq(document).on('change', '#chat_completion_source, #main_api', () => schedule(true));
        jq(document).on('click', '#api_button_openai', () => schedule());
    } else {
        document.addEventListener('change', (event) => {
            if (event.target?.matches?.('#chat_completion_source, #main_api')) schedule(true);
        }, true);
    }

    const c = ctx();
    const source = c?.eventSource;
    const types = c?.eventTypes || c?.event_types;
    if (source?.on && types) {
        for (const name of EVENT_NAMES) {
            const evt = types[name];
            if (!evt) continue;
            try {
                source.on(evt, () => schedule());
            } catch (error) {
                dbg('event bind failed', name, error);
            }
        }
    }

    const target = document.querySelector('#rm_api_block') || document.body;
    panelObserver?.disconnect();
    panelObserver = new MutationObserver(() => {
        if (!applying) schedule();
    });
    panelObserver.observe(target, { childList: true, subtree: true });

    clearInterval(syncTimer);
    syncTimer = setInterval(() => {
        if (!document.querySelector('#ttal_settings')) {
            try { buildSettingsUI(); } catch { /* ignore */ }
        }
        if (!cfg().enabled) return;
        if (ui.root && document.contains(ui.root) && ui.root.offsetParent) updateModelListVisibility();
    }, 1000);
}

/* --------------------------------------------------- 扩展设置面板 */

const SETTING_ITEMS = [
    ['enabled', '启用重排', 'Enable layout'],
    ['collapseEditor', '把端点/密钥/模型折叠起来', 'Collapse endpoint/key/model fields'],
    ['customLabels', '使用中文标签', 'Use custom labels'],
    ['hideHints', '隐藏新手提示与管理密钥按钮', 'Hide hints and the manage-keys button'],
    ['hideTestButton', '隐藏「发送测试信号」按钮', 'Hide the Test Message button'],
    ['keyReveal', '密钥框加「小眼睛」查看明文', 'Add an eye button to reveal the key'],
    ['slimProfileButtons', '连接配置只留新建/删除（保存挪到按钮行）', 'Slim down connection-profile buttons'],
    ['profileNameField', '显示「预设名称」输入框', 'Show the profile name field'],
    ['lazyModelList', '模型列表加载后再显示', 'Reveal model list only after loading'],
    ['adoptExtras', '各家额外字段也收进面板', 'Adopt per-source extra fields'],
    ['slimApiList', 'API 只留文本补全 / 聊天补全', 'Keep only Text / Chat Completion in the API list'],
    ['debug', '调试日志', 'Debug logging'],
];

function buildSettingsUI() {
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host || document.querySelector('#ttal_settings')) return;

    const block = document.createElement('div');
    block.id = 'ttal_settings';
    block.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${isZh() ? 'API 面板重排' : 'API Panel Layout'}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content flex-container flexFlowColumn"></div>
        </div>`;
    const content = block.querySelector('.inline-drawer-content');

    for (const [key, zh, en] of SETTING_ITEMS) {
        const label = document.createElement('label');
        label.className = 'checkbox_label';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = `ttal_opt_${key}`;
        box.checked = !!cfg()[key];
        const span = document.createElement('span');
        span.textContent = isZh() ? zh : en;
        box.addEventListener('change', () => {
            cfg()[key] = box.checked;
            saveCfg();
            if (key === 'enabled' && !box.checked) {
                teardown();
            } else if (key === 'customLabels' || key === 'hideHints' || key === 'hideTestButton' || key === 'keyReveal'
                || key === 'slimProfileButtons' || key === 'profileNameField') {
                // 这两项改写了原生节点，先回滚再重排
                teardown();
                setTimeout(() => schedule(true), 80);
            } else {
                schedule(true);
            }
        });
        label.append(box, span);
        content.appendChild(label);
    }
    host.appendChild(block);
}

/* --------------------------------------------------------- 初始化 */

function start() {
    try {
        buildSettingsUI();
    } catch (error) {
        warn('settings ui failed', error);
    }
    bindEvents();
    schedule(true);
    // 面板 / 连接管理器可能晚于本扩展就绪，补两次延迟重试
    setTimeout(() => schedule(), 1500);
    setTimeout(() => schedule(), 5000);
    console.log(LOG, 'ready');
}

globalThis[MODULE_NAME] = { apply, teardown, cfg, ui };

const jqReady = globalThis.jQuery || globalThis.$;
if (jqReady) jqReady(() => start());
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
