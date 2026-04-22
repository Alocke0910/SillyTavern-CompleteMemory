/**
 * SummaryEngine — 独立 API 摘要引擎
 * 可使用与聊天不同的 API 进行摘要生成
 */

export class SummaryEngine {
  constructor(config) {
    this.config = config;
  }

  /** 生成单轮对话摘要 */
  async summarizeTurn(messages, customPrompt = '') {
    const prompt = customPrompt || `请用一句简洁的中文概括以下对话中发生的事件：\n\n${messages}`;

    if (this.config.apiType === 'custom') {
      return await this._callCustom(prompt);
    }
    return await this._callBuiltin(prompt);
  }

  /** 生成多轮压缩摘要（用于长对话压缩） */
  async compressSummaries(summaries) {
    const text = summaries.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const prompt = `以下是多轮对话的摘要记录，请将它们压缩为一段简洁的叙事摘要，保留所有关键信息：\n\n${text}`;

    if (this.config.apiType === 'custom') {
      return await this._callCustom(prompt);
    }
    return await this._callBuiltin(prompt);
  }

  /** 更新 API 配置 */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
  }

  /** 测试连接 */
  async testConnection() {
    try {
      const result = await this._callCustom('请回复"连接成功"四个字。');
      return { success: true, message: result };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ============ 私有方法 ============

  async _callCustom(prompt) {
    const response = await fetch(`${this.config.customEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.customApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.customModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async _callBuiltin(prompt) {
    try {
      const { generateRaw } = await import('../../../../script.js');
      return await generateRaw(prompt, null, false, false) || '';
    } catch {
      return '';
    }
  }
}
