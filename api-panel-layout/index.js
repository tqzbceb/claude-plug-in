/**
 * API 面板重排 (API Panel Layout)
 * ------------------------------------------------------------------
 * 接管 SillyTavern / TauriTavern 的「API 连接配置」面板 (#rm_api_block)：
 *   - 重新排列 Chat Completion 相关字段
 *   - 给 API 密钥输入框加「眼睛」按钮，切换明文 / 隐藏
 *   - 「模型列表」默认隐藏，加载模型成功后才出现在「模型名」下方
 *   - 「当前API预设 / 预设名称 / 最大回复长度 / 温度 / 附加主体参数」以镜像控件形式
 *     搬进面板，原生控件与逻辑保持不动
 *
 * 设计原则：
 *   1. 只做 DOM 搬移 (move)，绝不 clone —— 原生 jQuery 事件绑定全部保留。
 *   2. 所有搬移都是可逆的：每个被搬走的节点在原位留下一个注释锚点，禁用扩展时
 *      精确还原。
 *   3. 不注入任何颜色 / 字体 / 圆角 / 阴影，只用原生 class (text_pole /
 *      menu_button / flex-container / range-block ...)，视觉风格 100% 沿用原生。
 *   4. 找不到某个原生元素时只跳过该字段并打日志，绝不抛错破坏面板。
 */

const MODULE_NAME = 'apiPanelLayout';
const LOG = '[api-panel-layout]';
const ROOT_ID = 'ttal_root';

const DEFAULT_SETTINGS = {
    enabled: true,
    customLabels: true,      // 用中文/英文新标签替换原生标签
    maskApiKey: true,        // 密钥框默认 type=password
    lazyModelList: true,     // 模型列表默认隐藏，加载成功后显示
    showBodyParams: true,    // 显示「附加主体参数」YAML 框
    debug: false,
};

/** 新布局的槽位顺序（自上而下） */
const SLOT_ORDER = [
    'preset',        // 3  当前API预设
    'presetName',    // 4  预设名称
    'endpoint',      // 5  端点（基础URL）
    'key',           // 6  API密钥（含眼睛按钮）
    'modelName',     // 7  模型名
    'modelList',     // 9  模型列表（默认隐藏，插在模型名下方）
    'buttons',       // 8  加载模型 / 附加参数
    'numbers',       // 10 最大回复长度 + 温度
    'bodyParams',    // 11 附加主体参数 (YAML)
];

/** 各 chat completion source 的字段映射；未列出的走通用推导规则 */
const SOURCE_FIELDS = {
    custom: {
        endpoint: '#custom_api_url_text',
        key: '#api_key_custom',
        secret: 'api_key_custom',
        modelName: '#custom_model_id',
        modelList: '#model_custom_select',
        bodyParams: true,
    },
    openai: { key: '#api_key_openai', secret: 'api_key_openai', modelList: '#model_openai_select' },
    claude: { key: '#api_key_claude', secret: 'api_key_claude', modelList: '#model_claude_select' },
    makersuite: { key: '#api_key_makersuite', secret: 'api_key_makersuite', modelList: '#model_google_select' },
    vertexai: { key: '#api_key_vertexai', secret: 'api_key_vertexai', modelList: '#model_vertexai_select' },
    openrouter: { key: '#api_key_openrouter', secret: 'api_key_openrouter', modelList: '#model_openrouter_select' },
    azure_openai: { key: '#api_key_azure_openai', secret: 'api_key_azure_openai', modelList: '#azure_openai_model' },
    mistralai: { key: '#api_key_mistralai', secret: 'api_key_mistralai', modelList: '#model_mistralai_select' },
    deepseek: { key: '#api_key_deepseek', secret: 'api_key_deepseek', modelList: '#model_deepseek_select' },
};

const LABELS = {
    preset: ['当前API预设', 'Current API Preset'],
    presetHint: ['星标表示新聊天默认使用的预设。', 'A star marks the preset used by default for new chats.'],
    presetName: ['预设名称', 'Preset Name'],
    endpoint: ['端点（基础URL）', 'Endpoint (Base URL)'],
    key: ['API密钥', 'API Key'],
    modelName: ['模型名', 'Model Name'],
    modelList: ['模型列表', 'Model List'],
    loadModels: ['加载模型', 'Load Models'],
    additionalParams: ['附加参数', 'Additional Parameters'],
    maxTokens: ['最大回复长度', 'Max Response Length'],
    temperature: ['温度', 'Temperature'],
    bodyParams: ['附加主体参数', 'Additional Body Parameters'],
    newPreset: ['新增预设', 'New preset'],
    deletePreset: ['删除预设', 'Delete preset'],
    revealKey: ['显示 / 隐藏密钥明文', 'Show / hide the API key'],
    renameHint: ['回车确认重命名当前预设', 'Press Enter to rename the current preset'],
    keyForbidden: [
        '无法读取密钥明文：后端未允许密钥外泄。请在 config.yaml 中设置 allowKeysExposure: true 后重启 TauriTavern。',
        'Cannot read the key: set allowKeysExposure: true in config.yaml and restart, then try again.',
    ],
    keyEmpty: ['该密钥当前为空（尚未保存过）。', 'This key is empty (nothing saved yet).'],
    renameFailed: ['预设重命名失败。', 'Could not rename the preset.'],
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
    const c = ctx();
    const store = c?.extensionSettings;
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

function toast(kind, message) {
    try {
        globalThis.toastr?.[kind]?.(message);
    } catch {
        console.log(LOG, kind, message);
    }
}

function $j() {
    return globalThis.jQuery || globalThis.$ || null;
}

/**
 * 触发原生事件，优先走 jQuery（SillyTavern 的绑定都在 jQuery 上）。
 * 对已被「停放」(detached) 的节点同样有效。
 */
function fire(el, type) {
    if (!el) return;
    const jq = $j();
    if (jq) jq(el).trigger(type);
    else el.dispatchEvent(new Event(type, { bubbles: true }));
}

/**
 * 解析原生元素。TauriTavern 的 panel-runtime 会在抽屉关闭时把左侧面板的子树
 * 从文档里摘下来（parking），此时 querySelector 找不到元素，因此这里做一层
 * 引用缓存：一旦拿到过就一直复用，即使暂时 detached 也能继续驱动它。
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

/** 记账：在原位插入注释锚点，便于精确还原 */
function track(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isSynthetic(el)) return true;
    if (moved.has(el)) return true;
    if (!el.parentNode) return false;
    const anchor = document.createComment(`ttal:${el.id || el.tagName.toLowerCase()}`);
    el.parentNode.insertBefore(anchor, el);
    moved.set(el, { anchor });
    return true;
}

/** 把节点还原回原位（合成节点直接摘掉） */
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

/**
 * 幂等填充槽位：内容一致时不做任何 DOM 操作（避免 MutationObserver 自激）。
 * @param {Element} slot
 * @param {Array<Element|null>} nodes
 */
function fillSlot(slot, nodes) {
    if (!slot) return;
    const desired = (nodes || []).filter(node => node && node.nodeType === 1);
    for (const node of desired) track(node);

    const current = Array.from(slot.children);
    const identical = current.length === desired.length && current.every((node, index) => node === desired[index]);
    if (identical) return;

    for (const node of desired) slot.appendChild(node);
    for (const node of current) {
        if (!desired.includes(node)) restoreNode(node);
    }
}

/** 属性 / 文本改写的还原记录 */
const patched = new Map();

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
    el.removeAttribute('data-i18n'); // 防止 i18n 重新翻译时把新标签覆盖掉
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

function isNoteNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches('small, .neutral_warning, .info-block, .toggle-description')) return true;
    if (el.hasAttribute('data-for')) return true;
    if (el.tagName === 'DIV' && el.children.length === 1 && el.firstElementChild.tagName === 'SMALL') return true;
    return false;
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
 * @param {Element} ctrl
 * @returns {{label: Element|null, body: Element, extras: Element[]}|null}
 */
function groupOf(ctrl) {
    if (!ctrl) return null;
    const host = sourceHostOf(ctrl);
    let body = ctrl;

    if (host && host.contains(ctrl) && ctrl !== host) {
        // 提升到 source 容器的直接子节点，保证 <h4> 与输入框是兄弟关系
        while (body.parentElement && body.parentElement !== host) body = body.parentElement;
    } else {
        body = ctrl.closest('.flex-container, .wide100p, .range-block') || ctrl.parentElement;
    }
    if (!body || body === document.body) return null;

    let label = null;
    let prev = body.previousElementSibling;
    while (prev && (prev.nodeType !== 1 || prev.tagName === 'INPUT' || prev.tagName === 'DATALIST')) {
        prev = prev.previousElementSibling;
    }
    if (prev && prev.matches(HEADINGS)) label = prev;

    const extras = [];
    let next = body.nextElementSibling;
    while (next && isNoteNode(next) && !next.matches(HEADINGS)) {
        extras.push(next);
        next = next.nextElementSibling;
    }
    return { label, body, extras };
}

/** 把整组搬进槽位 */
function adoptGroup(slot, ctrl, labelText) {
    const group = groupOf(ctrl);
    if (!group) return null;
    if (group.label) {
        adopt(slot, group.label);
        if (labelText && cfg().customLabels) patchText(group.label, labelText);
    } else if (labelText) {
        adopt(slot, cachedLabel(slot, labelText));
    }
    adopt(slot, group.body);
    for (const extra of group.extras) adopt(slot, extra);
    return group;
}

/* ------------------------------------------------------- 合成控件构造 */

function makeLabel(text) {
    const h4 = document.createElement('h4');
    h4.className = 'margin0 ttal-label';
    h4.textContent = text;
    return h4;
}

function makeHint(text) {
    const wrap = document.createElement('div');
    wrap.className = 'ttal-hint';
    const small = document.createElement('small');
    small.textContent = text;
    wrap.appendChild(small);
    return wrap;
}

function makeIconButton(iconClass, title) {
    const btn = document.createElement('div');
    btn.className = `menu_button menu_button_icon fa-solid ${iconClass} fa-fw ttal-icon-button`;
    btn.title = title;
    btn.tabIndex = 0;
    return btn;
}

function makeRow() {
    const row = document.createElement('div');
    row.className = 'flex-container alignItemsCenter ttal-row';
    return row;
}

/** 合成控件单例，重复 apply 时复用，避免重复绑定事件 */
const ui = {};

function buildRoot() {
    if (ui.root && ui.root.nodeType === 1) return ui.root;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'flex-container flexFlowColumn ttal-root';
    ui.slots = {};
    for (const name of SLOT_ORDER) {
        const slot = document.createElement('div');
        slot.className = `flex-container flexFlowColumn ttal-slot ttal-slot-${name}`;
        slot.dataset.ttalSlot = name;
        root.appendChild(slot);
        ui.slots[name] = slot;
    }
    ui.root = root;
    return root;
}

/** 3. 当前API预设：镜像 #settings_preset_openai（原生控件留在原处不动） */
function buildPresetMirror() {
    if (ui.presetSelect) return;
    const row = makeRow();
    const select = document.createElement('select');
    select.id = 'ttal_preset_select';
    select.className = 'text_pole flex1 ttal-grow';

    const add = makeIconButton('fa-file-circle-plus', t('newPreset'));
    const del = makeIconButton('fa-trash-can', t('deletePreset'));

    select.addEventListener('change', () => {
        const nativeSelect = native('#settings_preset_openai');
        if (!nativeSelect) return;
        nativeSelect.value = select.value;
        fire(nativeSelect, 'change');
        dbg('preset switched via mirror ->', select.value);
    });
    add.addEventListener('click', () => native('#new_oai_preset')?.click());
    del.addEventListener('click', () => native('#delete_oai_preset')?.click());

    row.append(select, add, del);
    ui.presetRow = row;
    ui.presetSelect = select;
    ui.presetHint = makeHint(t('presetHint'));
}

function syncPresetMirror() {
    const nativeSelect = native('#settings_preset_openai');
    const select = ui.presetSelect;
    if (!select) return;
    if (!nativeSelect) {
        ui.slots?.preset?.classList.add('ttal-hidden');
        return;
    }
    ui.slots?.preset?.classList.remove('ttal-hidden');
    if (select.innerHTML !== nativeSelect.innerHTML) select.innerHTML = nativeSelect.innerHTML;
    if (select.value !== nativeSelect.value) select.value = nativeSelect.value;
    syncPresetName();
}

/** 4. 预设名称 */
function buildPresetName() {
    if (ui.presetName) return;
    const input = document.createElement('input');
    input.id = 'ttal_preset_name';
    input.type = 'text';
    input.className = 'text_pole wide100p';
    input.autocomplete = 'off';
    input.title = t('renameHint');

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        }
    });
    input.addEventListener('change', async () => {
        const nativeSelect = native('#settings_preset_openai');
        const current = currentPresetName();
        const next = input.value.trim();
        if (!next || next === current) {
            input.value = current;
            return;
        }
        const manager = ctx()?.getPresetManager?.('openai');
        if (manager && typeof manager.renamePreset === 'function') {
            try {
                await manager.renamePreset(next);
                dbg('preset renamed', current, '->', next);
            } catch (error) {
                warn('rename failed', error);
                toast('error', t('renameFailed'));
                input.value = current;
            }
        } else {
            // 兜底：走原生「重命名」按钮（会弹出原生输入框）
            input.value = current;
            native('[data-preset-manager-rename="openai"]')?.click();
        }
        syncPresetMirror();
        if (nativeSelect) fire(nativeSelect, 'change');
    });
    ui.presetName = input;
}

function currentPresetName() {
    const nativeSelect = native('#settings_preset_openai');
    if (!nativeSelect) return '';
    const option = nativeSelect.selectedOptions?.[0] || nativeSelect.options[nativeSelect.selectedIndex];
    return (option?.textContent || '').trim();
}

function syncPresetName() {
    const input = ui.presetName;
    if (!input || document.activeElement === input) return;
    const nativeSelect = native('#settings_preset_openai');
    input.value = currentPresetName();
    // 默认预设 (value=gui) 不可重命名
    const isDefault = nativeSelect?.value === 'gui';
    input.readOnly = !!isDefault;
    input.classList.toggle('ttal-readonly', !!isDefault);
}

/* ------------------------------ 6. API 密钥：掩码 + 眼睛图标读取明文 */

function buildEyeButton() {
    if (ui.eye) return;
    const eye = makeIconButton('fa-eye', t('revealKey'));
    eye.id = 'ttal_reveal_key';
    eye.addEventListener('click', () => toggleKeyVisibility());
    ui.eye = eye;
}

function currentKeyInput() {
    const fields = fieldsFor(currentSource());
    return fields.key ? native(fields.key) : null;
}

function setEyeState(revealed) {
    const eye = ui.eye;
    if (!eye) return;
    eye.classList.toggle('fa-eye', !revealed);
    eye.classList.toggle('fa-eye-slash', revealed);
}

async function toggleKeyVisibility() {
    const input = currentKeyInput();
    if (!input) return;

    // 已是明文 -> 收起
    if (input.type !== 'password') {
        input.type = 'password';
        // 若明文内容是我们代填的且用户没改过，还原成原值，避免误把同一密钥重复写回
        if (input.dataset.ttalFetched === '1' && input.value === input.dataset.ttalFetchedValue) {
            input.value = input.dataset.ttalPrevValue || '';
        }
        delete input.dataset.ttalFetched;
        delete input.dataset.ttalFetchedValue;
        delete input.dataset.ttalPrevValue;
        setEyeState(false);
        return;
    }

    // 输入框里已有用户输入 -> 直接明文显示
    if (input.value.trim()) {
        input.type = 'text';
        setEyeState(true);
        return;
    }

    // 输入框为空（密钥已保存在后端）-> 向后端取明文
    const fields = fieldsFor(currentSource());
    const secretKey = fields.secret;
    if (!secretKey) return;

    const result = await fetchSecret(secretKey);
    if (result.value) {
        input.dataset.ttalPrevValue = input.value;
        input.dataset.ttalFetched = '1';
        input.dataset.ttalFetchedValue = result.value;
        input.value = result.value;
        input.type = 'text';
        setEyeState(true);
        return;
    }
    toast(result.forbidden ? 'warning' : 'info', result.forbidden ? t('keyForbidden') : t('keyEmpty'));
}

function requestHeaders(withContentType = true) {
    const c = ctx();
    try {
        const headers = c?.getRequestHeaders?.() ?? {};
        const copy = { ...headers };
        if (!withContentType) delete copy['Content-Type'];
        return copy;
    } catch {
        return withContentType ? { 'Content-Type': 'application/json' } : {};
    }
}

/**
 * 读取已保存密钥的明文。
 * 依次尝试 /api/secrets/find（返回单个 key 的明文）与 /api/secrets/view（返回全部）。
 * 两者都受后端 allowKeysExposure 控制；被拒时返回 forbidden 以便提示用户。
 */
async function fetchSecret(secretKey) {
    let forbidden = false;

    try {
        const response = await fetch('/api/secrets/find', {
            method: 'POST',
            headers: requestHeaders(true),
            body: JSON.stringify({ key: secretKey }),
        });
        if (response.ok) {
            const data = await response.json().catch(() => null);
            if (data && typeof data.value === 'string' && data.value) return { value: data.value };
        } else if (response.status === 403 || response.status === 500) {
            forbidden = true;
        }
    } catch (error) {
        dbg('secrets/find failed', error);
    }

    try {
        const response = await fetch('/api/secrets/view', {
            method: 'POST',
            headers: requestHeaders(false),
        });
        if (response.ok) {
            const data = await response.json().catch(() => null);
            const value = data?.[secretKey];
            if (typeof value === 'string' && value) return { value };
            if (Array.isArray(value)) {
                const active = value.find(item => item?.active) || value[0];
                if (active?.value) return { value: String(active.value) };
            }
            if (data?.error) forbidden = true;
        } else {
            forbidden = true;
        }
    } catch (error) {
        dbg('secrets/view failed', error);
    }

    return { value: null, forbidden };
}

/* ------------------------------- 8. 按钮行：加载模型 / 附加参数 */

function fillButtonsSlot(slot) {
    const connect = native('#api_button_openai');
    if (!connect) return;
    const row = connect.parentElement;
    // 整行搬过来：Cancel / Authorize / Test Message 等原生按钮保持原样
    if (row && row !== slot && !row.id) adopt(slot, row);
    if (cfg().customLabels) {
        patchText(connect, t('loadModels'));
        const extra = native('#customize_additional_parameters');
        if (extra) patchText(extra, t('additionalParams'));
    }
    if (!connect.dataset.ttalHooked) {
        connect.dataset.ttalHooked = '1';
        connect.addEventListener('click', () => beginModelLoad(), true);
    }
}

/* ---------------------- 9. 模型列表：加载成功后才显示 */

/** 已成功加载过模型的 source 集合 */
const modelsLoaded = new Set();
let modelWatch = null;

function modelListSelect() {
    const fields = fieldsFor(currentSource());
    return fields.modelList ? native(fields.modelList) : null;
}

function selectHasModels(select) {
    if (!select) return false;
    return Array.from(select.options).some(option => option.value && option.value !== 'none');
}

function updateModelListVisibility() {
    const slot = ui.slots?.modelList;
    if (!slot) return;
    const source = currentSource();
    const shouldShow = !cfg().lazyModelList || modelsLoaded.has(source);
    slot.classList.toggle('ttal-hidden', !shouldShow);
}

/** 点击「加载模型」后开始观察模型下拉框，一旦拿到模型就显示出来 */
function beginModelLoad() {
    const source = currentSource();
    const select = modelListSelect();
    if (!select) return;
    dbg('watching model list for', source);

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

/** 10. 最大回复长度 / 温度：镜像左侧面板的原生控件 */
function buildNumbers() {
    if (ui.numbersRow) return;
    const row = document.createElement('div');
    row.className = 'flex-container ttal-two-col';

    const build = (labelKey, id) => {
        const cell = document.createElement('div');
        cell.className = 'flex-container flexFlowColumn flex1 ttal-cell';
        const title = document.createElement('div');
        title.className = 'range-block-title ttal-cell-title';
        title.textContent = t(labelKey);
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.className = 'text_pole wide100p';
        cell.append(title, input);
        row.appendChild(cell);
        return input;
    };

    ui.maxTokens = build('maxTokens', 'ttal_max_tokens');
    ui.temperature = build('temperature', 'ttal_temperature');

    bindNumberMirror(ui.maxTokens, '#openai_max_tokens');
    bindNumberMirror(ui.temperature, '#temp_openai', '#temp_counter_openai');
    ui.numbersRow = row;
}

/**
 * 数值镜像：代理框 -> 原生控件（触发原生 input 事件，让 SillyTavern 自己写设置）。
 * @param {HTMLInputElement} proxy
 * @param {string} nativeSelector 承担逻辑的原生控件（滑条或数字框）
 * @param {string} [counterSelector] 原生数字框（仅用于回读显示值）
 */
function bindNumberMirror(proxy, nativeSelector, counterSelector) {
    proxy.addEventListener('input', () => {
        const target = native(nativeSelector);
        if (!target) return;
        target.value = proxy.value;
        fire(target, 'input');
    });
    proxy.addEventListener('change', () => {
        const target = native(nativeSelector);
        if (!target) return;
        target.value = proxy.value;
        fire(target, 'change');
    });
    proxy.dataset.ttalNative = nativeSelector;
    if (counterSelector) proxy.dataset.ttalCounter = counterSelector;
}

function syncNumbers() {
    for (const proxy of [ui.maxTokens, ui.temperature]) {
        if (!proxy) continue;
        const target = native(proxy.dataset.ttalNative);
        if (!target) continue;
        for (const attr of ['min', 'max', 'step']) {
            const value = target.getAttribute(attr);
            if (value !== null) proxy.setAttribute(attr, value);
        }
        if (document.activeElement === proxy) continue;
        const counter = proxy.dataset.ttalCounter ? native(proxy.dataset.ttalCounter) : null;
        proxy.value = counter?.value ?? target.value ?? '';
    }
}

/* ---------------------- 11. 附加主体参数 (YAML) */

function buildBodyParams() {
    if (ui.bodyParams) return;
    const textarea = document.createElement('textarea');
    textarea.id = 'ttal_custom_include_body';
    textarea.className = 'text_pole textarea_compact wide100p';
    textarea.rows = 6;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.setAttribute('placeholder', 'response_format:\n  type: json_object\ntop_k: 40');

    textarea.addEventListener('input', () => {
        const c = ctx();
        if (!c?.chatCompletionSettings) return;
        c.chatCompletionSettings.custom_include_body = textarea.value;
        // 原生弹窗如果开着，同步它的输入框
        const nativeArea = document.querySelector('#custom_include_body');
        if (nativeArea && nativeArea.value !== textarea.value) nativeArea.value = textarea.value;
        c.saveSettingsDebounced?.();
    });
    textarea.addEventListener('focus', () => syncBodyParams(true));
    ui.bodyParams = textarea;
}

function syncBodyParams(force = false) {
    const textarea = ui.bodyParams;
    if (!textarea) return;
    if (!force && document.activeElement === textarea) return;
    const value = ctx()?.chatCompletionSettings?.custom_include_body;
    const next = typeof value === 'string' ? value : '';
    if (textarea.value !== next) textarea.value = next;
}

/* ------------------------------------------- 12. 装配基础设施 */

/** 本轮 apply 用过的节点，用于回收上一轮残留 */
let passUsed = null;
/** slot -> 下一个待写入位置；位置已正确时不产生任何 DOM 变更 */
const slotCursor = new Map();
/** 合成标签缓存：同一槽位 + 同一文本复用同一个节点，避免反复 apply 时堆积 */
const labelCache = new Map();

function markSynthetic(el) {
    if (el && el.nodeType === 1) el.dataset.ttalSynthetic = '1';
    return el;
}

function cachedLabel(slot, text) {
    const key = `${slot?.dataset?.ttalSlot || '?'}|${text}`;
    let el = labelCache.get(key);
    if (!el || el.nodeType !== 1) {
        el = markSynthetic(makeLabel(text));
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

/** 回收槽位里本轮没用到的残留节点（还原原位 / 删除合成节点） */
function sweepSlots() {
    for (const slot of Object.values(ui.slots || {})) {
        const keep = slotCursor.get(slot) ?? 0;
        for (const child of Array.from(slot.children).slice(keep)) {
            if (!passUsed?.has(child)) restoreNode(child);
        }
        slot.classList.toggle('ttal-empty', slot.children.length === 0);
    }
}

function currentSource() {
    return native('#chat_completion_source')?.value || '';
}

function isChatCompletion() {
    const main = native('#main_api')?.value;
    return !main || main === 'openai';
}

/**
 * 字段映射：SOURCE_FIELDS 里显式写了就用，否则按 SillyTavern 命名惯例推导。
 */
function fieldsFor(source) {
    const base = SOURCE_FIELDS[source] || {};
    return {
        endpoint: base.endpoint ?? null,
        key: base.key ?? (source ? `#api_key_${source}` : null),
        secret: base.secret ?? (source ? `api_key_${source}` : null),
        modelName: base.modelName ?? null,
        modelList: base.modelList ?? (source ? `#model_${source}_select` : null),
        bodyParams: base.bodyParams ?? false,
    };
}

/** 面板容器：Chat Completion 表单，退化到整个 API 抽屉 */
function panelHost() {
    return document.querySelector('#openai_api') || document.querySelector('#rm_api_block');
}

/** 把根节点插到「Chat Completion Source」下拉框那一组之后 */
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

/* ------------------------------------------------- 13. 逐槽位装配 */

function layoutPreset(slot) {
    if (!native('#settings_preset_openai')) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adopt(slot, cachedLabel(slot, t('preset')));
    adopt(slot, markSynthetic(ui.presetRow));
    adopt(slot, markSynthetic(ui.presetHint));
}

function layoutPresetName(slot) {
    if (!native('#settings_preset_openai')) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adopt(slot, cachedLabel(slot, t('presetName')));
    adopt(slot, markSynthetic(ui.presetName));
}

/** 端点 / 模型名 / 模型列表：直接把原生字段组搬过来 */
function layoutNativeField(slot, selector, labelText) {
    const ctrl = selector ? native(selector) : null;
    if (!ctrl) {
        slot.classList.add('ttal-hidden');
        return null;
    }
    slot.classList.remove('ttal-hidden');
    return adoptGroup(slot, ctrl, labelText);
}

/** 6. API 密钥：搬组 + 眼睛按钮塞进输入框所在的行 */
function layoutKey(slot, fields) {
    const input = fields.key ? native(fields.key) : null;
    if (!input) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adoptGroup(slot, input, t('key'));

    markSynthetic(ui.eye);
    const row = input.parentElement;
    const inline = row && row !== slot && slot.contains(row);
    if (inline) {
        if (!row.classList.contains('flex-container')) {
            patchAttr(row, 'class', `${row.className} flex-container alignItemsCenter`.trim());
        }
        passUsed?.add(ui.eye);
        if (row.lastElementChild !== ui.eye) row.appendChild(ui.eye);
    } else {
        adopt(slot, ui.eye);
    }

    // 掩码：只在用户没主动展开明文时生效
    if (cfg().maskApiKey && input.type !== 'password' && input.dataset.ttalFetched !== '1') {
        patchAttr(input, 'type', 'password');
        input.type = 'password';
    }
    setEyeState(input.type !== 'password');
}

function layoutBodyParams(slot, fields) {
    if (!fields.bodyParams || !cfg().showBodyParams) {
        slot.classList.add('ttal-hidden');
        return;
    }
    slot.classList.remove('ttal-hidden');
    adopt(slot, cachedLabel(slot, t('bodyParams')));
    adopt(slot, markSynthetic(ui.bodyParams));
    syncBodyParams();
}

/* --------------------------------------------------- 14. apply / teardown */

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
    if (!panelHost() || !isChatCompletion()) return;

    applying = true;
    try {
        const root = markSynthetic(buildRoot());
        buildPresetMirror();
        buildPresetName();
        buildEyeButton();
        buildNumbers();
        buildBodyParams();
        if (!ensureMounted(root)) return;

        const fields = fieldsFor(currentSource());
        passUsed = new Set();
        slotCursor.clear();

        layoutPreset(ui.slots.preset);
        layoutPresetName(ui.slots.presetName);
        layoutNativeField(ui.slots.endpoint, fields.endpoint, t('endpoint'));
        layoutKey(ui.slots.key, fields);
        layoutNativeField(ui.slots.modelName, fields.modelName, t('modelName'));
        layoutNativeField(ui.slots.modelList, fields.modelList, t('modelList'));
        fillButtonsSlot(ui.slots.buttons);
        adopt(ui.slots.numbers, markSynthetic(ui.numbersRow));
        layoutBodyParams(ui.slots.bodyParams, fields);

        sweepSlots();
        passUsed = null;
        syncAll();
    } catch (error) {
        warn('apply failed', error);
    } finally {
        setTimeout(() => { applying = false; }, 50);
    }
}

/** 把原生状态回读到镜像控件上 */
function syncAll() {
    if (!ui.root || !document.contains(ui.root)) return;
    applying = true;
    try {
        syncPresetMirror();
        syncNumbers();
        syncBodyParams();
        updateModelListVisibility();
        const input = currentKeyInput();
        if (input) setEyeState(input.type !== 'password');
    } catch (error) {
        dbg('sync failed', error);
    } finally {
        setTimeout(() => { applying = false; }, 0);
    }
}

/** 完全还原：所有搬移归位、改写回滚、合成节点摘除 */
function teardown() {
    applying = true;
    try {
        modelWatch?.observer?.disconnect();
        clearTimeout(modelWatch?.timer);
        modelWatch = null;

        ui.eye?.remove();
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

/* ------------------------------------------- 15. 事件绑定与观察器 */

const EVENT_NAMES = [
    'APP_READY',
    'SETTINGS_UPDATED',
    'SETTINGS_LOADED_AFTER',
    'CHAT_COMPLETION_SETTINGS_READY',
    'OAI_PRESET_CHANGED_AFTER',
    'ONLINE_STATUS_CHANGED',
    'CHATCOMPLETION_SOURCE_CHANGED',
];

function bindEvents() {
    const jq = $j();
    if (jq) {
        // 事件委托挂在 document 上：面板被 parking（摘下重挂）后依然有效
        jq(document).on('change', '#chat_completion_source, #main_api', () => schedule(true));
        jq(document).on('change', '#settings_preset_openai', () => setTimeout(syncAll, 50));
        jq(document).on('click', '#rm_api_block .drawer-toggle, #api_button_openai', () => schedule());
    } else {
        document.addEventListener('change', (event) => {
            if (event.target?.matches?.('#chat_completion_source, #main_api')) schedule(true);
            else if (event.target?.matches?.('#settings_preset_openai')) setTimeout(syncAll, 50);
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
        // 扩展面板可能晚于本扩展就绪，补挂设置项
        if (!document.querySelector('#ttal_settings')) {
            try { buildSettingsUI(); } catch { /* ignore */ }
        }
        if (!cfg().enabled) return;
        if (ui.root && document.contains(ui.root) && ui.root.offsetParent) syncAll();
    }, 800);
}

/* --------------------------------------------------- 16. 扩展设置面板 */

const SETTING_ITEMS = [
    ['enabled', '启用重排', 'Enable layout'],
    ['customLabels', '使用自定义标签', 'Use custom labels'],
    ['maskApiKey', '密钥默认隐藏', 'Mask the API key by default'],
    ['lazyModelList', '模型列表加载后再显示', 'Reveal model list only after loading'],
    ['showBodyParams', '显示附加主体参数', 'Show additional body parameters'],
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
            if (key === 'enabled' && !box.checked) teardown();
            else if (key === 'customLabels' || key === 'maskApiKey') {
                // 这两项影响已改写的原生节点，先回滚再重排
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

/* --------------------------------------------------------- 17. 初始化 */

function start() {
    try {
        buildSettingsUI();
    } catch (error) {
        warn('settings ui failed', error);
    }
    bindEvents();
    schedule(true);
    // 面板首次打开可能晚于扩展加载，补两次延迟重试
    setTimeout(() => schedule(), 1500);
    setTimeout(() => schedule(), 5000);
    console.log(LOG, 'ready');
}

globalThis[MODULE_NAME] = { apply, teardown, syncAll, cfg, ui };

const jqReady = $j();
if (jqReady) jqReady(() => start());
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
