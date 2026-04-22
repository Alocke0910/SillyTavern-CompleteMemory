/**
 * MapGenerator — 根据地点层级数据自动生成可视化地图
 */

export class MapGenerator {
  constructor(containerId) {
    this.containerId = containerId;
    this.canvas = null;
    this.ctx = null;
  }

  /** 初始化画布 */
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.width  = container.clientWidth  || 600;
    this.canvas.height = container.clientHeight || 400;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * 从地点数据生成地图
   * @param {Array} locations   地点列表（含层级关系）
   * @param {string} currentLoc 当前所在地点名
   */
  generate(locations, currentLoc = '') {
    if (!this.ctx) this.init();
    if (!this.ctx) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 构建树形结构
    const tree = this._buildTree(locations);

    // 递归绘制
    this._drawTree(ctx, tree, this.canvas.width / 2, 40, 0, currentLoc);
  }

  _buildTree(locations) {
    const map = {};
    const roots = [];
    locations.forEach(loc => {
      map[loc.id] = { ...loc, children: [] };
    });
    locations.forEach(loc => {
      if (loc.parentId && map[loc.parentId]) {
        map[loc.parentId].children.push(map[loc.id]);
      } else {
        roots.push(map[loc.id]);
      }
    });
    return roots;
  }

  _drawTree(ctx, nodes, startX, startY, depth, currentLoc) {
    const spacingX = Math.max(120, 400 / (nodes.length || 1));
    const spacingY = 80;
    const totalWidth = spacingX * nodes.length;
    const offsetX = startX - totalWidth / 2 + spacingX / 2;

    nodes.forEach((node, i) => {
      const x = offsetX + i * spacingX;
      const y = startY + depth * spacingY;

      // 连线到父级
      if (depth > 0) {
        ctx.beginPath();
        ctx.moveTo(startX, y - spacingY + 20);
        ctx.lineTo(x, y - 10);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 节点
      const isCurrent = node.name === currentLoc;
      const boxW = 100, boxH = 30;
      ctx.fillStyle = isCurrent ? '#FF6B6B' : '#2a2a4a';
      ctx.strokeStyle = isCurrent ? '#FF6B6B' : '#666';
      ctx.lineWidth = isCurrent ? 2.5 : 1;
      this._roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 8);

      ctx.fillStyle = '#fff';
      ctx.font = isCurrent ? 'bold 12px sans-serif' : '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.name, x, y);

      // 递归子节点
      if (node.children.length > 0) {
        this._drawTree(ctx, node.children, x, startY, depth + 1, currentLoc);
      }
    });
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
