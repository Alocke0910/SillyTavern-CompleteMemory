/**
 * MemoryExtractor — 从对话中提取结构化记忆
 */

export class MemoryExtractor {
  constructor(settings, storage) {
    this.settings = settings;
    this.storage  = storage;
  }

  /**
   * 主提取方法：调用 API 将最近对话 → 结构化记忆 JSON
   * @param {Array} chat        完整聊天记录
   * @param {number} msgIndex   本次触发的消息索引
   * @param {object} settings   插件设置
   * @returns {object}          提取结果
   */
  async extract(chat, msgIndex, settings) {
    // 取最近 N 条消息作为上下文窗口
    const windowSize = 6;
    const start = Math.max(0, msgIndex - windowSize + 1);
    const recentMsgs = chat.slice(start, msgIndex + 1);

    // 组装对话文本
    const dialogText = recentMsgs.map(m => {
      const role = m.is_user ? 'User' : m.name || 'Character';
      return `[${role}]: ${m.mes}`;
    }).join('\n');

    // 准备已知状态（供 AI 参考，避免重复）
    const knownState = this._buildKnownStateContext(settings);

    // 构建提取请求的 system prompt
    const systemPrompt = settings.config.prompt.extractionSystemPrompt
      || this._getDefaultExtractionPrompt();

    const userPrompt = `
以下是最近的对话内容：
---
${dialogText}
---

当前已知状态（仅供参考，请只输出*变化*的部分）：
${knownState}

请根据上述对话，提取并返回以下 JSON 结构（只包含有变化的字段，无变化的字段省略）：
${this._getOutputSchema()}
`;

    // 调用 API
    const response = await this._callExtractionAPI(systemPrompt, userPrompt, settings);

    // 解析响应
    return this._parseResponse(response);
  }

  // ============ 私有方法 ============

  _getDefaultExtractionPrompt() {
    return `你是一个专业的叙事记忆提取器。你的任务是从角色扮演对话中提取关键信息，包括：
1. 当前状态变化（地点、时间、服装）
2. 对话摘要（一句话概括本轮发生了什么）
3. 物品变动（新增/转移/消失的物品）
4. 地点信息（新出现的地点，包含层级关系）
5. 人物信息（新出场或信息更新的角色）
6. 世界观更新（如果本轮揭示了新的世界设定）
7. 关系变动（角色间关系的变化）

请严格以 JSON 格式输出。只输出 JSON，不要有其他文字。`;
  }

  _getOutputSchema() {
    return `{
  "current": {
    "location": "string | null",
    "time": "string | null",
    "clothing": "string | null",
    "newTodo": "string | null",
    "completedTodo": "string | null"
  },
  "summary": "string — 本轮对话的一句话摘要",
  "statusChanges": {
    "items": [
      { "action": "add|update|remove", "name": "", "desc": "", "holder": "", "location": "" }
    ],
    "locations": [
      { "action": "add|update", "name": "", "desc": "", "parentName": "" }
    ],
    "characters": [
      { "action": "add|update", "name": "", "gender": "", "height": "", "weight": "",
        "appearance": "", "personality": "", "identity": "", "relationships": "" }
    ]
  },
  "worldViewUpdate": {
    "worldSetting": "string | null — 新增/修改的世界观内容",
    "userProfileUpdate": "string | null",
    "npcUpdates": [
      { "name": "", "update": "" }
    ],
    "relationshipChanges": [
      { "from": "", "to": "", "relation": "", "change": "" }
    ]
  }
}`;
  }

  _buildKnownStateContext(settings) {
    const s = settings;
    const parts = [];

    if (s.current.location)  parts.push(`地点: ${s.current.location}`);
    if (s.current.time)      parts.push(`时间: ${s.current.time}`);
    if (s.current.clothing)  parts.push(`服装: ${s.current.clothing}`);

    if (s.statusBar.characters.length > 0) {
      const names = s.statusBar.characters.map(c => c.name).join(', ');
      parts.push(`已知角色: ${names}`);
    }

    if (s.statusBar.locations.length > 0) {
      const locs = s.statusBar.locations.map(l => l.name).join(', ');
      parts.push(`已知地点: ${locs}`);
    }

    return parts.join('\n') || '（暂无已知状态）';
  }

  async _callExtractionAPI(systemPrompt, userPrompt, settings) {
    const summaryConfig = settings.config.summary;

    // 判断使用聊天API还是独立API
    if (summaryConfig.apiType === 'custom' && summaryConfig.customEndpoint) {
      return await this._callCustomAPI(
        summaryConfig.customEndpoint,
        summaryConfig.customApiKey,
        summaryConfig.customModel,
        systemPrompt,
        userPrompt
      );
    } else {
      // 使用酒馆内置 API
      return await this._callBuiltinAPI(systemPrompt, userPrompt);
    }
  }

  async _callCustomAPI(endpoint, apiKey, model, systemPrompt, userPrompt) {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '{}';
  }

  async _callBuiltinAPI(systemPrompt, userPrompt) {
    // 使用 SillyTavern 内置的 generateRaw 或类似函数
    try {
      const { generateRaw } = await import('../../../../script.js');
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const result = await generateRaw(combinedPrompt, null, false, false);
      return result || '{}';
    } catch (err) {
      console.error('[完全记忆] 内置API调用失败，尝试备用方案:', err);
      return '{}';
    }
  }

  _parseResponse(responseText) {
    try {
      // 尝试提取 JSON（兼容 markdown 代码块包裹）
      let jsonStr = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      return JSON.parse(jsonStr.trim());
    } catch (err) {
      console.warn('[完全记忆] JSON 解析失败，返回空结果:', err);
      return {};
    }
  }
}
