/**
 * PromptBuilder — 将记忆状态格式化为注入 AI 的提示词
 */

export class PromptBuilder {
  constructor(settings) {
    this.settings = settings;
  }

  /**
   * 构建完整的记忆注入块
   */
  build(settings) {
    const s = settings;
    const template = s.config.prompt.injectionTemplate || this._getDefaultTemplate();

    // 替换变量
    let result = template;
    result = result.replace('{{current}}',      this._buildCurrentBlock(s));
    result = result.replace('{{status}}',        this._buildStatusBlock(s));
    result = result.replace('{{world}}',         this._buildWorldBlock(s));
    result = result.replace('{{recent_logs}}',   this._buildRecentLogs(s));

    return result;
  }

  /**
   * 构建向量召回块
   */
  buildVectorRecall(recalledItems) {
    if (!recalledItems || recalledItems.length === 0) return '';

    let block = '【相关历史记忆（向量召回）】\n';
    recalledItems.forEach((item, i) => {
      block += `[记忆 #${i + 1} | 相似度: ${(item.score * 100).toFixed(1)}%]\n`;
      block += `${item.content}\n\n`;
    });
    return block;
  }

  // ============ 私有方法 ============

  _getDefaultTemplate() {
    return `[记忆系统 — 完全记忆]

【当前状态】
{{current}}

【近期事件摘要】
{{recent_logs}}

【世界与角色信息】
{{status}}
{{world}}

[/记忆系统]`;
  }

  _buildCurrentBlock(s) {
    const lines = [];
    if (s.current.location) lines.push(`📍 地点: ${s.current.location}`);
    if (s.current.time)     lines.push(`🕐 时间: ${s.current.time}`);
    if (s.current.clothing) lines.push(`👔 服装: ${s.current.clothing}`);
    if (s.current.todoList?.length > 0) {
      lines.push(`📋 待办: ${s.current.todoList.map(t => t.text).join(' | ')}`);
    }
    return lines.join('\n') || '（暂无）';
  }

  _buildStatusBlock(s) {
    const parts = [];

    // 人物
    if (s.statusBar.characters.length > 0) {
      parts.push('【已知人物】');
      s.statusBar.characters.forEach(c => {
        parts.push(`• ${c.name} — ${c.identity || '未知身份'}`);
      });
    }

    // 物品
    if (s.statusBar.items.length > 0) {
      parts.push('\n【持有物品】');
      s.statusBar.items.forEach(item => {
        parts.push(`• ${item.name}: ${item.desc || ''} [持有: ${item.holder || '未知'}]`);
      });
    }

    return parts.join('\n') || '';
  }

  _buildWorldBlock(s) {
    return s.worldView.worldSetting || '';
  }

  _buildRecentLogs(s, count = 10) {
    const entries = s.chatLog.entries.slice(-count);
    if (entries.length === 0) return '（暂无记录）';
    return entries.map(e => `[#${e.turn}] ${e.summary}`).join('\n');
  }
}
