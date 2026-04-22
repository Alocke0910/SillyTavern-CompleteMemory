/**
 * ============================================================
 *  完全记忆 | Complete Memory — SillyTavern Extension
 *  Version : 0.1.0
 *  All-in-one single file (no sub-module imports)
 * ============================================================
 */

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, generateRaw } from '../../../../script.js';

// ======================== 常量 ========================
const EXT_NAME    = 'CompleteMemory';
const EXT_DISPLAY = '完全记忆';
const LOG_PREFIX  = `[${EXT_DISPLAY}]`;

// ======================== 默认设置 ========================
const DEFAULT_SETTINGS = {
  enabled: true,
  extractionInterval: 1,
  currentTurnCount: 0,

  current: {
    location: '',
    time: '',
    clothing: '',
    todoList: [],
  },

  chatLog: {
    entries: [],
    maxEntries: 500,
  },

  statusBar: {
    items: [],
    locations: [],
    characters: [],
  },

  worldView: {
    worldSetting: '',
    userProfile: { persona: '', hobbies: '', notes: '' },
    importantNPCs: [],
    relationshipData: { edges: [] },
  },

  config: {
    theme: 'default',
    customCSS: '',
    summary: {
      enabled: true,
      apiType: 'same',
      customEndpoint: '',
      customApiKey: '',
      customModel: '',
    },
    vector: {
      enabled: false,
      apiType: 'openai',
      endpoint: '',
      apiKey: '',
      model: 'text-embedding-3-small',
      topK: 5,
      similarityThreshold: 0.75,
    },
    prompt: {
      extractionSystemPrompt: '',
      injectionTemplate: '',
      summaryPrompt: '',
    },
  },
};

// ======================== 工具函数 ========================

function getSettings() {
  return extension_settings[EXT_NAME];
}

function saveSettings() {
  saveSettingsDebounced();
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ======================== UI 更新函数 ========================

function updateStatus(type, text) {
  const dot = $('#cm-status-indicator');
  dot.removeClass('cm-status-ok cm-status-extracting cm-status-error');
  dot.addClass(`cm-status-${type}`);
  $('#cm-status-text').text(text);
}

function updateMemoryCount() {
  const s = getSettings();
  const count = s.chatLog?.entries?.length || 0;
  $('#cm-memory-count').text(`📝 ${count}`);
  $('#cm-log-count').text(count);
}

// ======================== 当前 Tab 逻辑 ========================

function initCurrentTab() {
  const s = getSettings();

  // 加载已有数据
  $('#cm-current-location').val(s.current.location || '');
  $('#cm-current-time').val(s.current.time || '');
  $('#cm-current-clothing').val(s.current.clothing || '');
  renderTodoList();

  // 绑定事件 - 实时保存
  $('#cm-current-location').on('input', function () {
    s.current.location = $(this).val();
    saveSettings();
  });

  $('#cm-current-time').on('input', function () {
    s.current.time = $(this).val();
    saveSettings();
  });

  $('#cm-current-clothing').on('input', function () {
    s.current.clothing = $(this).val();
    saveSettings();
  });

  // 待办事项
  $('#cm-todo-add-btn').on('click', addTodoItem);
  $('#cm-todo-input').on('keypress', function (e) {
    if (e.key === 'Enter') addTodoItem();
  });
}

function addTodoItem() {
  const input = $('#cm-todo-input');
  const text = input.val().trim();
  if (!text) return;

  const s = getSettings();
  s.current.todoList.push({ id: generateId(), text: text, completed: false });
  input.val('');
  saveSettings();
  renderTodoList();
}

function renderTodoList() {
  const s = getSettings();
  const container = $('#cm-todo-list');
  container.empty();

  if (s.current.todoList.length === 0) {
    container.html('<div class="cm-empty-hint">暂无待办事项</div>');
    return;
  }

  s.current.todoList.forEach((todo) => {
    const item = $(`
      <div class="cm-todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
        <input type="checkbox" ${todo.completed ? 'checked' : ''} class="cm-todo-check" />
        <span class="cm-todo-text">${todo.text}</span>
        <span class="cm-todo-delete"><i class="fa-solid fa-xmark"></i></span>
      </div>
    `);
    container.append(item);
  });

  // 绑定事件
  container.find('.cm-todo-check').on('change', function () {
    const id = $(this).closest('.cm-todo-item').data('id');
    const todo = s.current.todoList.find(t => t.id === id);
    if (todo) {
      todo.completed = this.checked;
      saveSettings();
      renderTodoList();
    }
  });

  container.find('.cm-todo-delete').on('click', function () {
    const id = $(this).closest('.cm-todo-item').data('id');
    s.current.todoList = s.current.todoList.filter(t => t.id !== id);
    saveSettings();
    renderTodoList();
  });
}

// ======================== 聊天记录 Tab 逻辑 ========================

function initChatLogTab() {
  renderChatLogEntries();

  // 搜索
  $('#cm-chatlog-search').on('input', function () {
    const keyword = $(this).val().toLowerCase();
    renderChatLogEntries(keyword);
  });

  // 清空
  $('#cm-chatlog-clear').on('click', function () {
    if (confirm('确定要清空所有聊天记录摘要吗？')) {
      const s = getSettings();
      s.chatLog.entries = [];
      saveSettings();
      renderChatLogEntries();
      updateMemoryCount();
    }
  });
}

function renderChatLogEntries(filter = '') {
  const s = getSettings();
  const container = $('#cm-chatlog-entries');
  container.empty();

  let entries = s.chatLog.entries || [];
  if (filter) {
    entries = entries.filter(e => e.summary.toLowerCase().includes(filter));
  }

  if (entries.length === 0) {
    container.html(`
      <div class="cm-empty-state">
        <i class="fa-solid fa-inbox"></i>
        <p>暂无聊天记录摘要</p>
        <small>开始对话后，记忆将自动提取到这里</small>
      </div>
    `);
    return;
  }

  // 倒序显示（最新在上）
  [...entries].reverse().forEach((entry) => {
    const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN') : '';
    const el = $(`
      <div class="cm-chatlog-entry" data-turn="${entry.turn}">
        <div class="cm-chatlog-entry-header">
          <span>第 ${entry.turn} 轮</span>
          <span>${time}</span>
        </div>
        <div class="cm-chatlog-entry-body">${entry.summary}</div>
      </div>
    `);
    container.append(el);
  });

  $('#cm-log-count').text(entries.length);
}

function addChatLogEntry(entry) {
  const s = getSettings();
  s.chatLog.entries.push(entry);

  // 限制最大条数
  if (s.chatLog.entries.length > s.chatLog.maxEntries) {
    s.chatLog.entries = s.chatLog.entries.slice(-s.chatLog.maxEntries);
  }

  saveSettings();
  renderChatLogEntries();
  updateMemoryCount();
}

// ======================== 状态栏 Tab 逻辑 ========================

function initStatusBarTab() {
  renderItems();
  renderLocations();
  renderCharacters();

  // 添加物品
  $('#cm-item-add').on('click', () => showItemDialog());
  // 添加地点
  $('#cm-location-add').on('click', () => showLocationDialog());
  // 查看地图
  $('#cm-map-view').on('click', () => toggleMapView());
  // 添加人物
  $('#cm-char-add').on('click', () => showCharacterDialog());
}

// —— 物品 ——

function renderItems() {
  const s = getSettings();
  const container = $('#cm-items-list');
  container.empty();

  if (s.statusBar.items.length === 0) {
    container.html('<div class="cm-empty-hint">暂无物品记录</div>');
    return;
  }

  s.statusBar.items.forEach((item) => {
    const card = $(`
      <div class="cm-card" data-id="${item.id}">
        <div class="cm-card-title">
          📦 ${item.name}
          <span class="cm-card-actions">
            <i class="fa-solid fa-pen-to-square cm-edit-item" title="编辑"></i>
            <i class="fa-solid fa-trash cm-delete-item" title="删除"></i>
          </span>
        </div>
        <div class="cm-card-detail">
          ${item.desc ? `<div>📝 ${item.desc}</div>` : ''}
          ${item.holder ? `<div>👤 持有: ${item.holder}</div>` : ''}
          ${item.location ? `<div>📍 位置: ${item.location}</div>` : ''}
        </div>
      </div>
    `);
    container.append(card);
  });

  // 绑定删除
  container.find('.cm-delete-item').on('click', function () {
    const id = $(this).closest('.cm-card').data('id');
    s.statusBar.items = s.statusBar.items.filter(i => i.id !== id);
    saveSettings();
    renderItems();
  });
}

function showItemDialog(existingItem = null) {
  const isEdit = !!existingItem;
  const title = isEdit ? '编辑物品' : '添加物品';

  const html = `
    <div class="cm-dialog-overlay" id="cm-dialog">
      <div class="cm-dialog">
        <div class="cm-dialog-title">${title}</div>
        <div class="cm-section">
          <label class="cm-label">物品名称</label>
          <input type="text" id="cm-dlg-item-name" class="cm-input" value="${existingItem?.name || ''}" />
        </div>
        <div class="cm-section">
          <label class="cm-label">物品描述</label>
          <textarea id="cm-dlg-item-desc" class="cm-textarea" rows="2">${existingItem?.desc || ''}</textarea>
        </div>
        <div class="cm-section">
          <label class="cm-label">持有者</label>
          <input type="text" id="cm-dlg-item-holder" class="cm-input" value="${existingItem?.holder || ''}" />
        </div>
        <div class="cm-section">
          <label class="cm-label">位置</label>
          <input type="text" id="cm-dlg-item-location" class="cm-input" value="${existingItem?.location || ''}" />
        </div>
        <div class="cm-dialog-actions">
          <button class="cm-btn cm-btn-sm" id="cm-dlg-cancel">取消</button>
          <button class="cm-btn cm-btn-sm cm-btn-primary" id="cm-dlg-confirm">确定</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(html);

  $('#cm-dlg-cancel').on('click', () => $('#cm-dialog').remove());
  $('#cm-dlg-confirm').on('click', () => {
    const s = getSettings();
    const item = {
      id: existingItem?.id || generateId(),
      name: $('#cm-dlg-item-name').val().trim(),
      desc: $('#cm-dlg-item-desc').val().trim(),
      holder: $('#cm-dlg-item-holder').val().trim(),
      location: $('#cm-dlg-item-location').val().trim(),
    };

    if (!item.name) { alert('请输入物品名称'); return; }

    if (isEdit) {
      const idx = s.statusBar.items.findIndex(i => i.id === item.id);
      if (idx >= 0) s.statusBar.items[idx] = item;
    } else {
      s.statusBar.items.push(item);
    }

    saveSettings();
    renderItems();
    $('#cm-dialog').remove();
  });
}

// —— 地点 ——

function renderLocations() {
  const s = getSettings();
  const container = $('#cm-location-tree');
  container.empty();

  if (s.statusBar.locations.length === 0) {
    container.html('<div class="cm-empty-hint">暂无地点记录</div>');
    return;
  }

  // 构建树
  const tree = buildLocationTree(s.statusBar.locations);
  const treeHtml = renderLocationTreeHTML(tree, s.current.location);
  container.html(treeHtml);

  // 绑定删除
  container.find('.cm-delete-loc').on('click', function () {
    const id = $(this).data('id');
    s.statusBar.locations = s.statusBar.locations.filter(l => l.id !== id);
    saveSettings();
    renderLocations();
  });
}

function buildLocationTree(locations) {
  const map = {};
  const roots = [];
  locations.forEach(loc => { map[loc.id] = { ...loc, children: [] }; });
  locations.forEach(loc => {
    if (loc.parentId && map[loc.parentId]) {
      map[loc.parentId].children.push(map[loc.id]);
    } else {
      roots.push(map[loc.id]);
    }
  });
  return roots;
}

function renderLocationTreeHTML(nodes, currentLoc, depth = 0) {
  let html = '';
  nodes.forEach(node => {
    const isCurrent = node.name === currentLoc;
    html += `
      <div class="cm-tree-node ${isCurrent ? 'current' : ''}" style="margin-left:${depth * 20}px">
        <div class="cm-tree-node-header">
          <span class="cm-tree-node-name">${isCurrent ? '📍 ' : '📁 '}${node.name}</span>
          <i class="fa-solid fa-xmark cm-delete-loc" data-id="${node.id}" title="删除"></i>
        </div>
        ${node.desc ? `<div class="cm-tree-node-desc">${node.desc}</div>` : ''}
      </div>
    `;
    if (node.children.length > 0) {
      html += renderLocationTreeHTML(node.children, currentLoc, depth + 1);
    }
  });
  return html;
}

function showLocationDialog() {
  const s = getSettings();
  const parentOptions = s.statusBar.locations.map(l =>
    `<option value="${l.id}">${l.name}</option>`
  ).join('');

  const html = `
    <div class="cm-dialog-overlay" id="cm-dialog">
      <div class="cm-dialog">
        <div class="cm-dialog-title">添加地点</div>
        <div class="cm-section">
          <label class="cm-label">地点名称</label>
          <input type="text" id="cm-dlg-loc-name" class="cm-input" />
        </div>
        <div class="cm-section">
          <label class="cm-label">地点描述</label>
          <textarea id="cm-dlg-loc-desc" class="cm-textarea" rows="2"></textarea>
        </div>
        <div class="cm-section">
          <label class="cm-label">上级地点（可选）</label>
          <select id="cm-dlg-loc-parent" class="cm-select">
            <option value="">— 无（顶级地点）—</option>
            ${parentOptions}
          </select>
        </div>
        <div class="cm-dialog-actions">
          <button class="cm-btn cm-btn-sm" id="cm-dlg-cancel">取消</button>
          <button class="cm-btn cm-btn-sm cm-btn-primary" id="cm-dlg-confirm">确定</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(html);

  $('#cm-dlg-cancel').on('click', () => $('#cm-dialog').remove());
  $('#cm-dlg-confirm').on('click', () => {
    const name = $('#cm-dlg-loc-name').val().trim();
    if (!name) { alert('请输入地点名称'); return; }

    s.statusBar.locations.push({
      id: generateId(),
      name: name,
      desc: $('#cm-dlg-loc-desc').val().trim(),
      parentId: $('#cm-dlg-loc-parent').val() || null,
    });

    saveSettings();
    renderLocations();
    $('#cm-dialog').remove();
  });
}

function toggleMapView() {
  const mapContainer = $('#cm-map-canvas');
  const treeContainer = $('#cm-location-tree');

  if (mapContainer.is(':visible')) {
    mapContainer.hide();
    treeContainer.show();
    $('#cm-map-view').html('<i class="fa-solid fa-map"></i> 查看地图');
  } else {
    treeContainer.hide();
    mapContainer.show();
    $('#cm-map-view').html('<i class="fa-solid fa-list"></i> 列表视图');
    renderMap();
  }
}

function renderMap() {
  const s = getSettings();
  const container = document.getElementById('cm-map-canvas');
  if (!container) return;

  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 500;
  canvas.height = 350;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const tree = buildLocationTree(s.statusBar.locations);
  if (tree.length === 0) {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无地点数据', canvas.width / 2, canvas.height / 2);
    return;
  }

  drawMapTree(ctx, tree, canvas.width / 2, 50, canvas.width, 0, s.current.location);
}

function drawMapTree(ctx, nodes, centerX, y, availWidth, depth, currentLoc) {
  const nodeWidth = 100;
  const nodeHeight = 30;
  const levelHeight = 70;
  const gap = 20;

  const totalWidth = nodes.length * (nodeWidth + gap) - gap;
  let startX = centerX - totalWidth / 2;

  nodes.forEach((node, i) => {
    const x = startX + i * (nodeWidth + gap) + nodeWidth / 2;
    const ny = y + depth * levelHeight;
    const isCurrent = node.name === currentLoc;

    // 连线到父级
    if (depth > 0) {
      ctx.beginPath();
      ctx.moveTo(centerX, ny - levelHeight + nodeHeight);
      ctx.lineTo(x, ny);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 节点框
    ctx.fillStyle = isCurrent ? '#FF6B6B' : '#2a2a4a';
    ctx.strokeStyle = isCurrent ? '#FF6B6B' : '#555';
    ctx.lineWidth = isCurrent ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x - nodeWidth / 2, ny, nodeWidth, nodeHeight, 6);
    ctx.fill();
    ctx.stroke();

    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = isCurrent ? 'bold 11px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayName = node.name.length > 8 ? node.name.substr(0, 7) + '…' : node.name;
    ctx.fillText(displayName, x, ny + nodeHeight / 2);

    // 子节点
    if (node.children.length > 0) {
      drawMapTree(ctx, node.children, x, y, availWidth / nodes.length, depth + 1, currentLoc);
    }
  });
}

// —— 人物 ——

function renderCharacters() {
  const s = getSettings();
  const container = $('#cm-characters-list');
  container.empty();

  if (s.statusBar.characters.length === 0) {
    container.html('<div class="cm-empty-hint">暂无人物记录</div>');
    return;
  }

  s.statusBar.characters.forEach((char) => {
    const card = $(`
      <div class="cm-card cm-char-card" data-id="${char.id}">
        <div class="cm-card-title">
          👤 ${char.name}
          <span class="cm-card-actions">
            <i class="fa-solid fa-pen-to-square cm-edit-char" title="编辑"></i>
            <i class="fa-solid fa-trash cm-delete-char" title="删除"></i>
          </span>
        </div>
        <div class="cm-card-detail">
          ${char.gender ? `<div>性别: ${char.gender}</div>` : ''}
          ${char.height ? `<div>身高体重: ${char.height}${char.weight ? ' / ' + char.weight : ''}</div>` : ''}
          ${char.appearance ? `<div>外貌: ${char.appearance}</div>` : ''}
          ${char.personality ? `<div>性格: ${char.personality}</div>` : ''}
          ${char.identity ? `<div>身份: ${char.identity}</div>` : ''}
          ${char.relationships ? `<div>关系: ${char.relationships}</div>` : ''}
        </div>
      </div>
    `);
    container.append(card);
  });

  // 删除
  container.find('.cm-delete-char').on('click', function () {
    const id = $(this).closest('.cm-card').data('id');
    s.statusBar.characters = s.statusBar.characters.filter(c => c.id !== id);
    saveSettings();
    renderCharacters();
  });
}

function showCharacterDialog(existing = null) {
  const isEdit = !!existing;
  const c = existing || {};

  const html = `
    <div class="cm-dialog-overlay" id="cm-dialog">
      <div class="cm-dialog cm-dialog-wide">
        <div class="cm-dialog-title">${isEdit ? '编辑' : '添加'}人物</div>
        <div class="cm-dialog-grid">
          <div class="cm-section">
            <label class="cm-label">姓名</label>
            <input type="text" id="cm-dlg-char-name" class="cm-input" value="${c.name || ''}" />
          </div>
          <div class="cm-section">
            <label class="cm-label">性别</label>
            <input type="text" id="cm-dlg-char-gender" class="cm-input" value="${c.gender || ''}" />
          </div>
          <div class="cm-section">
            <label class="cm-label">身高</label>
            <input type="text" id="cm-dlg-char-height" class="cm-input" value="${c.height || ''}" />
          </div>
          <div class="cm-section">
            <label class="cm-label">体重</label>
            <input type="text" id="cm-dlg-char-weight" class="cm-input" value="${c.weight || ''}" />
          </div>
        </div>
        <div class="cm-section">
          <label class="cm-label">外貌</label>
          <textarea id="cm-dlg-char-appearance" class="cm-textarea" rows="2">${c.appearance || ''}</textarea>
        </div>
        <div class="cm-section">
          <label class="cm-label">性格</label>
          <textarea id="cm-dlg-char-personality" class="cm-textarea" rows="2">${c.personality || ''}</textarea>
        </div>
        <div class="cm-section">
          <label class="cm-label">身份</label>
          <input type="text" id="cm-dlg-char-identity" class="cm-input" value="${c.identity || ''}" />
        </div>
        <div class="cm-section">
          <label class="cm-label">关系</label>
          <input type="text" id="cm-dlg-char-rel" class="cm-input" value="${c.relationships || ''}" />
        </div>
        <div class="cm-dialog-actions">
          <button class="cm-btn cm-btn-sm" id="cm-dlg-cancel">取消</button>
          <button class="cm-btn cm-btn-sm cm-btn-primary" id="cm-dlg-confirm">确定</button>
        </div>
      </div>
    </div>
  `;

  $('body').append(html);

  $('#cm-dlg-cancel').on('click', () => $('#cm-dialog').remove());
  $('#cm-dlg-confirm').on('click', () => {
    const name = $('#cm-dlg-char-name').val().trim();
    if (!name) { alert('请输入姓名'); return; }

    const s = getSettings();
    const charData = {
      id: c.id || generateId(),
      name,
      gender: $('#cm-dlg-char-gender').val().trim(),
      height: $('#cm-dlg-char-height').val().trim(),
      weight: $('#cm-dlg-char-weight').val().trim(),
      appearance: $('#cm-dlg-char-appearance').val().trim(),
      personality: $('#cm-dlg-char-personality').val().trim(),
      identity: $('#cm-dlg-char-identity').val().trim(),
      relationships: $('#cm-dlg-char-rel').val().trim(),
    };

    if (isEdit) {
      const idx = s.statusBar.characters.findIndex(ch => ch.id === charData.id);
      if (idx >= 0) s.statusBar.characters[idx] = charData;
    } else {
      s.statusBar.characters.push(charData);
    }

    saveSettings();
    renderCharacters();
    $('#cm-dialog').remove();
  });
}

// ======================== 世界观 Tab 逻辑 ========================

function initWorldViewTab() {
  const s = getSettings();

  // 世界观
  $('#cm-world-setting').val(s.worldView.worldSetting || '');
  $('#cm-world-save').on('click', () => {
    s.worldView.worldSetting = $('#cm-world-setting').val();
    saveSettings();
    updateStatus('ok', '世界观已保存');
  });

  // User 人设
  $('#cm-user-persona').val(s.worldView.userProfile?.persona || '');
  $('#cm-user-hobbies').val(s.worldView.userProfile?.hobbies || '');
  $('#cm-user-notes').val(s.worldView.userProfile?.notes || '');

  $('#cm-user-persona, #cm-user-hobbies, #cm-user-notes').on('input', function () {
    s.worldView.userProfile.persona = $('#cm-user-persona').val();
    s.worldView.userProfile.hobbies = $('#cm-user-hobbies').val();
    s.worldView.userProfile.notes   = $('#cm-user-notes').val();
    saveSettings();
  });

  // 重要 NPC
  renderNPCList();
  $('#cm-npc-add').on('click', () => {
    const name = $('#cm-npc-name-input').val().trim();
    if (!name) return;
    s.worldView.importantNPCs.push({ name, persona: '', hobbies: '', notes: '' });
    $('#cm-npc-name-input').val('');
    saveSettings();
    renderNPCList();
  });

  // 关系网
  $('#cm-rel-refresh').on('click', () => renderRelationshipGraph());
}

function renderNPCList() {
  const s = getSettings();
  const container = $('#cm-npc-list');
  container.empty();

  s.worldView.importantNPCs.forEach((npc, idx) => {
    const el = $(`
      <div class="cm-accordion-item" data-idx="${idx}">
        <div class="cm-accordion-header">
          <span>👤 ${npc.name}</span>
          <span class="cm-accordion-actions">
            <i class="fa-solid fa-chevron-down cm-accordion-toggle"></i>
            <i class="fa-solid fa-trash cm-npc-delete" title="删除"></i>
          </span>
        </div>
        <div class="cm-accordion-body">
          <div class="cm-section">
            <label class="cm-label">人设</label>
            <textarea class="cm-textarea cm-npc-persona" rows="2">${npc.persona || ''}</textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">爱好</label>
            <textarea class="cm-textarea cm-npc-hobbies" rows="2">${npc.hobbies || ''}</textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">备注</label>
            <textarea class="cm-textarea cm-npc-notes" rows="2">${npc.notes || ''}</textarea>
          </div>
        </div>
      </div>
    `);
    container.append(el);
  });

  // 手风琴展开/折叠
  container.find('.cm-accordion-header').on('click', function (e) {
    if ($(e.target).hasClass('cm-npc-delete')) return;
    $(this).closest('.cm-accordion-item').toggleClass('open');
  });

  // 删除
  container.find('.cm-npc-delete').on('click', function () {
    const idx = $(this).closest('.cm-accordion-item').data('idx');
    s.worldView.importantNPCs.splice(idx, 1);
    saveSettings();
    renderNPCList();
  });

  // 编辑保存
  container.find('.cm-npc-persona, .cm-npc-hobbies, .cm-npc-notes').on('input', function () {
    const idx = $(this).closest('.cm-accordion-item').data('idx');
    const npc = s.worldView.importantNPCs[idx];
    if (!npc) return;
    npc.persona = $(this).closest('.cm-accordion-body').find('.cm-npc-persona').val();
    npc.hobbies = $(this).closest('.cm-accordion-body').find('.cm-npc-hobbies').val();
    npc.notes   = $(this).closest('.cm-accordion-body').find('.cm-npc-notes').val();
    saveSettings();
  });
}

// ======================== 关系网可视化 ========================

function renderRelationshipGraph() {
  const s = getSettings();
  const container = document.getElementById('cm-relationship-graph');
  if (!container) return;

  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 500;
  canvas.height = 380;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const characters = s.statusBar.characters || [];
  if (characters.length === 0) {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无角色数据，请先在状态栏添加人物', canvas.width / 2, canvas.height / 2);
    return;
  }

  // 构建节点：User 居中
  const nodes = [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  nodes.push({ name: 'User', x: cx, y: cy, type: 'user' });

  characters.forEach((char, i) => {
    const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.32;
    nodes.push({
      name: char.name,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      type: 'npc',
      relationship: char.relationships || '',
    });
  });

  // 绘制连线
  nodes.forEach(node => {
    if (node.type === 'user') return;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(node.x, node.y);
    ctx.strokeStyle = 'rgba(124, 106, 240, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 关系标签
    if (node.relationship) {
      const midX = (cx + node.x) / 2;
      const midY = (cy + node.y) / 2;
      ctx.fillStyle = '#aaa';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.relationship, midX, midY - 6);
    }
  });

  // 绘制节点
  nodes.forEach(node => {
    const r = node.type === 'user' ? 22 : 16;
    const color = node.type === 'user' ? '#FF6B6B' : '#4ECDC4';

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = node.type === 'user' ? 'bold 12px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.name, node.x, node.y + r + 14);
  });
}

// ======================== 设置 Tab 逻辑 ========================

function initSettingsTab() {
  const s = getSettings();

  // 主题
  $('#cm-theme-select').val(s.config.theme || 'default');
  $('#cm-theme-select').on('change', function () {
    s.config.theme = $(this).val();
    applyTheme(s.config.theme);
    saveSettings();
  });

  // 自定义 CSS
  $('#cm-custom-css').val(s.config.customCSS || '');
  $('#cm-custom-css').on('input', function () {
    s.config.customCSS = $(this).val();
    applyCustomCSS(s.config.customCSS);
    saveSettings();
  });

  // 提取间隔
  $('#cm-extraction-interval').val(s.extractionInterval || 1);
  $('#cm-extraction-interval').on('change', function () {
    s.extractionInterval = Math.max(1, parseInt($(this).val()) || 1);
    saveSettings();
  });

  // 摘要 API
  $('#cm-summary-enabled').prop('checked', s.config.summary.enabled);
  $('#cm-summary-api-type').val(s.config.summary.apiType);
  toggleSummaryFields(s.config.summary.apiType);

  $('#cm-summary-api-type').on('change', function () {
    const val = $(this).val();
    s.config.summary.apiType = val;
    toggleSummaryFields(val);
    saveSettings();
  });

  $('#cm-summary-enabled').on('change', function () {
    s.config.summary.enabled = this.checked;
    saveSettings();
  });

  $('#cm-summary-endpoint').val(s.config.summary.customEndpoint || '');
  $('#cm-summary-apikey').val(s.config.summary.customApiKey || '');
  $('#cm-summary-model').val(s.config.summary.customModel || '');

  $('#cm-summary-endpoint, #cm-summary-apikey, #cm-summary-model').on('input', function () {
    s.config.summary.customEndpoint = $('#cm-summary-endpoint').val();
    s.config.summary.customApiKey   = $('#cm-summary-apikey').val();
    s.config.summary.customModel    = $('#cm-summary-model').val();
    saveSettings();
  });

  // 向量
  $('#cm-vector-enabled').prop('checked', s.config.vector.enabled);
  $('#cm-vector-api-type').val(s.config.vector.apiType);
  $('#cm-vector-endpoint').val(s.config.vector.endpoint || '');
  $('#cm-vector-apikey').val(s.config.vector.apiKey || '');
  $('#cm-vector-model').val(s.config.vector.model || 'text-embedding-3-small');
  $('#cm-vector-topk').val(s.config.vector.topK || 5);
  $('#cm-vector-threshold').val(s.config.vector.similarityThreshold || 0.75);

  $('#cm-vector-enabled').on('change', function () {
    s.config.vector.enabled = this.checked;
    saveSettings();
  });

  $('#cm-vector-api-type, #cm-vector-endpoint, #cm-vector-apikey, #cm-vector-model, #cm-vector-topk, #cm-vector-threshold')
    .on('input change', function () {
      s.config.vector.apiType = $('#cm-vector-api-type').val();
      s.config.vector.endpoint = $('#cm-vector-endpoint').val();
      s.config.vector.apiKey = $('#cm-vector-apikey').val();
      s.config.vector.model = $('#cm-vector-model').val();
      s.config.vector.topK = parseInt($('#cm-vector-topk').val()) || 5;
      s.config.vector.similarityThreshold = parseFloat($('#cm-vector-threshold').val()) || 0.75;
      saveSettings();
    });

  // 提示词
  $('#cm-prompt-extraction').val(s.config.prompt.extractionSystemPrompt || '');
  $('#cm-prompt-summary').val(s.config.prompt.summaryPrompt || '');
  $('#cm-prompt-injection').val(s.config.prompt.injectionTemplate || '');

  $('#cm-prompt-save').on('click', () => {
    s.config.prompt.extractionSystemPrompt = $('#cm-prompt-extraction').val();
    s.config.prompt.summaryPrompt = $('#cm-prompt-summary').val();
    s.config.prompt.injectionTemplate = $('#cm-prompt-injection').val();
    saveSettings();
    updateStatus('ok', '提示词已保存');
  });

  $('#cm-prompt-reset').on('click', () => {
    if (confirm('确定恢复默认提示词？')) {
      s.config.prompt = { extractionSystemPrompt: '', injectionTemplate: '', summaryPrompt: '' };
      $('#cm-prompt-extraction').val('');
      $('#cm-prompt-summary').val('');
      $('#cm-prompt-injection').val('');
      saveSettings();
    }
  });

  // 启用开关
  $('#cm-enabled-toggle').prop('checked', s.enabled);
  $('#cm-enabled-toggle').on('change', function () {
    s.enabled = this.checked;
    saveSettings();
    updateStatus(s.enabled ? 'ok' : 'error', s.enabled ? '就绪' : '已禁用');
  });
}

function toggleSummaryFields(apiType) {
  if (apiType === 'custom') {
    $('#cm-summary-custom-fields').show();
  } else {
    $('#cm-summary-custom-fields').hide();
  }
}

function applyTheme(theme) {
  const panel = $('#cm-complete-memory-panel');
  panel.removeClass('cm-theme-dark-purple cm-theme-ocean-blue cm-theme-forest-green cm-theme-sakura-pink');
  if (theme && theme !== 'default' && theme !== 'custom') {
    panel.addClass(`cm-theme-${theme}`);
  }
}

function applyCustomCSS(css) {
  let styleEl = $('#cm-custom-style');
  if (styleEl.length === 0) {
    styleEl = $('<style id="cm-custom-style"></style>');
    $('head').append(styleEl);
  }
  styleEl.text(css);
}

// ======================== 记忆提取核心 ========================

async function extractMemory(chat, msgIndex) {
  const s = getSettings();

  // 取最近几条消息
  const windowSize = 6;
  const start = Math.max(0, msgIndex - windowSize + 1);
  const recentMsgs = chat.slice(start, msgIndex + 1);

  const dialogText = recentMsgs.map(m => {
    const role = m.is_user ? 'User' : (m.name || 'Character');
    return `[${role}]: ${m.mes}`;
  }).join('\n');

  const systemPrompt = s.config.prompt.extractionSystemPrompt || getDefaultExtractionPrompt();

  const userPrompt = `以下是最近的对话内容：
---
${dialogText}
---

当前已知状态：
地点: ${s.current.location || '未知'}
时间: ${s.current.time || '未知'}
服装: ${s.current.clothing || '未知'}
已知角色: ${(s.statusBar.characters || []).map(c => c.name).join(', ') || '无'}
已知地点: ${(s.statusBar.locations || []).map(l => l.name).join(', ') || '无'}

请根据上述对话提取记忆信息，以 JSON 格式返回：
{
  "current": { "location": "string|null", "time": "string|null", "clothing": "string|null" },
  "summary": "本轮对话的一句话摘要",
  "items": [{ "action": "add|update|remove", "name": "", "desc": "", "holder": "", "location": "" }],
  "locations": [{ "action": "add", "name": "", "desc": "", "parentName": "" }],
  "characters": [{ "action": "add|update", "name": "", "gender": "", "height": "", "weight": "", "appearance": "", "personality": "", "identity": "", "relationships": "" }],
  "worldUpdate": "string|null"
}
只输出 JSON，不要有其他文字。`;

  let responseText = '';

  try {
    if (s.config.summary.apiType === 'custom' && s.config.summary.customEndpoint) {
      const response = await fetch(`${s.config.summary.customEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.config.summary.customApiKey}`,
        },
        body: JSON.stringify({
          model: s.config.summary.customModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
        }),
      });
      const data = await response.json();
      responseText = data.choices?.[0]?.message?.content || '{}';
    } else {
      const combinedPrompt = systemPrompt + '\n\n' + userPrompt;
      responseText = await generateRaw(combinedPrompt, null, false, false) || '{}';
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} API 调用失败:`, err);
    return null;
  }

  // 解析 JSON
  try {
    let jsonStr = responseText;
    const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1];
    return JSON.parse(jsonStr.trim());
  } catch (err) {
    console.warn(`${LOG_PREFIX} JSON 解析失败:`, err);
    return null;
  }
}

function getDefaultExtractionPrompt() {
  return `你是一个专业的叙事记忆提取器。从角色扮演对话中提取关键信息：
1. 当前状态变化（地点、时间、服装）
2. 对话摘要（一句话概括）
3. 物品变动
4. 新地点
5. 人物信息
6. 世界观更新
请严格以 JSON 格式输出，只输出 JSON。`;
}

function applyExtractedMemory(extracted) {
  const s = getSettings();

  // 更新当前状态
  if (extracted.current) {
    if (extracted.current.location) s.current.location = extracted.current.location;
    if (extracted.current.time) s.current.time = extracted.current.time;
    if (extracted.current.clothing) s.current.clothing = extracted.current.clothing;

    $('#cm-current-location').val(s.current.location);
    $('#cm-current-time').val(s.current.time);
    $('#cm-current-clothing').val(s.current.clothing);
  }

  // 物品
  if (extracted.items && Array.isArray(extracted.items)) {
    extracted.items.forEach(item => {
      if (item.action === 'add' && item.name) {
        const exists = s.statusBar.items.find(i => i.name === item.name);
        if (!exists) {
          s.statusBar.items.push({
            id: generateId(), name: item.name, desc: item.desc || '',
            holder: item.holder || '', location: item.location || '',
          });
        }
      } else if (item.action === 'remove' && item.name) {
        s.statusBar.items = s.statusBar.items.filter(i => i.name !== item.name);
      } else if (item.action === 'update' && item.name) {
        const existing = s.statusBar.items.find(i => i.name === item.name);
        if (existing) {
          if (item.desc) existing.desc = item.desc;
          if (item.holder) existing.holder = item.holder;
          if (item.location) existing.location = item.location;
        }
      }
    });
    renderItems();
  }

  // 地点
  if (extracted.locations && Array.isArray(extracted.locations)) {
    extracted.locations.forEach(loc => {
      if (loc.action === 'add' && loc.name) {
        const exists = s.statusBar.locations.find(l => l.name === loc.name);
        if (!exists) {
          let parentId = null;
          if (loc.parentName) {
            const parent = s.statusBar.locations.find(l => l.name === loc.parentName);
            if (parent) parentId = parent.id;
          }
          s.statusBar.locations.push({
            id: generateId(), name: loc.name, desc: loc.desc || '', parentId,
          });
        }
      }
    });
    renderLocations();
  }

  // 人物
  if (extracted.characters && Array.isArray(extracted.characters)) {
    extracted.characters.forEach(char => {
      if (!char.name) return;
      const existing = s.statusBar.characters.find(c => c.name === char.name);
      if (existing) {
        // 更新非空字段
        if (char.gender) existing.gender = char.gender;
        if (char.height) existing.height = char.height;
        if (char.weight) existing.weight = char.weight;
        if (char.appearance) existing.appearance = char.appearance;
        if (char.personality) existing.personality = char.personality;
        if (char.identity) existing.identity = char.identity;
        if (char.relationships) existing.relationships = char.relationships;
      } else {
        s.statusBar.characters.push({
          id: generateId(), name: char.name, gender: char.gender || '',
          height: char.height || '', weight: char.weight || '',
          appearance: char.appearance || '', personality: char.personality || '',
          identity: char.identity || '', relationships: char.relationships || '',
        });
      }
    });
    renderCharacters();
  }

  // 世界观
  if (extracted.worldUpdate) {
    s.worldView.worldSetting += '\n' + extracted.worldUpdate;
    $('#cm-world-setting').val(s.worldView.worldSetting);
  }

  saveSettings();
}

// ======================== 记忆注入（发送给AI前） ========================

function buildMemoryInjection() {
  const s = getSettings();
  const template = s.config.prompt.injectionTemplate || getDefaultInjectionTemplate();

  let result = template;
  result = result.replace('{{current}}', buildCurrentBlock(s));
  result = result.replace('{{recent_logs}}', buildRecentLogs(s));
  result = result.replace('{{status}}', buildStatusBlock(s));
  result = result.replace('{{world}}', s.worldView.worldSetting || '');

  return result;
}

function getDefaultInjectionTemplate() {
  return `[记忆系统 — 完全记忆]
【当前状态】
{{current}}

【近期事件】
{{recent_logs}}

【角色与物品】
{{status}}

【世界观】
{{world}}
[/记忆系统]`;
}

function buildCurrentBlock(s) {
  const lines = [];
  if (s.current.location) lines.push(`📍 地点: ${s.current.location}`);
  if (s.current.time)     lines.push(`🕐 时间: ${s.current.time}`);
  if (s.current.clothing) lines.push(`👔 服装: ${s.current.clothing}`);
  if (s.current.todoList?.length > 0) {
    const todos = s.current.todoList.filter(t => !t.completed).map(t => t.text).join(', ');
    if (todos) lines.push(`📋 待办: ${todos}`);
  }
  return lines.join('\n') || '暂无';
}

function buildRecentLogs(s, count = 10) {
  const entries = (s.chatLog.entries || []).slice(-count);
  if (entries.length === 0) return '暂无';
  return entries.map(e => `[#${e.turn}] ${e.summary}`).join('\n');
}

function buildStatusBlock(s) {
  const parts = [];
  if (s.statusBar.characters.length > 0) {
    parts.push('【人物】');
    s.statusBar.characters.forEach(c => {
      parts.push(`• ${c.name} — ${c.identity || '未知身份'} ${c.relationships ? '(' + c.relationships + ')' : ''}`);
    });
  }
  if (s.statusBar.items.length > 0) {
    parts.push('【物品】');
    s.statusBar.items.forEach(i => {
      parts.push(`• ${i.name}: ${i.desc || ''} [持有: ${i.holder || '未知'}]`);
    });
  }
  return parts.join('\n') || '';
}

// ======================== 主面板 HTML ========================

function renderMainPanel() {
  const panelHTML = `
  <div id="cm-complete-memory-panel" class="cm-panel">
    <div class="cm-header">
      <span class="cm-header-icon">🧠</span>
      <span class="cm-header-title">${EXT_DISPLAY}</span>
      <span class="cm-header-version">v0.1.0</span>
      <label class="cm-toggle" title="启用/禁用">
        <input type="checkbox" id="cm-enabled-toggle" checked />
        <span class="cm-toggle-slider"></span>
      </label>
    </div>

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

    <div class="cm-tab-content">

      <!-- 当前 -->
      <div class="cm-tab-pane active" id="cm-pane-current">
        <div class="cm-section">
          <label class="cm-label"><i class="fa-solid fa-map-pin"></i> 当前地点</label>
          <input type="text" id="cm-current-location" class="cm-input" placeholder="角色当前所在地点..." />
        </div>
        <div class="cm-section">
          <label class="cm-label"><i class="fa-regular fa-clock"></i> 当前时间</label>
          <input type="text" id="cm-current-time" class="cm-input" placeholder="故事中的当前时间..." />
        </div>
        <div class="cm-section">
          <label class="cm-label"><i class="fa-solid fa-shirt"></i> 当前服装</label>
          <textarea id="cm-current-clothing" class="cm-textarea" rows="2" placeholder="角色当前穿着描述..."></textarea>
        </div>
        <div class="cm-section">
          <label class="cm-label"><i class="fa-solid fa-list-check"></i> 待办事项</label>
          <div id="cm-todo-list" class="cm-todo-container"></div>
          <div class="cm-todo-add">
            <input type="text" id="cm-todo-input" class="cm-input" placeholder="添加待办事项..." />
            <button id="cm-todo-add-btn" class="cm-btn cm-btn-sm"><i class="fa-solid fa-plus"></i></button>
          </div>
        </div>
      </div>

      <!-- 聊天记录 -->
      <div class="cm-tab-pane" id="cm-pane-chatlog">
        <div class="cm-chatlog-toolbar">
          <span class="cm-chatlog-count">共 <strong id="cm-log-count">0</strong> 条</span>
          <input type="text" id="cm-chatlog-search" class="cm-input cm-input-sm" placeholder="🔍 搜索..." />
          <button id="cm-chatlog-clear" class="cm-btn cm-btn-sm cm-btn-danger" title="清空">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <div id="cm-chatlog-entries" class="cm-chatlog-list"></div>
      </div>

      <!-- 状态栏 -->
      <div class="cm-tab-pane" id="cm-pane-statusbar">
        <div class="cm-sub-tab-bar">
          <button class="cm-sub-tab-btn active" data-subtab="items"><i class="fa-solid fa-box"></i> 物品</button>
          <button class="cm-sub-tab-btn" data-subtab="locations"><i class="fa-solid fa-map"></i> 地点</button>
          <button class="cm-sub-tab-btn" data-subtab="characters"><i class="fa-solid fa-users"></i> 人物</button>
        </div>
        <div class="cm-sub-pane active" id="cm-sub-items">
          <div class="cm-toolbar">
            <button id="cm-item-add" class="cm-btn cm-btn-sm"><i class="fa-solid fa-plus"></i> 添加物品</button>
          </div>
          <div id="cm-items-list" class="cm-card-grid"></div>
        </div>
        <div class="cm-sub-pane" id="cm-sub-locations">
          <div class="cm-toolbar">
            <button id="cm-location-add" class="cm-btn cm-btn-sm"><i class="fa-solid fa-plus"></i> 添加地点</button>
            <button id="cm-map-view" class="cm-btn cm-btn-sm cm-btn-accent"><i class="fa-solid fa-map"></i> 查看地图</button>
          </div>
          <div id="cm-location-tree" class="cm-tree-view"></div>
          <div id="cm-map-canvas" class="cm-map-container" style="display:none;"></div>
        </div>
        <div class="cm-sub-pane" id="cm-sub-characters">
          <div class="cm-toolbar">
            <button id="cm-char-add" class="cm-btn cm-btn-sm"><i class="fa-solid fa-plus"></i> 添加人物</button>
          </div>
          <div id="cm-characters-list" class="cm-card-grid"></div>
        </div>
      </div>

      <!-- 世界观 -->
      <div class="cm-tab-pane" id="cm-pane-worldview">
        <div class="cm-sub-tab-bar">
          <button class="cm-sub-tab-btn active" data-subtab="world"><i class="fa-solid fa-earth-asia"></i> 世界观</button>
          <button class="cm-sub-tab-btn" data-subtab="user-profile"><i class="fa-solid fa-user"></i> User人设</button>
          <button class="cm-sub-tab-btn" data-subtab="npc-profiles"><i class="fa-solid fa-user-group"></i> 重要人物</button>
          <button class="cm-sub-tab-btn" data-subtab="relationship"><i class="fa-solid fa-circle-nodes"></i> 关系网</button>
        </div>
        <div class="cm-sub-pane active" id="cm-sub-world">
          <label class="cm-label">世界观设定 <small>（随剧情自动更新）</small></label>
          <textarea id="cm-world-setting" class="cm-textarea" rows="10" placeholder="当前世界的背景设定..."></textarea>
          <div class="cm-actions">
            <button id="cm-world-save" class="cm-btn cm-btn-sm cm-btn-primary"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
          </div>
        </div>
        <div class="cm-sub-pane" id="cm-sub-user-profile">
          <div class="cm-section">
            <label class="cm-label">人设</label>
            <textarea id="cm-user-persona" class="cm-textarea" rows="4" placeholder="User 的性格/背景..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">爱好</label>
            <textarea id="cm-user-hobbies" class="cm-textarea" rows="3" placeholder="User 的爱好..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">备注</label>
            <textarea id="cm-user-notes" class="cm-textarea" rows="3" placeholder="其他补充..."></textarea>
          </div>
        </div>
        <div class="cm-sub-pane" id="cm-sub-npc-profiles">
          <div class="cm-toolbar">
            <input type="text" id="cm-npc-name-input" class="cm-input cm-input-sm" placeholder="输入重要人物名称..." />
            <button id="cm-npc-add" class="cm-btn cm-btn-sm"><i class="fa-solid fa-plus"></i> 添加</button>
          </div>
          <div id="cm-npc-list" class="cm-accordion"></div>
        </div>
        <div class="cm-sub-pane" id="cm-sub-relationship">
          <div class="cm-toolbar">
            <button id="cm-rel-refresh" class="cm-btn cm-btn-sm"><i class="fa-solid fa-rotate"></i> 刷新关系网</button>
          </div>
          <div id="cm-relationship-graph" class="cm-graph-container"></div>
        </div>
      </div>

      <!-- 设置 -->
      <div class="cm-tab-pane" id="cm-pane-settings">
        <div class="cm-sub-tab-bar">
          <button class="cm-sub-tab-btn active" data-subtab="general"><i class="fa-solid fa-palette"></i> 美化</button>
          <button class="cm-sub-tab-btn" data-subtab="summary"><i class="fa-solid fa-file-lines"></i> 自动摘要</button>
          <button class="cm-sub-tab-btn" data-subtab="vector"><i class="fa-solid fa-magnifying-glass"></i> 向量记忆</button>
          <button class="cm-sub-tab-btn" data-subtab="prompts"><i class="fa-solid fa-terminal"></i> 提示词</button>
        </div>
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
            <textarea id="cm-custom-css" class="cm-textarea cm-code" rows="4" placeholder="/* 自定义样式 */"></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">记忆提取间隔</label>
            <div class="cm-inline">
              <span>每</span>
              <input type="number" id="cm-extraction-interval" class="cm-input cm-input-xs" min="1" max="50" value="1" />
              <span>轮对话提取一次</span>
            </div>
          </div>
        </div>
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
              <input type="text" id="cm-summary-endpoint" class="cm-input" placeholder="https://api.openai.com/v1" />
            </div>
            <div class="cm-section">
              <label class="cm-label">API Key</label>
              <input type="password" id="cm-summary-apikey" class="cm-input" placeholder="sk-..." />
            </div>
            <div class="cm-section">
              <label class="cm-label">模型名称</label>
              <input type="text" id="cm-summary-model" class="cm-input" placeholder="gpt-4o-mini" />
            </div>
          </div>
        </div>
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
              <option value="local">本地模型</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          <div class="cm-section">
            <label class="cm-label">Endpoint</label>
            <input type="text" id="cm-vector-endpoint" class="cm-input" placeholder="https://api.openai.com/v1/embeddings" />
          </div>
          <div class="cm-section">
            <label class="cm-label">API Key</label>
            <input type="password" id="cm-vector-apikey" class="cm-input" placeholder="sk-..." />
          </div>
          <div class="cm-section">
            <label class="cm-label">Embedding 模型</label>
            <input type="text" id="cm-vector-model" class="cm-input" value="text-embedding-3-small" />
          </div>
          <div class="cm-section cm-inline">
            <div>
              <label class="cm-label">Top-K</label>
              <input type="number" id="cm-vector-topk" class="cm-input cm-input-xs" min="1" max="20" value="5" />
            </div>
            <div>
              <label class="cm-label">相似度阈值</label>
              <input type="number" id="cm-vector-threshold" class="cm-input cm-input-xs" min="0" max="1" step="0.05" value="0.75" />
            </div>
          </div>
        </div>
        <div class="cm-sub-pane" id="cm-sub-prompts">
          <div class="cm-section">
            <label class="cm-label">记忆提取 System Prompt</label>
            <textarea id="cm-prompt-extraction" class="cm-textarea cm-code" rows="6" placeholder="用于提取结构化记忆的系统提示词..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">摘要生成 Prompt</label>
            <textarea id="cm-prompt-summary" class="cm-textarea cm-code" rows="4" placeholder="用于生成摘要的提示词..."></textarea>
          </div>
          <div class="cm-section">
            <label class="cm-label">记忆注入模板</label>
            <textarea id="cm-prompt-injection" class="cm-textarea cm-code" rows="6" placeholder="可使用变量 {{current}}, {{status}}, {{world}}, {{recent_logs}}"></textarea>
          </div>
          <div class="cm-actions">
            <button id="cm-prompt-reset" class="cm-btn cm-btn-sm cm-btn-danger"><i class="fa-solid fa-rotate-left"></i> 恢复默认</button>
            <button id="cm-prompt-save" class="cm-btn cm-btn-sm cm-btn-primary"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
          </div>
        </div>
      </div>

    </div>

    <div class="cm-footer">
      <span id="cm-status-indicator" class="cm-status-dot cm-status-ok"></span>
      <span id="cm-status-text">就绪</span>
      <span class="cm-footer-spacer"></span>
      <span id="cm-memory-count" title="已存储记忆条数">📝 0</span>
    </div>
  </div>`;

  $('#extensions_settings2').append(panelHTML);
}

// ======================== Tab 导航绑定 ========================

function bindNavigation() {
  // 主 Tab
  $(document).on('click', '.cm-tab-btn', function () {
    const target = $(this).data('tab');
    $('.cm-tab-btn').removeClass('active');
    $(this).addClass('active');
    $('.cm-tab-pane').removeClass('active');
    $(`#cm-pane-${target}`).addClass('active');
  });

  // 子 Tab
  $(document).on('click', '.cm-sub-tab-btn', function () {
    const target = $(this).data('subtab');
    const parent = $(this).closest('.cm-tab-pane');
    parent.find('.cm-sub-tab-btn').removeClass('active');
    $(this).addClass('active');
    parent.find('.cm-sub-pane').removeClass('active');
    parent.find(`#cm-sub-${target}`).addClass('active');
  });
}

// ======================== 事件钩子 ========================

function registerEventHooks() {
  const s = getSettings();

  // 收到 AI 回复后 → 提取记忆
  eventSource.on(event_types.MESSAGE_RECEIVED, async (msgIndex) => {
    if (!s.enabled || !s.config.summary.enabled) return;

    s.currentTurnCount++;

    if (s.currentTurnCount % s.extractionInterval !== 0) {
      console.log(`${LOG_PREFIX} 第 ${s.currentTurnCount} 轮，跳过`);
      return;
    }

    console.log(`${LOG_PREFIX} ▶ 第 ${s.currentTurnCount} 轮，开始提取记忆...`);
    updateStatus('extracting', '正在提取记忆...');

    try {
      const context = getContext();
      const extracted = await extractMemory(context.chat, msgIndex);

      if (extracted) {
        // 添加摘要
        if (extracted.summary) {
          addChatLogEntry({
            turn: s.currentTurnCount,
            timestamp: new Date().toISOString(),
            summary: extracted.summary,
          });
        }

        // 应用提取的记忆
        applyExtractedMemory(extracted);

        console.log(`${LOG_PREFIX} ✓ 记忆提取完成`);
      }

      updateStatus('ok', '就绪');
    } catch (err) {
      console.error(`${LOG_PREFIX} ✗ 提取失败:`, err);
      updateStatus('error', `失败: ${err.message}`);
    }
  });

  // 发送前 → 注入记忆
  eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
    if (!s.enabled) return;

    try {
      const memoryBlock = buildMemoryInjection();
      if (memoryBlock && eventData.chat && Array.isArray(eventData.chat)) {
        // 在 system 消息后注入
        eventData.chat.splice(1, 0, {
          role: 'system',
          content: memoryBlock,
        });
        console.log(`${LOG_PREFIX} 已注入记忆到上下文`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} 注入失败:`, err);
    }
  });
}

// ======================== 主初始化 ========================

jQuery(async () => {
  console.log(`${LOG_PREFIX} 正在加载...`);

  // 初始化设置
  if (!extension_settings[EXT_NAME]) {
    extension_settings[EXT_NAME] = structuredClone(DEFAULT_SETTINGS);
  }
  // 合并缺失字段
  const s = extension_settings[EXT_NAME];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (s[key] === undefined) {
      s[key] = structuredClone(DEFAULT_SETTINGS[key]);
    }
  }

  // 渲染 UI
  renderMainPanel();
  bindNavigation();

  // 初始化各 Tab
  initCurrentTab();
  initChatLogTab();
  initStatusBarTab();
  initWorldViewTab();
  initSettingsTab();

  // 应用主题
  applyTheme(s.config.theme);
  if (s.config.customCSS) applyCustomCSS(s.config.customCSS);

  // 更新计数
  updateMemoryCount();

  // 注册事件
  registerEventHooks();

  console.log(`${LOG_PREFIX} 加载完成 ✓`);
});
