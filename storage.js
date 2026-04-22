/**
 * StorageManager — 统一管理插件数据的持久化存储
 */

import { saveSettingsDebounced } from '../../../../script.js';

export class StorageManager {
  constructor(extName, settings) {
    this.extName  = extName;
    this.settings = settings;
  }

  /** 保存设置（防抖） */
  save() {
    saveSettingsDebounced();
  }

  /** 获取当前聊天的存储 key */
  getChatKey() {
    try {
      const context = window.SillyTavern?.getContext?.() || {};
      return `${this.extName}_${context.chatId || 'default'}`;
    } catch {
      return `${this.extName}_default`;
    }
  }

  /** 导出全部记忆数据为 JSON */
  exportAll() {
    return JSON.stringify(this.settings, null, 2);
  }

  /** 导入记忆数据 */
  importAll(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      Object.assign(this.settings, data);
      this.save();
      return true;
    } catch (err) {
      console.error('[StorageManager] 导入失败:', err);
      return false;
    }
  }

  /** 清空指定模块的数据 */
  clearModule(moduleName) {
    const defaults = {
      current:   { location: '', time: '', clothing: '', todoList: [] },
      chatLog:   { entries: [], maxEntries: 500 },
      statusBar: { items: [], locations: [], characters: [] },
      worldView: { worldSetting: '', userProfile: {}, importantNPCs: [], relationshipData: {} },
    };
    if (defaults[moduleName]) {
      Object.assign(this.settings[moduleName], defaults[moduleName]);
      this.save();
    }
  }

  /** 重置所有数据 */
  resetAll() {
    // 保留 config，清空内容数据
    this.clearModule('current');
    this.clearModule('chatLog');
    this.clearModule('statusBar');
    this.clearModule('worldView');
    this.settings.currentTurnCount = 0;
    this.save();
  }
}
