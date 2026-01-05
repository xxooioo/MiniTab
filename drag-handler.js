// 独立的拖拽处理模块
class DragHandler {
  constructor() {
    this.draggedIndex = null;
    this.draggedElement = null;
    this.draggedElements = [];
    this.placeholder = null;
    this.dropTarget = null;
    this.lastMoveIndex = null; // 记录上次移动到的位置
    this.lastHighlightedElement = null; // 记录上次高亮的元素
    this.draggedShortcuts = [];
    this.draggedIds = [];
    this.isMultiDrag = false;
    this.multiAllNonFolder = false;
  }

  // 初始化拖拽
  handleDragStart(e, index, shortcuts, selectedIds = null) {
    this.draggedIndex = index;
    this.draggedElement = e.currentTarget;
    this.draggedElements = [];
    
    // 保存被拖拽对象的引用（而不是索引）
    this.draggedShortcut = shortcuts[index];
    this.draggedShortcuts = [];
    this.draggedIds = [];
    this.isMultiDrag = false;
    this.multiAllNonFolder = false;

    if (selectedIds && selectedIds.length > 1) {
      this.isMultiDrag = true;
      this.draggedIds = selectedIds.slice();
      this.draggedShortcuts = shortcuts.filter(s => this.draggedIds.includes(s._id));
      this.multiAllNonFolder = this.draggedShortcuts.every(s => s.type !== 'folder');
      this.draggedElements = this.draggedIds
        .map(id => document.querySelector(`.shortcut-item[data-shortcut-id="${id}"]`))
        .filter(Boolean);
    } else {
      this.draggedShortcuts = [this.draggedShortcut];
      this.draggedIds = [this.draggedShortcut?._id].filter(Boolean);
      this.draggedElements = [this.draggedElement].filter(Boolean);
    }
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
    
    // 创建自定义拖拽图像（只显示图标）
    this.createDragImage(e, this.isMultiDrag ? this.draggedIds.length : 1);
    
    // 使用 setTimeout 延迟添加 dragging 类
    setTimeout(() => {
      this.draggedElements.forEach((el) => {
        el.classList.add('dragging');
      });
    }, 0);
  }

  // 创建拖拽图像
  createDragImage(e, count = 1) {
    try {
      const ghost = document.createElement('div');
      const iconElement = e.currentTarget.querySelector('.shortcut-icon, .folder-icon');
      
      if (iconElement) {
        const iconClone = iconElement.cloneNode(true);
        ghost.appendChild(iconClone);
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.width = '56px';
        ghost.style.height = '56px';
        ghost.style.opacity = '0.95';
        ghost.style.transform = 'scale(1.12)';
        ghost.style.filter = 'drop-shadow(0 8px 16px rgba(0,0,0,0.25))';
        ghost.style.pointerEvents = 'none';
        if (count > 1) {
          const badge = document.createElement('div');
          badge.textContent = count.toString();
          badge.style.position = 'absolute';
          badge.style.right = '-6px';
          badge.style.top = '-6px';
          badge.style.background = 'rgba(0,0,0,0.7)';
          badge.style.color = '#fff';
          badge.style.fontSize = '12px';
          badge.style.fontWeight = 'bold';
          badge.style.padding = '2px 6px';
          badge.style.borderRadius = '999px';
          badge.style.pointerEvents = 'none';
          ghost.appendChild(badge);
        }
        document.body.appendChild(ghost);
        
        e.dataTransfer.setDragImage(ghost, 28, 28);
        
        setTimeout(() => {
          if (ghost.parentNode) {
            document.body.removeChild(ghost);
          }
        }, 0);
      }
    } catch (err) {
      console.log('Custom drag image failed:', err);
    }
  }

  // 拖拽经过
  handleDragOver(e, index, shortcuts, container) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (this.draggedIndex === null || this.draggedIndex === index) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    const draggedShortcut = this.isMultiDrag ? { type: this.multiAllNonFolder ? 'item' : 'folder' } : shortcuts[this.draggedIndex];
    const targetShortcut = shortcuts[index];
    
    // 只清除上次的高亮元素（如果有的话）
    if (this.lastHighlightedElement && this.lastHighlightedElement !== e.currentTarget) {
      this.lastHighlightedElement.classList.remove('drag-over-create');
    }
    
    // 判断拖拽到分组上 - 使用更大的判定区域，提高流畅度
    if (targetShortcut.type === 'folder' && draggedShortcut.type !== 'folder') {
      // 计算元素中心位置
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distX = Math.abs(mouseX - centerX);
      const distY = Math.abs(mouseY - centerY);
      
      // 多选拖拽缩小中心判定，避免误触发分组逻辑
      const thresholdScale = this.isMultiDrag ? 0.25 : 0.5;
      const thresholdX = rect.width * thresholdScale;
      const thresholdY = rect.height * thresholdScale;
      
      if (distX < thresholdX && distY < thresholdY) {
        e.currentTarget.classList.add('drag-over-create');
        this.lastHighlightedElement = e.currentTarget;
        // 保存目标对象的引用
        this.dropTarget = { 
          index, 
          action: 'addToFolder',
          targetShortcut: targetShortcut  // 保存目标对象引用
        };
        return;
      }
    }
    
    // 判断是否在普通图标中心（创建分组）- 使用更大的判定区域
    if (draggedShortcut.type !== 'folder' && targetShortcut.type !== 'folder') {
      // 计算元素中心位置
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distX = Math.abs(mouseX - centerX);
      const distY = Math.abs(mouseY - centerY);
      
      // 多选拖拽缩小中心判定，避免误触发分组逻辑
      const thresholdScale = this.isMultiDrag ? 0.25 : 0.45;
      const thresholdX = rect.width * thresholdScale;
      const thresholdY = rect.height * thresholdScale;
      
      if (distX < thresholdX && distY < thresholdY) {
        e.currentTarget.classList.add('drag-over-create');
        this.lastHighlightedElement = e.currentTarget;
        // 保存目标对象的引用
        this.dropTarget = { 
          index, 
          action: 'createFolder',
          targetShortcut: targetShortcut  // 保存目标对象引用
        };
        return;
      }
    }
    
    if (this.isMultiDrag) {
      this.dropTarget = { index, action: 'reorder' };
      return;
    }

    // 其他区域 - 移动位置
    // 使用和分组内一样的逻辑：直接根据鼠标位置移动，简单高效
    
    const targetElement = e.currentTarget;
    if (!targetElement || targetElement === this.draggedElement) return;
    
    const children = Array.from(container.children);
    
    // 获取当前实际位置
    const currentIndex = children.indexOf(this.draggedElement);
    const actualTargetIndex = children.indexOf(targetElement);
    
    if (currentIndex === -1 || actualTargetIndex === -1) return;
    if (currentIndex === actualTargetIndex) return;
    
    // 判断是横向还是纵向网格
    const isHorizontalGrid = rect.width > rect.height || 
                             (actualTargetIndex > 0 && children[actualTargetIndex - 1] && 
                              children[actualTargetIndex - 1].getBoundingClientRect().top === rect.top);
    
    let insertBefore;
    if (isHorizontalGrid) {
      // 横向网格：使用X坐标判断
      const targetCenterX = rect.left + rect.width / 2;
      insertBefore = mouseX < targetCenterX;
    } else {
      // 纵向网格：使用Y坐标判断
      const targetCenterY = rect.top + rect.height / 2;
      insertBefore = mouseY < targetCenterY;
    }
    
    // 计算目标位置
    let targetPosition;
    if (insertBefore) {
      targetPosition = actualTargetIndex;
    } else {
      targetPosition = actualTargetIndex + 1;
    }
    
    // 调整目标位置（如果拖拽元素在前面，目标位置需要-1）
    if (currentIndex < targetPosition) {
      targetPosition--;
    }
    
    // 如果位置没变，不执行移动
    if (currentIndex === targetPosition) {
      this.dropTarget = { index: this.draggedIndex, action: 'reorder' };
      return;
    }
    
    // 防止过于频繁的移动
    if (this.lastMoveIndex === targetPosition) {
      this.dropTarget = { index: this.draggedIndex, action: 'reorder' };
      return;
    }
    this.lastMoveIndex = targetPosition;
    
    // 执行DOM移动
    if (insertBefore) {
      container.insertBefore(this.draggedElement, targetElement);
    } else {
      const nextElement = targetElement.nextSibling;
      if (nextElement && nextElement !== this.draggedElement) {
        container.insertBefore(this.draggedElement, nextElement);
      } else if (!nextElement) {
        container.appendChild(this.draggedElement);
      }
    }
    
    // 更新索引
    this.draggedIndex = targetPosition;
    this.dropTarget = { index: this.draggedIndex, action: 'reorder' };
  }

  // 拖拽离开
  handleDragLeave(e) {
    const element = e.currentTarget;
    element.classList.remove('drag-over-create');
    
    // 如果离开的是上次高亮的元素，清除引用
    if (this.lastHighlightedElement === element) {
      this.lastHighlightedElement = null;
    }
  }

  // 放置
  handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 🔑 关键修复：在 drop 时重新判断最终位置的 action
    // 这样可以避免拖动过程中经过其他元素时误判
    const finalDropTarget = this.getFinalDropTarget(e);
    
    // 清除所有高亮
    document.querySelectorAll('.drag-over-create').forEach(el => {
      el.classList.remove('drag-over-create');
    });
    
    // 重置高亮引用
    this.lastHighlightedElement = null;
    
    return {
      draggedIndex: this.draggedIndex,
      draggedShortcut: this.draggedShortcut,  // 返回拖拽对象的引用
      draggedShortcuts: this.draggedShortcuts,
      draggedIds: this.draggedIds,
      isMultiDrag: this.isMultiDrag,
      dropTarget: finalDropTarget || this.dropTarget  // 使用最终判定的 action
    };
  }
  
  // 获取最终 drop 位置的正确 action
  getFinalDropTarget(e) {
    // 找到鼠标下方的元素
    const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementUnderMouse) return null;
    
    // 找到最近的 shortcut-item
    const targetElement = elementUnderMouse.closest('.shortcut-item');
    if (!targetElement || targetElement === this.draggedElement) return null;
    
    // 获取目标索引
    const targetIndex = parseInt(targetElement.dataset.index);
    if (isNaN(targetIndex)) return null;
    
    // 从 DOM 中获取 shortcuts 数组（通过 State）
    const shortcuts = window.State?.shortcuts;
    if (!shortcuts || !shortcuts[targetIndex]) return null;
    
    const draggedShortcut = this.isMultiDrag ? { type: this.multiAllNonFolder ? 'item' : 'folder' } : this.draggedShortcut;
    const targetShortcut = shortcuts[targetIndex];
    
    // 计算鼠标相对于目标元素的位置
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distX = Math.abs(e.clientX - centerX);
    const distY = Math.abs(e.clientY - centerY);
    
    // 判断是否在中心区域（用于 addToFolder 或 createFolder）
    const thresholdScale = this.isMultiDrag ? 0.25 : 0.45;
    const thresholdX = rect.width * thresholdScale;
    const thresholdY = rect.height * thresholdScale;
    const inCenterArea = distX < thresholdX && distY < thresholdY;
    
    // 优先判断：拖到分组上 -> 添加到分组
    if (inCenterArea && targetShortcut.type === 'folder' && draggedShortcut.type !== 'folder') {
      return {
        index: targetIndex,
        action: 'addToFolder',
        targetShortcut: targetShortcut
      };
    }
    
    // 其次判断：拖到普通图标上 -> 创建新分组
    if (inCenterArea && targetShortcut.type !== 'folder' && draggedShortcut.type !== 'folder') {
      return {
        index: targetIndex,
        action: 'createFolder',
        targetShortcut: targetShortcut
      };
    }
    
    const container = targetElement.parentElement;
    const children = container ? Array.from(container.children) : [];
    const actualTargetIndex = children.indexOf(targetElement);
    const isHorizontalGrid = rect.width > rect.height ||
      (actualTargetIndex > 0 && children[actualTargetIndex - 1] &&
        children[actualTargetIndex - 1].getBoundingClientRect().top === rect.top);
    const insertBefore = isHorizontalGrid
      ? e.clientX < centerX
      : e.clientY < centerY;
    return {
      index: targetIndex,
      action: 'reorder',
      insertBefore
    };
  }

  // 拖拽结束
  handleDragEnd() {
    // 立即移除 dragging 类，避免任何视觉闪烁
    this.draggedElements.forEach((el) => {
      el.classList.remove('dragging');
      el.offsetHeight;
    });
    
    // 清除上次高亮的元素
    if (this.lastHighlightedElement) {
      this.lastHighlightedElement.classList.remove('drag-over-create');
      // 强制浏览器重绘，确保动画停止
      this.lastHighlightedElement.offsetHeight;
    }
    
    // 清理所有拖拽相关的类（防御性清理）
    document.querySelectorAll('.drag-over-create, .dragging').forEach(el => {
      el.classList.remove('drag-over-create', 'dragging');
      // 强制每个元素重绘
      el.offsetHeight;
    });
    
    // 使用setTimeout确保所有清理操作完成后再重置状态
    setTimeout(() => {
      // 重置状态
      this.draggedIndex = null;
      this.draggedElement = null;
      this.draggedElements = [];
      this.dropTarget = null;
      this.lastMoveIndex = null;
      this.lastHighlightedElement = null;
      this.draggedShortcuts = [];
      this.draggedIds = [];
      this.isMultiDrag = false;
      this.multiAllNonFolder = false;
    }, 0);
  }

  // 获取当前拖拽索引
  getDraggedIndex() {
    return this.draggedIndex;
  }
}
