/**
 * ============================================================
 *  完全记忆 | Complete Memory — SillyTavern Extension
 *  Version : 0.1.0
 *  Date    : 2026-04-22
 * ============================================================
 */

import { extension_settings, getContext, modules } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

import { MemoryExtractor }    from './src/core/memory-extractor.js';
import { PromptBuilder }      from './src/core/prompt-builder.js';
import { StorageManager }     from './src/core/storage.js';

import { TabCurrent }         from './src/tabs/tab-current.js';
import { TabChatLog }         from './src/tabs/tab-chatlog.js';
import { TabStatusBar }       from './src/tabs/tab-statusbar.js';
import { TabWorldView }       from './src/tabs/tab-worldview.js';
import { TabSettings }        from './src/tabs/tab-settings.js';

import { VectorMemory }       from './src/features/vector-memory.js';
import { SummaryEngine }      from './src/features/summary-engine.js';
import { RelationshipGraph }  from './src/features/relationship-graph.js';
import { MapGenerator }       from './src/features/map-generator.js';

// ======================== 常量 ========================
const EXT_NAME     = 'CompleteMemory';
const EXT_DISPLAY  = '完全记忆';
const LOG_PREFIX   = `[${EXT_DISPLAY}]`;

// ======================== 默认设置 ========================
const DEFAULT_SETTINGS = {
  // —— 基础 ——
  enabled: true,
  extractionInterval: 1,          // 每 N 轮对话提取一次记忆（默认 1 = 每轮）
  currentTurnCount: 0,            // 当前轮次计数器

  // —— 当前状态 ——
  current: {
    location: '',
    time: '',
    clothing: '',
    todoList: [],
  },

  // —— 聊天记录摘要 ——
  chatLog: {
    entries: [],                   // { turn, timestamp, summary, raw? }
    maxEntries: 500,
  },

  // —— 状态栏 ——
  statusBar: {
    items: [],                     // { id, name, desc, holder, location }
    locations: [],                 // { id, name, desc, parentId, children[] }
    characters: [],                // { id, name, gender, height, weight, appearance,
                                   //   personality, identity, relationships }
  },

  // —— 世界观 ——
  worldView: {
    worldSetting: '',              // 世界观正文（持续更新）
    userProfile: {                 // user 人设
      persona: '',
      hobbies: '',
      notes: '',
    },
    importantNPCs: [],             // [{ name, persona, hobbies, notes }]
    relationshipData: {},          // 关系网序列化数据
  },

  // —— 设置 ——
  config: {
    theme: 'default',              // 主题名
    customCSS: '',                 // 用户自定义CSS
    summary: {
      enabled: true,
      apiType: 'same',             // 'same' | 'custom'
      customEndpoint: '',
      customApiKey: '',
      customModel: '',
      promptTemplate: '',
    },
    vector: {
      enabled: false,
      apiType: 'openai',           // 'openai' | 'local' | 'custom'
      endpoint: '',
      apiKey: '',
      model: 'text-embedding-3-small',
      topK: 5,                     // 召回前 K 条
      similarityThreshold: 0.75,
    },
    prompt: {
      extractionSystemPrompt: '',  // 记忆提取系统提示词
      injectionTemplate: '',       // 注入 AI 的模板
      summaryPrompt: '',           // 摘要用提示词
    },
  },
};

// ======================== 全局实例 ========================
let storage         = null;
let memoryExtractor = null;
let promptBuilder   = null;
let summaryEngine   = null;
let vectorMemory    = null;

// Tab 控制器
let tabs = {};

// ======================== 初始化 ========================
jQuery(async () => {
  console.log(`${LOG_PREFIX} 正在加载...`);

  // 1) 合并设置
  if (!extension_settings[EXT_NAME]) {
    extension_settings[EXT_NAME] = structuredClone(DEFAULT_SETTINGS);
  }
  const settings = extension_settings[EXT_NAME];

  // 2) 初始化存储管理
  storage = new StorageManager(EXT_NAME, settings);

  // 3) 渲染主面板 UI
  renderMainPanel();

  // 4) 初始化各子模块
  memoryExtractor = new MemoryExtractor(settings, storage);
  promptBuilder   = new PromptBuilder(settings);
  summaryEngine   = new SummaryEngine(settings.config.summary);
  vectorMemory    = new VectorMemory(settings.config.vector);

  // 5) 初始化五个 Tab 控制器
  tabs = {
    current:   new TabCurrent(settings, storage),
    chatLog:   new TabChatLog(settings, storage),
    statusBar: new TabStatusBar(settings, storage),
    worldView: new TabWorldView(settings, storage, RelationshipGraph, MapGenerator),
    settings:  new TabSettings(settings, storage, summaryEngine, vectorMemory),
  };

  // 6) 注册事件钩子
  registerEventHooks(settings);

  console.log(`${LOG_PREFIX} 加载完成 ✓`);
});

// ======================== 渲染主面板 ========================
function renderMainPanel() {
  const panelHTML = `
  <div id="cm-complete-memory-panel" class="cm-panel">
    <!-- ===== 顶部标题栏 ===== -->
    <div class="cm-header">
      <span class="cm-header-icon">🧠</span>
      <span class="cm-header-title">${EXT_DISPLAY}</span>
      <span class="cm-header-version">v0.1.0</span>
      <label class="cm-toggle" title="启用/禁用插件">
        <input type="checkbox" id="cm-enabled-toggle" checked />
        <span class="cm-toggle-slider"></span>
      </label>
    </div>

    <!-- ===== Tab 导航栏 ===== -->
    <div class="cm-tab-bar">
      <button class="cm-tab-btn active" data-tab="current">
        <i class="fa-solid fa-location-dot"></i> 当前
      </button>
      <button class="cm-tab-btn" data-tab="chatlog">
        <i class="fa-solid fa-comments"></i> 聊天记录
      </button>
      <button class="cm-tab-btn" data-tab="statusbar">
        <i class="fa-solid fa-bars-progress"></i> 状态栏
      </button>
      <button class="cm-tab-btn" data-tab="worldview">
        <i class="fa-solid fa-globe"></i> 世界观
      </button>
      <button class="cm-tab-btn" data-tab="settings">
        <i class="fa-solid fa-gear"></i> 设置
      </button>
    </div>

    <!-- ===== Tab 内容区 ===== -->
    <div class="cm-tab-content">

      <!-- ——— 当前 ——— -->
      <div class="cm-tab-pane active" id="cm-pane-current">
        <div class="cm-section">
          <label class="cm-label"><i class="fa-solid fa-map-pin"></i> 当前地点</label>
          <input type="text" id="cm-current-location" class="cm-input"
                 placeholder="角色当前所在地点..." />
        </div>
        <div class="cm-section">
          <label class="cm-label"><i class="fa-regular fa-clock"></i> 当前时间</label>
          <input type="text" id="cm-current-time" class="cm-input"
                 placeholder="故事中的当前时间..." />
        </div>
        <div class="cm-section">
          <label class="cm-label"><i class="fa-solid fa-shirt"></i> 当前服装</label>
          <textarea id="cm-current-clothing" class="cm-textarea" rows="2"
                    placeholder="角色当前穿着描述..."></textarea>
        </div>
        <div class="cm-section">
          <label class="cm-label"><i class="fa-solid fa-list-check"></i> 待办事项</label>
          <div id="cm-todo-list" class="cm-todo-container"></div>
          <div class="cm-todo-add">
            <input type="text" id="cm-todo-input" class="cm-input"
                   placeholder="添加待办事项..." />
            <button id="cm-todo-add-btn" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- ——— 聊天记录 ——— -->
      <div class="cm-tab-pane" id="cm-pane-chatlog">
        <div class="cm-chatlog-toolbar">
          <span class="cm-chatlog-count">共 <strong id="cm-log-count">0</strong> 条记录</span>
          <input type="text" id="cm-chatlog-search" class="cm-input cm-input-sm"
                 placeholder="🔍 搜索记录..." />
          <button id="cm-chatlog-clear" class="cm-btn cm-btn-sm cm-btn-danger"
                  title="清空全部记录">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <div id="cm-chatlog-entries" class="cm-chatlog-list">
          <!-- 动态渲染 -->
          <div class="cm-empty-state">
            <i class="fa-solid fa-inbox"></i>
            <p>暂无聊天记录摘要</p>
            <small>开始对话后，记忆将自动提取到这里</small>
          </div>
        </div>
      </div>

      <!-- ——— 状态栏 ——— -->
      <div class="cm-tab-pane" id="cm-pane-statusbar">
        <!-- 子 Tab 切换 -->
        <div class="cm-sub-tab-bar">
          <button class="cm-sub-tab-btn active" data-subtab="items">
            <i class="fa-solid fa-box"></i> 物品
          </button>
          <button class="cm-sub-tab-btn" data-subtab="locations">
            <i class="fa-solid fa-map"></i> 地点
          </button>
          <button class="cm-sub-tab-btn" data-subtab="characters">
            <i class="fa-solid fa-users"></i> 人物
          </button>
        </div>

        <!-- 物品 -->
        <div class="cm-sub-pane active" id="cm-sub-items">
          <div class="cm-toolbar">
            <button id="cm-item-add" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-plus"></i> 添加物品
            </button>
          </div>
          <div id="cm-items-list" class="cm-card-grid">
            <!-- 动态物品卡片 -->
          </div>
        </div>

        <!-- 地点 -->
        <div class="cm-sub-pane" id="cm-sub-locations">
          <div class="cm-toolbar">
            <button id="cm-location-add" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-plus"></i> 添加地点
            </button>
            <button id="cm-map-view" class="cm-btn cm-btn-sm cm-btn-accent">
              <i class="fa-solid fa-map"></i> 查看地图
            </button>
          </div>
          <div id="cm-location-tree" class="cm-tree-view">
            <!-- 树形地点结构 -->
          </div>
          <div id="cm-map-canvas" class="cm-map-container" style="display:none;">
            <!-- 自动生成的地图 -->
          </div>
        </div>

        <!-- 人物 -->
        <div class="cm-sub-pane" id="cm-sub-characters">
          <div class="cm-toolbar">
            <button id="cm-char-add" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-plus"></i> 添加人物
            </button>
          </div>
          <div id="cm-characters-list" class="cm-card-grid">
            <!-- 动态人物卡片 -->
          </div>
        </div>
      </div>

      <!-- ——— 世界观 ——— -->
      <div class="cm-tab-pane" id="cm-pane-worldview">
        <div class="cm-sub-tab-bar">
          <button class="cm-sub-tab-btn active" data-subtab="world">
            <i class="fa-solid fa-earth-asia"></i> 世界观
          </button>
          <button class="cm-sub-tab-btn" data-subtab="user-profile">
            <i class="fa-solid fa-user"></i> User人设
          </button>
          <button class="cm-sub-tab-btn" data-subtab="npc-profiles">
            <i class="fa-solid fa-user-group"></i> 重要人物
          </button>
          <button class="cm-sub-tab-btn" data-subtab="relationship">
            <i class="fa-solid fa-circle-nodes"></i> 关系网
          </button>
        </div>

        <!-- 世界观 -->
        <div class="cm-sub-pane active" id="cm-sub-world">
          <label class="cm-label">世界观设定 <small>（随剧情自动更新）</small></label>
          <textarea id="cm-world-setting" class="cm-textarea" rows="10"
                    placeholder="当前世界的背景设定将在这里持续更新..."></textarea>
          <div class="cm-actions">
            <button id="cm-world-refresh" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-rotate"></i> 手动刷新
            </button>
            <button id="cm-world-save" class="cm-btn cm-btn-sm cm-btn-primary">
              <i class="fa-solid fa-floppy-disk"></i> 保存
            </button>
          </div>
        </div>

        <!-- User 人设 -->
        <div class="cm-sub-pane" id="cm-sub-user-profile">
          <div class="cm-section">
            <label class="cm-label">人设</label>
            <textarea id="cm-user-persona" class="cm-textarea" rows="4"
                      placeholder="User 的性格/背景..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">爱好</label>
            <textarea id="cm-user-hobbies" class="cm-textarea" rows="3"
                      placeholder="User 的爱好/兴趣..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">备注</label>
            <textarea id="cm-user-notes" class="cm-textarea" rows="3"
                      placeholder="其他补充..."></textarea>
          </div>
        </div>

        <!-- 重要 NPC -->
        <div class="cm-sub-pane" id="cm-sub-npc-profiles">
          <div class="cm-toolbar">
            <input type="text" id="cm-npc-name-input" class="cm-input cm-input-sm"
                   placeholder="输入重要人物名称..." />
            <button id="cm-npc-add" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-plus"></i> 添加
            </button>
          </div>
          <div id="cm-npc-list" class="cm-accordion">
            <!-- 可展开的 NPC 卡片 -->
          </div>
        </div>

        <!-- 关系网 -->
        <div class="cm-sub-pane" id="cm-sub-relationship">
          <div class="cm-toolbar">
            <button id="cm-rel-refresh" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-rotate"></i> 刷新关系网
            </button>
            <button id="cm-rel-fullscreen" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-expand"></i> 全屏
            </button>
          </div>
          <div id="cm-relationship-graph" class="cm-graph-container">
            <!-- 关系网 Canvas / SVG -->
          </div>
        </div>
      </div>

      <!-- ——— 设置 ——— -->
      <div class="cm-tab-pane" id="cm-pane-settings">
        <div class="cm-sub-tab-bar">
          <button class="cm-sub-tab-btn active" data-subtab="general">
            <i class="fa-solid fa-palette"></i> 美化
          </button>
          <button class="cm-sub-tab-btn" data-subtab="summary">
            <i class="fa-solid fa-file-lines"></i> 自动摘要
          </button>
          <button class="cm-sub-tab-btn" data-subtab="vector">
            <i class="fa-solid fa-magnifying-glass"></i> 向量记忆
          </button>
          <button class="cm-sub-tab-btn" data-subtab="prompts">
            <i class="fa-solid fa-terminal"></i> 提示词
          </button>
        </div>

        <!-- 美化设置 -->
        <div class="cm-sub-pane active" id="cm-sub-general">
          <div class="cm-section">
            <label class="cm-label">主题</label>
            <select id="cm-theme-select" class="cm-select">
              <option value="default">默认</option>
              <option value="dark-purple">暗紫</option>
              <option value="ocean-blue">海蓝</option>
              <option value="forest-green">森绿</option>
              <option value="sakura-pink">樱粉</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          <div class="cm-section">
            <label class="cm-label">自定义 CSS</label>
            <textarea id="cm-custom-css" class="cm-textarea cm-code" rows="6"
                      placeholder="/* 在此输入自定义样式 */"></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">记忆提取间隔</label>
            <div class="cm-inline">
              <span>每</span>
              <input type="number" id="cm-extraction-interval" class="cm-input cm-input-xs"
                     min="1" max="50" value="1" />
              <span>轮对话提取一次</span>
            </div>
          </div>
        </div>

        <!-- 自动摘要 -->
        <div class="cm-sub-pane" id="cm-sub-summary">
          <div class="cm-section">
            <label class="cm-toggle-row">
              <input type="checkbox" id="cm-summary-enabled" checked />
              <span>启用自动摘要</span>
            </label>
          </div>
          <div class="cm-section">
            <label class="cm-label">摘要 API 来源</label>
            <select id="cm-summary-api-type" class="cm-select">
              <option value="same">与聊天使用同一 API</option>
              <option value="custom">使用独立 API</option>
            </select>
          </div>
          <div id="cm-summary-custom-fields" class="cm-conditional-fields" style="display:none;">
            <div class="cm-section">
              <label class="cm-label">API Endpoint</label>
              <input type="text" id="cm-summary-endpoint" class="cm-input"
                     placeholder="https://api.openai.com/v1" />
            </div>
            <div class="cm-section">
              <label class="cm-label">API Key</label>
              <input type="password" id="cm-summary-apikey" class="cm-input"
                     placeholder="sk-..." />
            </div>
            <div class="cm-section">
              <label class="cm-label">模型名称</label>
              <input type="text" id="cm-summary-model" class="cm-input"
                     placeholder="gpt-4o-mini" />
            </div>
          </div>
        </div>

        <!-- 向量记忆 -->
        <div class="cm-sub-pane" id="cm-sub-vector">
          <div class="cm-section">
            <label class="cm-toggle-row">
              <input type="checkbox" id="cm-vector-enabled" />
              <span>启用向量记忆检索</span>
            </label>
          </div>
          <div class="cm-section">
            <label class="cm-label">向量化 API</label>
            <select id="cm-vector-api-type" class="cm-select">
              <option value="openai">OpenAI Embedding</option>
              <option value="local">本地模型（Ollama 等）</option>
              <option value="custom">自定义 Endpoint</option>
            </select>
          </div>
          <div class="cm-section">
            <label class="cm-label">Endpoint</label>
            <input type="text" id="cm-vector-endpoint" class="cm-input"
                   placeholder="https://api.openai.com/v1/embeddings" />
          </div>
          <div class="cm-section">
            <label class="cm-label">API Key</label>
            <input type="password" id="cm-vector-apikey" class="cm-input"
                   placeholder="sk-..." />
          </div>
          <div class="cm-section">
            <label class="cm-label">Embedding 模型</label>
            <input type="text" id="cm-vector-model" class="cm-input"
                   value="text-embedding-3-small" />
          </div>
          <div class="cm-section cm-inline">
            <div>
              <label class="cm-label">Top-K 召回数</label>
              <input type="number" id="cm-vector-topk" class="cm-input cm-input-xs"
                     min="1" max="20" value="5" />
            </div>
            <div>
              <label class="cm-label">相似度阈值</label>
              <input type="number" id="cm-vector-threshold" class="cm-input cm-input-xs"
                     min="0" max="1" step="0.05" value="0.75" />
            </div>
          </div>
          <div class="cm-section">
            <button id="cm-vector-test" class="cm-btn cm-btn-sm cm-btn-accent">
              <i class="fa-solid fa-flask-vial"></i> 测试连接
            </button>
            <button id="cm-vector-rebuild" class="cm-btn cm-btn-sm">
              <i class="fa-solid fa-database"></i> 重建索引
            </button>
          </div>
        </div>

        <!-- 提示词 -->
        <div class="cm-sub-pane" id="cm-sub-prompts">
          <div class="cm-section">
            <label class="cm-label">记忆提取 System Prompt</label>
            <textarea id="cm-prompt-extraction" class="cm-textarea cm-code" rows="8"
                      placeholder="用于从对话中提取结构化记忆的系统提示词..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">摘要生成 Prompt</label>
            <textarea id="cm-prompt-summary" class="cm-textarea cm-code" rows="6"
                      placeholder="用于生成对话摘要的提示词模板..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">记忆注入模板</label>
            <textarea id="cm-prompt-injection" class="cm-textarea cm-code" rows="6"
                      placeholder="注入到 AI 上下文的记忆模板，可使用变量 {{current}}, {{status}}, {{world}}, {{vector_recall}} ..."></textarea>
          </div>
          <div class="cm-actions">
            <button id="cm-prompt-reset" class="cm-btn cm-btn-sm cm-btn-danger">
              <i class="fa-solid fa-rotate-left"></i> 恢复默认
            </button>
            <button id="cm-prompt-save" class="cm-btn cm-btn-sm cm-btn-primary">
              <i class="fa-solid fa-floppy-disk"></i> 保存
            </button>
          </div>
        </div>
      </div>

    </div><!-- /cm-tab-content -->

    <!-- ===== 底部状态栏 ===== -->
    <div class="cm-footer">
      <span id="cm-status-indicator" class="cm-status-dot cm-status-ok"></span>
      <span id="cm-status-text">就绪</span>
      <span class="cm-footer-spacer"></span>
      <span id="cm-memory-count" title="已存储记忆条数">📝 0</span>
      <span id="cm-vector-count" title="向量索引数">🔗 0</span>
    </div>
  </div>`;

  // 注入到酒馆扩展面板
  $('#extensions_settings2').append(panelHTML);

  // 绑定 Tab 切换
  bindTabNavigation();
  bindSubTabNavigation();
}

// ======================== Tab 导航逻辑 ========================
function bindTabNavigation() {
  $(document).on('click', '.cm-tab-btn', function () {
    const targetTab = $(this).data('tab');

    // 切换按钮高亮
    $('.cm-tab-btn').removeClass('active');
    $(this).addClass('active');

    // 切换面板
    $('.cm-tab-pane').removeClass('active');
    $(`#cm-pane-${targetTab}`).addClass('active');
  });
}

function bindSubTabNavigation() {
  $(document).on('click', '.cm-sub-tab-btn', function () {
    const targetSub = $(this).data('subtab');
    const parentPane = $(this).closest('.cm-tab-pane');

    // 切换子按钮高亮
    parentPane.find('.cm-sub-tab-btn').removeClass('active');
    $(this).addClass('active');

    // 切换子面板
    parentPane.find('.cm-sub-pane').removeClass('active');
    parentPane.find(`#cm-sub-${targetSub}`).addClass('active');
  });
}

// ======================== 事件钩子注册 ========================
function registerEventHooks(settings) {

  /**
   * 核心钩子：每当收到 AI 回复后触发记忆提取
   */
  eventSource.on(event_types.MESSAGE_RECEIVED, async (messageIndex) => {
    if (!settings.enabled) return;

    settings.currentTurnCount++;

    // 检查是否达到提取间隔
    if (settings.currentTurnCount % settings.extractionInterval !== 0) {
      console.log(`${LOG_PREFIX} 轮次 ${settings.currentTurnCount}，未到提取间隔，跳过`);
      return;
    }

    console.log(`${LOG_PREFIX} ▶ 第 ${settings.currentTurnCount} 轮，开始提取记忆...`);
    updateStatus('extracting', '正在提取记忆...');

    try {
      const context = getContext();
      const chat    = context.chat;
      const lastMsg = chat[messageIndex];

      // ① 提取结构化记忆
      const extracted = await memoryExtractor.extract(chat, messageIndex, settings);

      // ② 更新「当前」状态
      if (extracted.current) {
        tabs.current.update(extracted.current);
      }

      // ③ 追加聊天记录摘要
      if (extracted.summary) {
        tabs.chatLog.addEntry({
          turn: settings.currentTurnCount,
          timestamp: new Date().toISOString(),
          summary: extracted.summary,
        });
      }

      // ④ 更新状态栏（物品 / 地点 / 人物）
      if (extracted.statusChanges) {
        tabs.statusBar.applyChanges(extracted.statusChanges);
      }

      // ⑤ 更新世界观
      if (extracted.worldViewUpdate) {
        tabs.worldView.applyUpdate(extracted.worldViewUpdate);
      }

      // ⑥ 向量化存储（如果启用）
      if (settings.config.vector.enabled) {
        await vectorMemory.store(extracted, settings.currentTurnCount);
        updateVectorCount();
      }

      // 保存
      saveSettingsDebounced();
      updateStatus('ok', '就绪');
      updateMemoryCount();

      console.log(`${LOG_PREFIX} ✓ 记忆提取完成`);

    } catch (err) {
      console.error(`${LOG_PREFIX} ✗ 记忆提取失败:`, err);
      updateStatus('error', `提取失败: ${err.message}`);
    }
  });

  /**
   * 钩子：在发送消息前，注入记忆到上下文
   */
  eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (eventData) => {
    if (!settings.enabled) return;

    try {
      // 构建注入内容
      let injectionParts = [];

      // 基础记忆注入
      const memoryBlock = promptBuilder.build(settings);
      if (memoryBlock) {
        injectionParts.push(memoryBlock);
      }

      // 向量记忆召回
      if (settings.config.vector.enabled) {
        const context = getContext();
        const lastUserMsg = getLastUserMessage(context.chat);
        if (lastUserMsg) {
          const recalled = await vectorMemory.recall(lastUserMsg, settings.config.vector.topK);
          if (recalled && recalled.length > 0) {
            const recallBlock = promptBuilder.buildVectorRecall(recalled);
            injectionParts.push(recallBlock);
          }
        }
      }

      // 注入
      if (injectionParts.length > 0) {
        const fullInjection = injectionParts.join('\n\n');
        eventData.prompt = injectMemoryIntoPrompt(eventData.prompt, fullInjection);
        console.log(`${LOG_PREFIX} 已注入 ${injectionParts.length} 块记忆`);
      }

    } catch (err) {
      console.error(`${LOG_PREFIX} 记忆注入失败:`, err);
    }
  });
}

// ======================== 辅助工具函数 ========================

function updateStatus(type, text) {
  const dot = $('#cm-status-indicator');
  dot.removeClass('cm-status-ok cm-status-extracting cm-status-error');
  dot.addClass(`cm-status-${type}`);
  $('#cm-status-text').text(text);
}

function updateMemoryCount() {
  const settings = extension_settings[EXT_NAME];
  const count = (settings.chatLog?.entries?.length || 0);
  $('#cm-memory-count').text(`📝 ${count}`);
}

function updateVectorCount() {
  const count = vectorMemory?.getIndexCount() || 0;
  $('#cm-vector-count').text(`🔗 ${count}`);
}

function getLastUserMessage(chat) {
  for (let i = chat.length - 1; i >= 0; i--) {
    if (!chat[i].is_system && chat[i].is_user) {
      return chat[i].mes;
    }
  }
  return null;
}

function injectMemoryIntoPrompt(prompt, memoryBlock) {
  // 策略：在 system prompt 之后、对话历史之前注入
  const marker = '\n[Complete Memory — 记忆注入开始]\n';
  const endMarker = '\n[Complete Memory — 记忆注入结束]\n';
  return prompt + marker + memoryBlock + endMarker;
}

// 导出供其他模块使用
export { EXT_NAME, LOG_PREFIX, DEFAULT_SETTINGS };
