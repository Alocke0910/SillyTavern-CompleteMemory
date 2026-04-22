/**
 * VectorMemory — 向量化存储与检索
 * 支持 OpenAI / 本地模型 / 自定义 Endpoint
 */

export class VectorMemory {
  constructor(config) {
    this.config = config;
    this.index  = [];   // 简易内存索引: [{ id, content, embedding, turn, timestamp }]
  }

  /** 存储：将提取的记忆向量化并加入索引 */
  async store(extractedMemory, turnNumber) {
    if (!this.config.enabled) return;

    const content = this._memoryToText(extractedMemory);
    if (!content) return;

    try {
      const embedding = await this._getEmbedding(content);
      this.index.push({
        id:        `mem_${turnNumber}_${Date.now()}`,
        content:   content,
        embedding: embedding,
        turn:      turnNumber,
        timestamp: new Date().toISOString(),
      });
      console.log(`[向量记忆] 已索引第 ${turnNumber} 轮记忆，当前索引总数: ${this.index.length}`);
    } catch (err) {
      console.error('[向量记忆] 向量化失败:', err);
    }
  }

  /** 检索：根据查询文本召回最相关的记忆片段 */
  async recall(queryText, topK = 5) {
    if (!this.config.enabled || this.index.length === 0) return [];

    try {
      const queryEmbedding = await this._getEmbedding(queryText);

      // 计算余弦相似度并排序
      const scored = this.index.map(item => ({
        ...item,
        score: this._cosineSimilarity(queryEmbedding, item.embedding),
      }));

      scored.sort((a, b) => b.score - a.score);

      // 过滤低于阈值的，取 topK
      const threshold = this.config.similarityThreshold || 0.75;
      return scored
        .filter(s => s.score >= threshold)
        .slice(0, topK);

    } catch (err) {
      console.error('[向量记忆] 检索失败:', err);
      return [];
    }
  }

  /** 获取索引数量 */
  getIndexCount() {
    return this.index.length;
  }

  /** 重建索引 */
  async rebuildIndex(allEntries) {
    this.index = [];
    for (const entry of allEntries) {
      try {
        const embedding = await this._getEmbedding(entry.content || entry.summary);
        this.index.push({
          id:        entry.id || `rebuild_${Date.now()}`,
          content:   entry.content || entry.summary,
          embedding: embedding,
          turn:      entry.turn || 0,
          timestamp: entry.timestamp || new Date().toISOString(),
        });
      } catch (err) {
        console.warn('[向量记忆] 重建索引跳过一条:', err);
      }
    }
    return this.index.length;
  }

  // ============ 私有方法 ============

  async _getEmbedding(text) {
    const endpoint = this.config.endpoint || 'https://api.openai.com/v1/embeddings';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'text-embedding-3-small',
        input: text,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.data?.[0]?.embedding || [];
  }

  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
  }

  _memoryToText(extracted) {
    const parts = [];
    if (extracted.summary) parts.push(extracted.summary);
    if (extracted.current?.location) parts.push(`地点: ${extracted.current.location}`);
    if (extracted.statusChanges?.characters) {
      extracted.statusChanges.characters.forEach(c => {
        parts.push(`人物: ${c.name} - ${c.identity || ''}`);
      });
    }
    return parts.join(' | ');
  }
}
