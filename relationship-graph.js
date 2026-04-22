/**
 * RelationshipGraph — 以 User 为中心的角色关系网可视化
 * 使用 Canvas 绘制力导向图
 */

export class RelationshipGraph {
  constructor(containerId) {
    this.containerId = containerId;
    this.nodes = [];  // { id, name, type: 'user'|'npc', x, y, vx, vy }
    this.edges = [];  // { from, to, label, strength }
    this.canvas = null;
    this.ctx = null;
    this.animationId = null;
  }

  /** 初始化画布 */
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.width  = container.clientWidth  || 600;
    this.canvas.height = container.clientHeight || 400;
    this.canvas.className = 'cm-rel-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // 启用拖拽交互
    this._bindInteractions();
  }

  /** 从角色数据构建图 */
  buildFromData(characters, relationshipData, userName = 'User') {
    this.nodes = [];
    this.edges = [];

    // 添加 User 为中心节点
    this.nodes.push({
      id: 'user', name: userName, type: 'user',
      x: this.canvas.width / 2,
      y: this.canvas.height / 2,
      vx: 0, vy: 0, fixed: true,
    });

    // 添加角色节点
    characters.forEach((char, i) => {
      const angle = (2 * Math.PI * i) / characters.length;
      const radius = 150;
      this.nodes.push({
        id: char.id || char.name,
        name: char.name,
        type: 'npc',
        x: this.canvas.width / 2 + Math.cos(angle) * radius,
        y: this.canvas.height / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0, fixed: false,
      });
    });

    // 添加关系边
    if (relationshipData?.edges) {
      relationshipData.edges.forEach(edge => {
        this.edges.push({
          from: edge.from,
          to: edge.to,
          label: edge.relation || '',
          strength: edge.strength || 1,
        });
      });
    }

    // 开始力导向模拟
    this._startSimulation();
  }

  /** 绘制 */
  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 绘制边
    this.edges.forEach(edge => {
      const fromNode = this.nodes.find(n => n.id === edge.from);
      const toNode   = this.nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.strokeStyle = 'rgba(150, 150, 255, 0.6)';
      ctx.lineWidth = edge.strength || 1;
      ctx.stroke();

      // 关系标签
      if (edge.label) {
        const midX = (fromNode.x + toNode.x) / 2;
        const midY = (fromNode.y + toNode.y) / 2;
        ctx.fillStyle = '#aaa';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(edge.label, midX, midY - 5);
      }
    });

    // 绘制节点
    this.nodes.forEach(node => {
      const radius = node.type === 'user' ? 20 : 14;
      const color  = node.type === 'user' ? '#FF6B6B' : '#4ECDC4';

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 名字
      ctx.fillStyle = '#fff';
      ctx.font = node.type === 'user' ? 'bold 13px sans-serif' : '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.name, node.x, node.y + radius + 16);
    });
  }

  // ============ 私有方法（力导向模拟） ============

  _startSimulation() {
    let iteration = 0;
    const maxIterations = 300;

    const step = () => {
      if (iteration >= maxIterations) {
        this.render();
        return;
      }
      this._simulateStep();
      this.render();
      iteration++;
      this.animationId = requestAnimationFrame(step);
    };

    step();
  }

  _simulateStep() {
    const repulsion = 5000;
    const attraction = 0.01;
    const damping = 0.9;

    // 斥力（节点间）
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
        if (!b.fixed) { b.vx += fx; b.vy += fy; }
      }
    }

    // 引力（连接边）
    this.edges.forEach(edge => {
      const a = this.nodes.find(n => n.id === edge.from);
      const b = this.nodes.find(n => n.id === edge.to);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const fx = dx * attraction;
      const fy = dy * attraction;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    });

    // 应用速度
    this.nodes.forEach(node => {
      if (node.fixed) return;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
      // 边界约束
      node.x = Math.max(30, Math.min(this.canvas.width - 30, node.x));
      node.y = Math.max(30, Math.min(this.canvas.height - 30, node.y));
    });
  }

  _bindInteractions() {
    // 简易拖拽支持
    let dragging = null;
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      dragging = this.nodes.find(n => {
        const dx = n.x - mx, dy = n.y - my;
        return Math.sqrt(dx * dx + dy * dy) < 20;
      });
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = this.canvas.getBoundingClientRect();
      dragging.x = e.clientX - rect.left;
      dragging.y = e.clientY - rect.top;
      this.render();
    });
    this.canvas.addEventListener('mouseup', () => { dragging = null; });
  }
}
