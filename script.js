// ==================== 配置 ====================
const CONFIG = {
  debug: false, // 生产环境设置为 false
  defaultShortcuts: [
    { name: 'Google', url: 'https://www.google.com', icon: '' },
    { name: 'YouTube', url: 'https://www.youtube.com', icon: '' },
    { name: 'GitHub', url: 'https://github.com', icon: '' },
    { name: '百度', url: 'https://www.baidu.com', icon: '' },
    { name: '知乎', url: 'https://www.zhihu.com', icon: '' },
    { name: 'B站', url: 'https://www.bilibili.com', icon: '' }
  ],
  searchEngines: {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    baidu: 'https://www.baidu.com/s?wd='
  },
  defaultSettings: {
    searchEngine: 'google',
    searchOpacity: 5,
    autoHideControls: false, // 默认不自动隐藏
    gridColumns: 12 // 默认每行12个图标
  }
};

const ICON_FALLBACK_TIMEOUT_MS = 2500;

const ALLOWED_SHORTCUT_PROTOCOLS = new Set([
  'http:',
  'https:',
  'chrome:',
  'chrome-extension:',
  'file:',
  'ftp:',
  'mailto:'
]);

function normalizeShortcutUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_SHORTCUT_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// ==================== 调试日志 ====================
const Logger = {
  debug: (...args) => {
    if (CONFIG.debug) {
      console.log('[DEBUG]', ...args);  // ✅ 修复：使用 console.log
    }
  },
  warn: (...args) => {
    if (CONFIG.debug) {
      console.warn('[WARN]', ...args);  // ✅ 修复：使用 console.warn
    }
  },
  error: (...args) => {
    // 错误日志始终显示
    console.error('[ERROR]', ...args);  // ✅ 修复：使用 console.error
  }
};

// ==================== 全局错误处理 ====================
// ✅ 添加全局错误捕获，记录错误日志
window.addEventListener('error', (event) => {
  Logger.error('Global error:', event.error || event.message, 'at', event.filename, 'line', event.lineno);
});

window.addEventListener('unhandledrejection', (event) => {
  Logger.error('Unhandled promise rejection:', event.reason);
});

// ==================== 状态管理 ====================
const State = {
  currentEngine: CONFIG.defaultSettings.searchEngine,
  customEngineUrl: '', // 自定义搜索引擎URL
  tabs: [],
  currentTabId: null,
  shortcuts: [],
  editingIndex: -1, // -1表示添加模式，>=0表示编辑模式
  editingTabId: null, // 用于标签页编辑模式
  editingFolderItemIndex: -1, // 用于编辑分组内的快捷方式
  undoData: null, // 用于存储撤回数据
  undoTimeout: null, // 撤回提示的定时器
  countdownInterval: null, // 倒计时interval
  draggedItem: null, // 拖拽的元素
  dropTarget: null, // 放置目标
  lastFolderMovePosition: null, // 记录上次文件夹移动位置，防止重复触发
  draggingTab: false // 是否正在拖拽标签页
};

// 将 State 暴露到全局作用域，供 drag-handler.js 使用
window.State = State;

// 拖拽处理器实例
const dragHandler = new DragHandler();

// ==================== 资源清理管理器 ====================
class CleanupManager {
  constructor() {
    this.timers = new Set();
    
    // 页面卸载时清理所有资源
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }
  
  setTimeout(callback, delay) {
    const id = setTimeout(() => {
      callback();
      this.timers.delete(id);
    }, delay);
    this.timers.add(id);
    return id;
  }
  
  setInterval(callback, delay) {
    const id = setInterval(callback, delay);
    this.timers.add(id);
    return id;
  }
  
  clearTimer(id) {
    clearTimeout(id);
    clearInterval(id);
    this.timers.delete(id);
  }
  
  cleanup() {
    this.timers.forEach(id => {
      clearTimeout(id);
      clearInterval(id);
    });
    this.timers.clear();
    Logger.debug('Cleaned up', this.timers.size, 'timers');
  }
}

const cleanupManager = new CleanupManager();

// ==================== 数据校验 ====================
const Validator = {
  // 校验标签页数据结构
  isValidTab(tab) {
    return tab &&
           typeof tab.id === 'string' &&
           typeof tab.name === 'string' &&
           Array.isArray(tab.shortcuts);
  },
  
  // 校验快捷方式数据结构
  isValidShortcut(shortcut) {
    if (!shortcut) return false;
    
    // 分组类型
    if (shortcut.type === 'folder') {
      return typeof shortcut.name === 'string' &&
             Array.isArray(shortcut.items) &&
             shortcut.items.every(item => this.isValidShortcut(item));
    }
    
    // 普通快捷方式
    return typeof shortcut.name === 'string' &&
           typeof shortcut.url === 'string' &&
           normalizeShortcutUrl(shortcut.url) !== null;
  },
  
  // 清理无效数据
  sanitizeTabs(tabs) {
    if (!Array.isArray(tabs)) return [];
    return tabs
      .filter(tab => this.isValidTab(tab))
      .map(tab => ({
        ...tab,
        shortcuts: this.sanitizeShortcuts(tab.shortcuts)
      }));
  },
  
  sanitizeShortcuts(shortcuts) {
    if (!Array.isArray(shortcuts)) return [];
    return shortcuts.filter(shortcut => this.isValidShortcut(shortcut));
  }
};

// ==================== 统一提示系统 ====================
class ToastManager {
  constructor() {
    this.toasts = [];
  }
  
  // 显示提示
  show(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // 根据类型选择图标和样式
    const styles = {
      success: {
        icon: '✓',
        background: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(52, 211, 153, 0.5)',
        iconColor: '#34d399',
        shadowColor: 'rgba(52, 211, 153, 0.2)'
      },
      error: {
        icon: '✕',
        background: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(248, 113, 113, 0.5)',
        iconColor: '#f87171',
        shadowColor: 'rgba(248, 113, 113, 0.2)'
      },
      warning: {
        icon: '⚠',
        background: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(251, 191, 36, 0.5)',
        iconColor: '#fbbf24',
        shadowColor: 'rgba(251, 191, 36, 0.2)'
      },
      info: {
        icon: 'ℹ',
        background: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(96, 165, 250, 0.5)',
        iconColor: '#60a5fa',
        shadowColor: 'rgba(96, 165, 250, 0.2)'
      }
    };
    
    const style = styles[type] || styles.info;
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = style.icon;
    iconSpan.style.color = style.iconColor;
    iconSpan.style.fontWeight = 'bold';
    iconSpan.style.fontSize = '16px';

    const messageSpan = document.createElement('span');
    messageSpan.className = 'toast-message';
    messageSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(messageSpan);
    
    toast.style.cssText = `
      position: fixed;
      top: ${80 + this.toasts.length * 70}px;
      left: 50%;
      transform: translateX(-50%);
      background: ${style.background};
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid ${style.borderColor};
      color: white;
      padding: 14px 24px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 8px 32px ${style.shadowColor}, 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
      width: auto;
      white-space: nowrap;
    `;
    
    document.body.appendChild(toast);
    
    // 添加到数组
    this.toasts.push(toast);
    
    // 触发动画
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    
    // 自动移除
    setTimeout(() => {
      this.remove(toast);
    }, duration);
    
    return toast;
  }
  
  // 移除提示
  remove(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
      
      // 从数组中移除
      const index = this.toasts.indexOf(toast);
      if (index > -1) {
        this.toasts.splice(index, 1);
      }
      
      // 重新排列剩余的 toast
      this.toasts.forEach((t, i) => {
        t.style.top = `${80 + i * 70}px`;
      });
    }, 300);
  }
  
  // 快捷方法
  success(message, duration) {
    return this.show(message, 'success', duration);
  }
  
  error(message, duration) {
    return this.show(message, 'error', duration);
  }
  
  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }
  
  info(message, duration) {
    return this.show(message, 'info', duration);
  }
}

// 创建全局实例
const Toast = new ToastManager();

// ==================== 工具函数 ====================
const Utils = {
  // 尝试从 URL 获取图标（通过常见路径）
  async getIconFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const origin = urlObj.origin;
      
      // 返回最常见的 favicon 路径，让浏览器尝试加载
      // 如果不存在，渲染时的 onerror 处理会回退到 Google API
      return new URL('/favicon.ico', origin).href;
    } catch (error) {
      Logger.debug('从 URL 获取图标失败:', error);
    }
    return null;
  },

  // 获取 Favicon URL（优先使用浏览器缓存）
  getFaviconUrl(url) {
    try {
      const pageUrl = new URL(url).href;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL &&
          typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
        const base = chrome.runtime.getURL('_favicon/');
        return `${base}?pageUrl=${encodeURIComponent(pageUrl)}&size=128`;
      }
      return `chrome://favicon2/?size=128&scale=1&pageUrl=${encodeURIComponent(pageUrl)}`;
    } catch {
      return Utils.getDefaultIconData();
    }
  },

  // 获取 Favicon URL（外网兜底）
  getGoogleFaviconUrl(url) {
    try {
      const domain = new URL(url).origin;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    } catch {
      return null;
    }
  },

  // 默认占位图标（SVG）
  getDefaultIconData() {
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ffffff"><circle cx="12" cy="12" r="10"/></svg>';
  },

  // 生成文字图标（SVG）
  generateTextIcon(text, customColor = null) {
    if (!text || text.trim().length === 0) {
      return null;
    }
    
    // 限制1-3个字符
    const displayText = text.trim().substring(0, 3).toUpperCase();
    
    // 根据文本生成一个确定的颜色
    const colors = [
      '#667eea', // 蓝紫
      '#764ba2', // 深紫
      '#f093fb', // 粉紫
      '#4facfe', // 天蓝
      '#00f2fe', // 青色
      '#43e97b', // 薄荷绿
      '#38f9d7', // 青绿
      '#fa709a', // 粉红
      '#fee140', // 金黄
      '#30cfd0', // 青蓝
      '#a8edea', // 浅青
      '#ff6a00', // 橙色
      '#ee0979', // 玫红
      '#a770ef', // 紫色
      '#fda085'  // 橘粉
    ];
    
    // 确定背景颜色：优先使用自定义颜色，否则根据文本计算
    let backgroundColor;
    if (customColor) {
      backgroundColor = customColor;
    } else {
      // 根据文本内容计算颜色索引
      let hash = 0;
      for (let i = 0; i < displayText.length; i++) {
        hash = displayText.charCodeAt(i) + ((hash << 5) - hash);
      }
      const colorIndex = Math.abs(hash) % colors.length;
      backgroundColor = colors[colorIndex];
    }
    
    // 使用文本和颜色生成唯一 hash（用于 SVG gradient ID）
    let hash = 0;
    const hashText = displayText + backgroundColor;
    for (let i = 0; i < hashText.length; i++) {
      hash = hashText.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);
    
    // 根据字符数调整字体大小
    let fontSize;
    if (displayText.length === 1) {
      fontSize = '32';
    } else if (displayText.length === 2) {
      fontSize = '24';
    } else {
      fontSize = '20'; // 3个字符使用更小的字体
    }
    
    // 生成SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="grad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${backgroundColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${backgroundColor};stop-opacity:0.8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="url(#grad${hash})"/>
      <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" 
            font-family="Arial, -apple-system, BlinkMacSystemFont, sans-serif" 
            font-size="${fontSize}" font-weight="bold" fill="white">
        ${displayText}
      </text>
    </svg>`;
    
    // 转换为 Base64
    try {
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    } catch (error) {
      Logger.error('Generate text icon error:', error);
      return null;
    }
  },
  
  // 获取文字图标可用颜色列表
  getTextIconColors() {
    return [
      '#667eea', // 蓝紫
      '#764ba2', // 深紫
      '#f093fb', // 粉紫
      '#4facfe', // 天蓝
      '#00f2fe', // 青色
      '#43e97b', // 薄荷绿
      '#38f9d7', // 青绿
      '#fa709a', // 粉红
      '#fee140', // 金黄
      '#30cfd0', // 青蓝
      '#a8edea', // 浅青
      '#ff6a00', // 橙色
      '#ee0979', // 玫红
      '#a770ef', // 紫色
      '#fda085'  // 橘粉
    ];
  },
  
  // 解析文字图标（从 SVG base64 中提取文字和颜色）
  parseTextIcon(iconData) {
    if (!iconData || !iconData.startsWith('data:image/svg+xml;base64,')) {
      return null;
    }
    
    try {
      // 解码 base64
      const base64Data = iconData.replace('data:image/svg+xml;base64,', '');
      const svgXml = decodeURIComponent(escape(atob(base64Data)));
      
      // 解析 SVG
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgXml, 'image/svg+xml');
      
      // 提取文字内容
      const textElement = svgDoc.querySelector('text');
      if (!textElement) return null;
      
      const text = textElement.textContent.trim();
      if (!text) return null;
      
      // 提取颜色（从第一个 stop 元素）
      const firstStop = svgDoc.querySelector('stop');
      let color = null;
      if (firstStop) {
        const stopColor = firstStop.getAttribute('style');
        if (stopColor) {
          // 匹配 stop-color: 后面的颜色值（可能是 #hex 或 rgb/rgba 格式）
          const match = stopColor.match(/stop-color:\s*([^;]+)/);
          if (match) {
            color = match[1].trim();
            // 移除可能的引号
            color = color.replace(/['"]/g, '');
          }
        }
      }
      
      return {
        text: text,
        color: color
      };
    } catch (error) {
      Logger.error('Parse text icon error:', error);
      return null;
    }
  },

  // 验证 URL
  validateUrl(url) {
    return normalizeShortcutUrl(url);
  },

  // 安全获取元素
  getElement(id) {
    return document.getElementById(id);
  },

  // 生成唯一 ID
  generateId() {
    return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  // 🔑 新增：确保快捷方式有唯一 ID
  ensureShortcutId(shortcut) {
    if (!shortcut._id) {
      shortcut._id = Utils.generateId();
    }
    return shortcut._id;
  },

  // 🔑 新增：确保分组内的项目也有唯一 ID
  ensureShortcutIds(shortcuts) {
    shortcuts.forEach(shortcut => {
      Utils.ensureShortcutId(shortcut);
      if (shortcut.type === 'folder' && shortcut.items) {
        shortcut.items.forEach(item => Utils.ensureShortcutId(item));
      }
    });
  },

  // 获取下一个分组名称
  getNextFolderName() {
    let maxNum = 0;
    State.shortcuts.forEach(shortcut => {
      if (shortcut.type === 'folder') {
        const match = shortcut.name.match(/^组(\d+)$/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxNum) maxNum = num;
        }
      }
    });
    return `组${maxNum + 1}`;
  },

  // 显示撤回提示（支持多个提示，最多3个）
  showUndoToast(message, onUndo) {
    // 初始化撤回提示数组（如果不存在）
    if (!window.undoToasts) {
      window.undoToasts = [];
    }
    
    // 如果已经有3个提示，移除最旧的（数组末尾的）
    if (window.undoToasts.length >= 3) {
      const oldestToast = window.undoToasts.pop();  // 🔑 从末尾移除
      if (oldestToast.element && oldestToast.element.parentNode) {
        oldestToast.element.remove();
      }
      if (oldestToast.timeout) {
        clearTimeout(oldestToast.timeout);
      }
      if (oldestToast.interval) {
        clearInterval(oldestToast.interval);
      }
    }
    
    // 创建新的撤回提示元素
    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    
    const messageEl = document.createElement('span');
    messageEl.className = 'undo-message';
    
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo-btn';
    undoBtn.textContent = '撤回';
    
    toast.appendChild(messageEl);
    toast.appendChild(undoBtn);
    document.body.appendChild(toast);
    
    // 🔑 关键：新提示始终在最上面（top: 20px）
    toast.style.top = '20px';
    
    // 将现有的提示向下移动
    window.undoToasts.forEach((toastItem, idx) => {
      if (toastItem.element && toastItem.element.parentNode) {
        toastItem.element.style.top = `${20 + (idx + 1) * 76}px`;
      }
    });
    
    // 使用 setTimeout 确保 DOM 更新后再添加 show 类
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    // 倒计时
    const baseMessage = message;
    let countdown = 5;
    messageEl.textContent = `${baseMessage} (${countdown}s)`;
    
    // ✅ 使用 cleanupManager 管理定时器
    const countdownInterval = cleanupManager.setInterval(() => {
      countdown--;
      if (countdown > 0) {
        messageEl.textContent = `${baseMessage} (${countdown}s)`;
      } else {
        cleanupManager.clearTimer(countdownInterval);
      }
    }, 1000);
    
    // 移除提示的函数
    const removeToast = () => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
        
        // 从数组中移除
        const index = window.undoToasts.findIndex(t => t.element === toast);
        if (index !== -1) {
          window.undoToasts.splice(index, 1);
        }
        
        // 重新调整剩余提示的位置
        window.undoToasts.forEach((toastItem, idx) => {
          if (toastItem.element && toastItem.element.parentNode) {
            toastItem.element.style.top = `${20 + idx * 76}px`;
          }
        });
      }, 300); // 等待动画完成
      
      // ✅ 清除定时器
      if (toastData.timeout) {
        cleanupManager.clearTimer(toastData.timeout);
      }
      if (toastData.interval) {
        cleanupManager.clearTimer(toastData.interval);
      }
    };
    
    // 撤回按钮事件
    undoBtn.addEventListener('click', () => {
      onUndo();
      removeToast();
    });
    
    // ✅ 5秒后自动隐藏 - 使用 cleanupManager
    const timeout = cleanupManager.setTimeout(() => {
      removeToast();
    }, 5000);
    
    // 保存提示数据
    const toastData = {
      element: toast,
      timeout: timeout,
      interval: countdownInterval
    };
    
    // 🔑 关键：新提示插入到数组开头，这样索引0永远是最新的
    window.undoToasts.unshift(toastData);
  }
};

// ==================== 存储管理 ====================
const Storage = {
  async get(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      Logger.error('Storage get error:', error);
      return {};
    }
  },

  async set(data) {
    try {
      await chrome.storage.local.set(data);
      return true;
    } catch (error) {
      Logger.error('Storage set error:', error);
      return false;
    }
  },

  // 加载标签页数据
  async loadTabs() {
    const result = await this.get(['tabs']);
    
    if (result.tabs && result.tabs.length > 0) {
      // ✅ 校验并清理数据
      const validTabs = Validator.sanitizeTabs(result.tabs);
      
      // 🔑 关键修复：确保所有快捷方式都有唯一 ID
      validTabs.forEach(tab => {
        if (tab.shortcuts) {
          Utils.ensureShortcutIds(tab.shortcuts);
        }
      });
      
      if (validTabs.length > 0) {
        State.tabs = validTabs;
        // 始终切换到第一个标签页，不记住上次打开的标签页
        State.currentTabId = State.tabs[0].id;
      } else {
        Logger.warn('所有标签页数据无效，初始化默认标签页');
        // 如果所有数据都无效，初始化默认标签页
        await this.initDefaultTab();
      }
    } else {
      await this.initDefaultTab();
    }
    
    return State.tabs;
  },
  
  // ✅ 初始化默认标签页
  async initDefaultTab() {
    const defaultTab = {
      id: Utils.generateId(),
      name: '页1',
      shortcuts: CONFIG.defaultShortcuts.map(s => ({
        ...s,
        icon: s.icon || Utils.getFaviconUrl(s.url)
      }))
    };
    State.tabs = [defaultTab];
    State.currentTabId = defaultTab.id;
    await this.saveTabs();
  },

  // 保存标签页数据
  async saveTabs() {
    // 🔑 关键修复：添加调试日志，确认保存的数据
    Logger.debug('Saving tabs:', State.tabs.length, 'tabs');
    State.tabs.forEach((tab, index) => {
      Logger.debug(`Tab ${index}: ${tab.name}, shortcuts: ${tab.shortcuts?.length || 0}`);
    });
    
    const result = await this.set({
      tabs: State.tabs,
      currentTabId: State.currentTabId
    });
    
    if (result) {
      Logger.debug('Tabs saved successfully');
    } else {
      Logger.error('Failed to save tabs');
    }
    
    return result;
  },

  // 保存快捷方式到当前标签页
  async saveShortcuts() {
    const currentTab = State.tabs.find(t => t.id === State.currentTabId);
    if (currentTab) {
      // 🔑 关键修复：确保保存的是 State.shortcuts 的深拷贝，避免引用问题
      currentTab.shortcuts = JSON.parse(JSON.stringify(State.shortcuts));
      Logger.debug('Saving shortcuts to tab:', currentTab.name, 'count:', currentTab.shortcuts.length);
      return await this.saveTabs();
    }
    Logger.warn('Current tab not found, cannot save shortcuts');
    return false;
  },

  // 加载设置
  async loadSettings() {
    const result = await this.get(['background', 'searchEngine', 'searchOpacity', 'autoHideControls', 'customEngineUrl', 'gridColumns']);
    
    return {
      background: result.background || null,
      searchEngine: result.searchEngine || CONFIG.defaultSettings.searchEngine,
      searchOpacity: result.searchOpacity !== undefined ? result.searchOpacity : CONFIG.defaultSettings.searchOpacity,
      autoHideControls: result.autoHideControls !== undefined ? result.autoHideControls : CONFIG.defaultSettings.autoHideControls,
      customEngineUrl: result.customEngineUrl || '',
      gridColumns: result.gridColumns !== undefined ? result.gridColumns : 12
    };
  }
};

// ==================== UI 渲染 ====================
const UI = {
  // 渲染标签页列表
  renderTabs() {
    const tabsList = Utils.getElement('tabsList');
    if (!tabsList) return;

    tabsList.innerHTML = '';

    // 渲染现有标签页
    State.tabs.forEach((tab, index) => {
      const tabItem = document.createElement('div');
      tabItem.className = `tab-item${tab.id === State.currentTabId ? ' active' : ''}`;
      tabItem.dataset.index = index;
      tabItem.dataset.tabId = tab.id;
      
      // 显示标签页名称
      const tabName = document.createElement('span');
      tabName.className = 'tab-name';
      tabName.textContent = tab.name;
      tabItem.appendChild(tabName);

      // 添加拖拽属性
      tabItem.draggable = true;
      
      tabItem.addEventListener('dragstart', (e) => {
        State.draggingTab = true;
        TabManager.handleTabDragStart(e, index);
      });
      
      tabItem.addEventListener('dragover', (e) => TabManager.handleTabDragOver(e, index));
      tabItem.addEventListener('dragleave', (e) => TabManager.handleTabDragLeave(e));
      tabItem.addEventListener('drop', (e) => TabManager.handleTabDrop(e, index));
      
      tabItem.addEventListener('dragend', (e) => {
        // 延迟重置，确保drop事件先执行
        setTimeout(() => {
          State.draggingTab = false;
        }, 0);
        TabManager.handleTabDragEnd(e);
      });

      // 点击切换（拖拽时不触发）
      tabItem.onclick = (e) => {
        if (!State.draggingTab) {
          TabManager.switchTab(tab.id);
        }
      };

      // 右键菜单（重命名/删除）
      tabItem.oncontextmenu = (e) => {
        e.preventDefault();
        TabManager.showContextMenu(tab.id, e);
      };

      tabsList.appendChild(tabItem);
    });

    // 添加"新增标签页"按钮
    const addTabItem = document.createElement('div');
    addTabItem.className = 'tab-item tab-add-btn';
    addTabItem.onclick = () => TabManager.add();
    addTabItem.title = '新建页面';
    addTabItem.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;
    tabsList.appendChild(addTabItem);
  },

  // 渲染快捷方式
  renderShortcuts() {
    const grid = Utils.getElement('shortcutsGrid');
    if (!grid) {
      Logger.error('shortcutsGrid element not found');
      return;
    }

    // 确保 shortcuts 是有效的数组
    if (!State.shortcuts || !Array.isArray(State.shortcuts)) {
      Logger.warn('State.shortcuts is not valid, initializing to empty array');
      State.shortcuts = [];
    }

    // 🔑 关键修复：确保所有快捷方式都有唯一 ID
    Utils.ensureShortcutIds(State.shortcuts);

    grid.innerHTML = '';

    // 渲染现有快捷方式
    State.shortcuts.forEach((shortcut, index) => {
      const item = document.createElement('div');
      item.className = 'shortcut-item';
      item.dataset.index = index;
      // 🔑 关键修复：保存唯一 ID 到 DOM 元素
      item.dataset.shortcutId = Utils.ensureShortcutId(shortcut);
      
      // 添加拖拽属性
      item.draggable = true;
      item.addEventListener('dragstart', (e) => ShortcutManager.handleDragStart(e, index));
      item.addEventListener('dragover', (e) => ShortcutManager.handleDragOver(e, index));
      item.addEventListener('dragleave', (e) => ShortcutManager.handleDragLeave(e));
      item.addEventListener('drop', (e) => ShortcutManager.handleDrop(e, index));
      item.addEventListener('dragend', (e) => ShortcutManager.handleDragEnd(e));

      // 检查是否是分组
      if (shortcut.type === 'folder') {
        // 渲染分组（田字形显示前4个图标）
        const folderDiv = document.createElement('div');
        folderDiv.className = 'shortcut-link folder-link';

        const folderIcon = document.createElement('div');
        folderIcon.className = 'shortcut-icon folder-icon';
        
        // ✅ 只在图标上绑定点击事件，名称不触发
        let clickStartTime = 0;
        folderIcon.addEventListener('mousedown', () => {
          clickStartTime = Date.now();
        });
        
        folderIcon.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止事件冒泡
          // 只有短时间点击（不是拖动）才打开分组
          const clickDuration = Date.now() - clickStartTime;
          if (clickDuration < 300) {
            // 使用实时的索引，而不是闭包中的index
            const currentIndex = parseInt(item.dataset.index);
            if (!isNaN(currentIndex)) {
              ShortcutManager.openFolder(currentIndex);
            }
          }
        });
        
        // 显示前4个快捷方式的图标
        const items = shortcut.items || [];
        for (let i = 0; i < Math.min(4, items.length); i++) {
          const miniIcon = document.createElement('img');
          miniIcon.className = 'folder-mini-icon';
          miniIcon.draggable = false; // 防止图片阻止拖动
          const itemUrl = items[i].url;
          const originalMiniIcon = items[i].icon;
          const miniIconIsData = originalMiniIcon && originalMiniIcon.startsWith('data:image');
          miniIcon.src = miniIconIsData ? originalMiniIcon : Utils.getFaviconUrl(itemUrl);
          let miniIconTimeout = null;
          const scheduleMiniIconTimeout = () => {
            if (miniIconTimeout) {
              clearTimeout(miniIconTimeout);
            }
            miniIconTimeout = setTimeout(() => {
              if (!miniIcon.complete || miniIcon.naturalWidth <= 1 || miniIcon.naturalHeight <= 1) {
                miniIconFallback();
              }
            }, ICON_FALLBACK_TIMEOUT_MS);
          };

          let miniIconTriedOriginal = false;
          let miniIconTriedGoogle = false;
          const miniIconFallback = () => {
            if (!miniIconIsData && originalMiniIcon && !miniIconTriedOriginal && originalMiniIcon !== miniIcon.src) {
              miniIconTriedOriginal = true;
              miniIcon.src = originalMiniIcon;
              scheduleMiniIconTimeout();
              return;
            }
            if (!miniIconTriedGoogle) {
              miniIconTriedGoogle = true;
              const googleUrl = Utils.getGoogleFaviconUrl(itemUrl);
              if (googleUrl && googleUrl !== miniIcon.src) {
                miniIcon.src = googleUrl;
                scheduleMiniIconTimeout();
                return;
              }
            }
            // 使用默认占位图标，防止无限循环
            miniIcon.src = Utils.getDefaultIconData();
          };
          scheduleMiniIconTimeout();

          miniIcon.onerror = () => {
            if (miniIconTimeout) {
              clearTimeout(miniIconTimeout);
            }
            miniIconFallback();
          };

          miniIcon.onload = () => {
            if (miniIconTimeout) {
              clearTimeout(miniIconTimeout);
            }
            if (miniIcon.naturalWidth <= 1 || miniIcon.naturalHeight <= 1) {
              miniIconFallback();
            }
          };
          folderIcon.appendChild(miniIcon);
        }
        
        // 如果少于4个,填充空白
        for (let i = items.length; i < 4; i++) {
          const emptyIcon = document.createElement('div');
          emptyIcon.className = 'folder-mini-icon folder-empty';
          folderIcon.appendChild(emptyIcon);
        }

        const name = document.createElement('div');
        name.className = 'shortcut-name';
        name.textContent = shortcut.name;
        // ✅ 名称不触发打开操作，只能右键编辑
        name.style.cursor = 'default'; // 不显示手型光标

        folderDiv.appendChild(folderIcon);
        folderDiv.appendChild(name);

        // 右键菜单
        item.oncontextmenu = (e) => {
          e.preventDefault();
          ShortcutManager.showContextMenu(index, e);
        };

        item.appendChild(folderDiv);
      } else {
        // 渲染普通快捷方式
        const link = document.createElement('div');
        link.className = 'shortcut-link';
        link.dataset.url = shortcut.url; // 存储URL但不使用<a>标签
        link.style.cursor = 'pointer'; // 显示手型光标
        
        // 打开链接的通用函数
        // inBackground: true 表示在后台打开，不切换到新标签页
        const openLink = async (inBackground = false) => {
          const validUrl = Utils.validateUrl(shortcut.url);
          if (!validUrl) {
            Toast.error('无效的链接地址');
            return;
          }
          try {
            const tabs = await chrome.tabs.query({});
            const lastIndex = tabs.length;
            chrome.tabs.create({ 
              url: validUrl, 
              index: lastIndex,
              active: !inBackground // active: false 表示后台打开
            });
          } catch {
            window.open(validUrl, '_blank', 'noopener,noreferrer');
          }
        };
        
        // 左键点击打开链接（切换到新标签页）
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          await openLink(false);
        });
        
        // 中键（滚轮）点击打开链接（后台打开，不切换）
        link.addEventListener('auxclick', async (e) => {
          if (e.button === 1) { // 中键
            e.preventDefault();
            await openLink(true); // 后台打开
          }
        });

        const icon = document.createElement('img');
        icon.className = 'shortcut-icon';
        icon.alt = shortcut.name;
        icon.draggable = false; // 防止图片阻止拖动
        const originalIcon = shortcut.icon;
        const iconIsData = originalIcon && originalIcon.startsWith('data:image');
        icon.src = iconIsData ? originalIcon : Utils.getFaviconUrl(shortcut.url);
        let iconTimeout = null;
        const scheduleIconTimeout = () => {
          if (iconTimeout) {
            clearTimeout(iconTimeout);
          }
          iconTimeout = setTimeout(() => {
            if (!icon.complete || icon.naturalWidth <= 1 || icon.naturalHeight <= 1) {
              iconFallback();
            }
          }, ICON_FALLBACK_TIMEOUT_MS);
        };

        let iconTriedOriginal = false;
        let iconTriedGoogle = false;
        const iconFallback = () => {
          if (!iconIsData && originalIcon && !iconTriedOriginal && originalIcon !== icon.src) {
            iconTriedOriginal = true;
            icon.src = originalIcon;
            scheduleIconTimeout();
            return;
          }
          if (!iconTriedGoogle) {
            iconTriedGoogle = true;
            const googleUrl = Utils.getGoogleFaviconUrl(shortcut.url);
            if (googleUrl && googleUrl !== icon.src) {
              icon.src = googleUrl;
              scheduleIconTimeout();
              return;
            }
          }
          // 使用默认占位图标，防止无限循环
          icon.src = Utils.getDefaultIconData();
        };
        scheduleIconTimeout();

        icon.onerror = () => {
          if (iconTimeout) {
            clearTimeout(iconTimeout);
          }
          iconFallback();
        };

        icon.onload = () => {
          if (iconTimeout) {
            clearTimeout(iconTimeout);
          }
          if (icon.naturalWidth <= 1 || icon.naturalHeight <= 1) {
            iconFallback();
          }
        };

        const name = document.createElement('div');
        name.className = 'shortcut-name';
        name.textContent = shortcut.name;

        link.appendChild(icon);
        link.appendChild(name);

        // 右键菜单
        item.oncontextmenu = (e) => {
          e.preventDefault();
          ShortcutManager.showContextMenu(index, e);
        };

        item.appendChild(link);
      }
      
      grid.appendChild(item);
    });

    // 添加"新增"按钮
    const addItem = document.createElement('div');
    addItem.className = 'shortcut-item shortcut-add-btn';
    addItem.onclick = () => ShortcutManager.add();
    addItem.title = '添加图标';
    addItem.innerHTML = `
      <div class="shortcut-link">
        <div class="shortcut-icon add-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
      </div>
    `;
    grid.appendChild(addItem);
  },

  // 应用搜索框透明度
  applySearchOpacity(opacity) {
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
      searchInput.style.background = `rgba(255, 255, 255, ${opacity / 100})`;
    }
  },

  // 应用图标区域宽度设置
  applyGridColumns(columns) {
    // 设置 CSS 变量
    document.documentElement.style.setProperty('--grid-columns', columns.toString());
  },


  // 更新搜索引擎 UI
  updateSearchEngineUI() {
    const selectedEngine = Utils.getElement('selectedEngine');
    const engineNames = { google: 'Google', bing: 'Bing', baidu: '百度', custom: '自定义' };
    if (selectedEngine) {
      selectedEngine.textContent = engineNames[State.currentEngine] || 'Google';
    }
    
    // 更新选中状态
    const options = document.querySelectorAll('.custom-select-option');
    options.forEach(option => {
      if (option.dataset.value === State.currentEngine) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
  },

  // 显示/隐藏模态框
  toggleModal(show, isEdit = false) {
    const modal = Utils.getElement('addShortcutModal');
    const modalTitle = Utils.getElement('modalTitle');
    
    if (!modal) return;

    if (show) {
      if (modalTitle) {
        modalTitle.textContent = isEdit ? '编辑图标' : '添加图标';
      }
      modal.classList.add('active');
    } else {
      modal.classList.remove('active');
      this.clearForm();
      State.editingIndex = -1;
      State.editingFolderItemIndex = -1;
    }
  },

  // 显示/隐藏标签页编辑模态框
  toggleTabEditModal(show) {
    const modal = Utils.getElement('tabEditModal');
    const tabsSidebar = document.querySelector('.tabs-sidebar');
    
    if (!modal) return;

    if (show) {
      modal.classList.add('active');
      
      // 根据是添加还是编辑模式设置标题
      const titleElement = Utils.getElement('tabEditTitle');
      if (titleElement) {
        titleElement.textContent = State.editingTabId ? '编辑页面' : '添加页面';
      }
      
      // 编辑时强制显示标签切换按钮
      if (tabsSidebar && !tabsSidebar.classList.contains('no-auto-hide')) {
        tabsSidebar.classList.add('editing');
        tabsSidebar.classList.add('show');
      }
      
      // 动态计算侧边栏宽度并调整编辑界面位置
      setTimeout(() => {
        if (tabsSidebar) {
          const sidebarWidth = tabsSidebar.offsetWidth;
          const spacing = 10; // 固定间距 10px
          modal.style.paddingRight = (sidebarWidth + spacing) + 'px';
        }
        
        // 聚焦输入框
        const tabNameInput = Utils.getElement('tabName');
        if (tabNameInput) {
          tabNameInput.focus();
          tabNameInput.select();
        }
      }, 100);
    } else {
      modal.classList.remove('active');
      
      // 关闭编辑模式
      if (tabsSidebar) {
        tabsSidebar.classList.remove('editing');
      }
      
      const tabNameInput = Utils.getElement('tabName');
      if (tabNameInput) tabNameInput.value = '';
    }
  },

  // 清空表单
  clearForm() {
    const siteName = Utils.getElement('siteName');
    const siteUrl = Utils.getElement('siteUrl');
    const siteIcon = Utils.getElement('siteIcon');
    const textIconGroup = Utils.getElement('textIconGroup');
    const textIconInput = Utils.getElement('textIconInput');
    const colorPicker = Utils.getElement('textIconColorPicker');
    const colorGrid = Utils.getElement('textIconColorGrid');

    if (siteName) siteName.value = '';
    if (siteUrl) siteUrl.value = '';
    if (siteIcon) siteIcon.value = '';
    
    // 隐藏并清空文字图标输入框
    if (textIconGroup) textIconGroup.style.display = 'none';
    if (textIconInput) textIconInput.value = '';
    if (colorPicker) colorPicker.style.display = 'none';
    // 清除颜色选择
    if (colorGrid) {
      colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
        btn.classList.remove('selected');
      });
    }
  },

  // 显示/隐藏设置面板
  toggleSettings(show) {
    const panel = Utils.getElement('settingsPanel');
    if (panel) {
      panel.classList.toggle('active', show);
    }
  },

  // 显示/隐藏分组弹窗
  toggleFolderModal(show, folder = null) {
    const modal = Utils.getElement('folderModal');
    if (!modal) return;

    if (show && folder) {
      modal.classList.add('active');
      this.renderFolderContent(folder);
    } else {
      modal.classList.remove('active');
    }
  },

  // 渲染分组内容
  renderFolderContent(folder) {
    const folderName = Utils.getElement('folderName');
    const folderGrid = Utils.getElement('folderGrid');
    
    if (folderName) {
      folderName.textContent = folder.name;
      // 点击名称可编辑
      folderName.style.cursor = 'pointer';
      folderName.onclick = () => {
        ShortcutManager.renameFolderInModal(State.editingIndex);
      };
    }
    
    if (!folderGrid) return;
    
    folderGrid.innerHTML = '';
    
    // 🔑 关键修复：确保分组内的所有项目都有唯一 ID
    if (folder.items) {
      folder.items.forEach(item => Utils.ensureShortcutId(item));
    }
    
    // 渲染分组内的快捷方式
    folder.items.forEach((item, itemIndex) => {
      const shortcutItem = document.createElement('div');
      shortcutItem.className = 'folder-shortcut-item';
      shortcutItem.dataset.folderIndex = State.editingIndex;
      shortcutItem.dataset.itemIndex = itemIndex;
      // 🔑 关键修复：保存唯一 ID 到 DOM 元素
      shortcutItem.dataset.itemId = Utils.ensureShortcutId(item);
      
      // 添加拖拽支持
      shortcutItem.draggable = true;
      
      let isDragging = false;
      let dragStartTime = 0;
      
      shortcutItem.addEventListener('mousedown', () => {
        isDragging = false;
        dragStartTime = Date.now();
      });
      
      shortcutItem.addEventListener('dragstart', (e) => {
        isDragging = true;
        ShortcutManager.handleFolderItemDragStart(e, State.editingIndex, itemIndex);
      });
      shortcutItem.addEventListener('dragover', (e) => {
        ShortcutManager.handleFolderItemDragOver(e, itemIndex);
      });
      shortcutItem.addEventListener('drop', (e) => {
        ShortcutManager.handleFolderItemDrop(e, itemIndex);
      });
      shortcutItem.addEventListener('dragend', (e) => {
        ShortcutManager.handleFolderItemDragEnd(e);
        setTimeout(() => { isDragging = false; }, 100);
      });
      
      // 打开链接的通用函数
      // inBackground: true 表示在后台打开，不切换到新标签页
      const openFolderItemLink = async (inBackground = false) => {
        try {
          const tabs = await chrome.tabs.query({});
          const lastIndex = tabs.length;
          chrome.tabs.create({ 
            url: item.url, 
            index: lastIndex,
            active: !inBackground // active: false 表示后台打开
          });
        } catch {
          window.open(item.url, '_blank', 'noopener,noreferrer');
        }
      };
      
      // 在父元素上处理左键点击（切换到新标签页）
      shortcutItem.addEventListener('click', async (e) => {
        const clickDuration = Date.now() - dragStartTime;
        // 只有在短时间点击（不是拖动）且没有正在拖动时才打开链接
        if (!isDragging && clickDuration < 300 && !State.draggedItem) {
          await openFolderItemLink(false);
        }
        e.preventDefault();
      });
      
      // 在父元素上处理中键（滚轮）点击（后台打开，不切换）
      shortcutItem.addEventListener('auxclick', async (e) => {
        if (e.button === 1) { // 中键
          const clickDuration = Date.now() - dragStartTime;
          // 只有在不拖动时才打开链接
          if (!isDragging && clickDuration < 300 && !State.draggedItem) {
            e.preventDefault();
            await openFolderItemLink(true); // 后台打开
          }
        }
      });
      
      const link = document.createElement('div');
      link.className = 'folder-shortcut-link';
      link.dataset.url = item.url; // 存储URL但不使用<a>标签
      
      const icon = document.createElement('img');
      icon.className = 'folder-shortcut-icon';
      icon.alt = item.name;
      icon.draggable = false; // 防止图片阻止拖动
      const originalFolderIcon = item.icon;
      const folderIconIsData = originalFolderIcon && originalFolderIcon.startsWith('data:image');
      icon.src = folderIconIsData ? originalFolderIcon : Utils.getFaviconUrl(item.url);
      let folderIconTimeout = null;
      const scheduleFolderIconTimeout = () => {
        if (folderIconTimeout) {
          clearTimeout(folderIconTimeout);
        }
        folderIconTimeout = setTimeout(() => {
          if (!icon.complete || icon.naturalWidth <= 1 || icon.naturalHeight <= 1) {
            folderIconFallback();
          }
        }, ICON_FALLBACK_TIMEOUT_MS);
      };

      let folderIconTriedOriginal = false;
      let folderIconTriedGoogle = false;
      const folderIconFallback = () => {
        if (!folderIconIsData && originalFolderIcon && !folderIconTriedOriginal && originalFolderIcon !== icon.src) {
          folderIconTriedOriginal = true;
          icon.src = originalFolderIcon;
          scheduleFolderIconTimeout();
          return;
        }
        if (!folderIconTriedGoogle) {
          folderIconTriedGoogle = true;
          const googleUrl = Utils.getGoogleFaviconUrl(item.url);
          if (googleUrl && googleUrl !== icon.src) {
            icon.src = googleUrl;
            scheduleFolderIconTimeout();
            return;
          }
        }
        // 使用默认占位图标，防止无限循环
        icon.src = Utils.getDefaultIconData();
      };
      scheduleFolderIconTimeout();

      icon.onerror = () => {
        if (folderIconTimeout) {
          clearTimeout(folderIconTimeout);
        }
        folderIconFallback();
      };

      icon.onload = () => {
        if (folderIconTimeout) {
          clearTimeout(folderIconTimeout);
        }
        if (icon.naturalWidth <= 1 || icon.naturalHeight <= 1) {
          folderIconFallback();
        }
      };
      
      const name = document.createElement('div');
      name.className = 'folder-shortcut-name';
      name.textContent = item.name;
      
      link.appendChild(icon);
      link.appendChild(name);
      
      // 右键菜单 - 使用 dataset 动态获取索引，而不是闭包
      shortcutItem.oncontextmenu = (e) => {
        e.preventDefault();
        // 🔑 关键：从 dataset 动态读取当前 ID，而不是使用索引
        const currentFolderIndex = parseInt(e.currentTarget.dataset.folderIndex);
        const currentItemId = e.currentTarget.dataset.itemId;
        this.showFolderItemContextMenu(currentFolderIndex, currentItemId, e);
      };
      
      shortcutItem.appendChild(link);
      folderGrid.appendChild(shortcutItem);
    });
  },

  // 显示分组内快捷方式的右键菜单
  showFolderItemContextMenu(folderIndex, itemId, event) {
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

    // 判断是否显示"移动"选项（需要有多个标签页）
    const showMove = State.tabs.length > 1;

    menu.innerHTML = `
      <div class="context-menu-item" data-action="edit">
        <span>✏️</span>编辑
      </div>
      <div class="context-menu-item" data-action="remove">
        <span>📤</span>移出
      </div>
      ${showMove ? `
      <div class="context-menu-item" data-action="move">
        <span>📋</span>移动
      </div>
      ` : ''}
      <div class="context-menu-item context-menu-item-danger" data-action="delete">
        <span>🗑️</span>删除
      </div>
    `;

    document.body.appendChild(menu);

    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      if (action === 'edit') {
        ShortcutManager.editFolderItem(folderIndex, itemId);
      } else if (action === 'remove') {
        ShortcutManager.removeFromFolder(folderIndex, itemId);
      } else if (action === 'move') {
        ShortcutManager.showMoveFolderItemToTabModal(folderIndex, itemId);
      } else if (action === 'delete') {
        ShortcutManager.deleteFromFolder(folderIndex, itemId);
      }

      menu.remove();
    });

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }
};

// ==================== 标签页管理 ====================
const TabManager = {
  async init() {
    await Storage.loadTabs();
    this.loadCurrentTabShortcuts();
    UI.renderTabs();
  },

  loadCurrentTabShortcuts() {
    const currentTab = State.tabs.find(t => t.id === State.currentTabId);
    State.shortcuts = currentTab ? currentTab.shortcuts || [] : [];
    
    // 🔑 关键修复：加载时确保所有快捷方式都有唯一 ID
    Utils.ensureShortcutIds(State.shortcuts);
    
    UI.renderShortcuts();
  },

  async switchTab(tabId) {
    if (State.currentTabId === tabId) return; // 避免重复切换
    
    State.currentTabId = tabId;
    await Storage.saveTabs();
    this.loadCurrentTabShortcuts();
    UI.renderTabs();
  },

  // 滚轮切换标签页
  switchByWheel(delta) {
    if (State.tabs.length <= 1) return;

    const currentIndex = State.tabs.findIndex(t => t.id === State.currentTabId);
    let nextIndex;

    if (delta > 0) {
      // 向下滚动 - 下一个标签页
      // 如果在最后一页，不允许向下滚动（循环）
      if (currentIndex === State.tabs.length - 1) {
        return; // 已经在最后一页，不切换
      }
      nextIndex = currentIndex + 1;
    } else {
      // 向上滚动 - 上一个标签页
      // 如果在第一页，不允许向上滚动（循环）
      if (currentIndex === 0) {
        return; // 已经在第一页，不切换
      }
      nextIndex = currentIndex - 1;
    }

    this.switchTab(State.tabs[nextIndex].id);
  },

  async add() {
    // 设置默认名称
    const tabNameInput = Utils.getElement('tabName');
    if (tabNameInput) {
      tabNameInput.value = `页${State.tabs.length + 1}`;
    }
    
    // 标记为添加模式
    State.editingTabId = null;
    
    // 显示模态框
    UI.toggleTabEditModal(true);
  },

  async rename(tabId) {
    const tab = State.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // 填充当前标签页名称
    const tabNameInput = Utils.getElement('tabName');
    if (tabNameInput) {
      tabNameInput.value = tab.name;
    }
    
    // 标记为编辑模式
    State.editingTabId = tabId;
    
    // 显示模态框
    UI.toggleTabEditModal(true);
  },

  async saveTabEdit() {
    const tabNameInput = Utils.getElement('tabName');
    if (!tabNameInput) return;

    const newName = tabNameInput.value.trim();
    if (!newName) {
      Toast.warning('请输入标签页名称');
      return;
    }

    if (State.editingTabId) {
      // 编辑模式：重命名现有标签页
      const tab = State.tabs.find(t => t.id === State.editingTabId);
      if (tab) {
        tab.name = newName;
        await Storage.saveTabs();
        UI.renderTabs();
      }
    } else {
      // 添加模式：创建新标签页
      const newTab = {
        id: Utils.generateId(),
        name: newName,
        shortcuts: []
      };

      State.tabs.push(newTab);
      State.currentTabId = newTab.id;
      await Storage.saveTabs();
      UI.renderTabs();
      this.loadCurrentTabShortcuts();
    }

    // 关闭模态框
    UI.toggleTabEditModal(false);
    State.editingTabId = null;
  },

  showContextMenu(tabId, event) {
    const tab = State.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // 创建自定义右键菜单
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    
    // 菜单显示在鼠标左侧
    menu.style.right = (window.innerWidth - event.pageX + 10) + 'px';
    menu.style.top = event.pageY + 'px';

    // 根据标签页数量决定是否显示删除选项
    const canDelete = State.tabs.length > 1;
    
    menu.innerHTML = `
      <div class="context-menu-item" data-action="rename">
        <span>✏️</span>编辑
      </div>
      ${canDelete ? `
      <div class="context-menu-item context-menu-item-danger" data-action="delete">
        <span>🗑️</span>删除
      </div>
      ` : ''}
    `;

    document.body.appendChild(menu);

    // 点击菜单项
    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      if (action === 'rename') {
        this.rename(tabId);
      } else if (action === 'delete') {
        this.deleteTab(tabId);
      }

      menu.remove();
    });

    // 点击其他地方关闭菜单
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  async deleteTab(tabId) {
    if (State.tabs.length <= 1) {
      Toast.warning('至少需要保留一个标签页');
      return;
    }

    const index = State.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    // 保存删除的标签页数据
    const deletedTab = { ...State.tabs[index] };
    const wasCurrentTab = State.currentTabId === tabId;
    const oldCurrentTabId = State.currentTabId;

    // 删除标签页
    State.tabs.splice(index, 1);

    // 如果删除的是当前标签页，切换到第一个
    if (wasCurrentTab) {
      State.currentTabId = State.tabs[0].id;
    }

    await Storage.saveTabs();
    UI.renderTabs();
    this.loadCurrentTabShortcuts();

    // 显示撤回提示
    Utils.showUndoToast(`已删除页面「${deletedTab.name}」`, async () => {
      // 恢复标签页
      State.tabs.splice(index, 0, deletedTab);
      
      // 恢复之前的当前标签页
      if (wasCurrentTab) {
        State.currentTabId = oldCurrentTabId;
      }
      
      await Storage.saveTabs();
      UI.renderTabs();
      this.loadCurrentTabShortcuts();
    });
  },

  // 标签页拖拽处理
  draggedTabIndex: null,
  draggedTabElement: null,

  handleTabDragStart(e, index) {
    this.draggedTabIndex = index;
    this.draggedTabElement = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
    
    // 添加拖拽样式
    setTimeout(() => {
      if (this.draggedTabElement) {
        this.draggedTabElement.classList.add('dragging');
      }
    }, 0);
  },

  handleTabDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (this.draggedTabIndex === null || this.draggedTabIndex === index) return;
    
    const tabsList = Utils.getElement('tabsList');
    if (!tabsList) return;
    
    const targetElement = e.currentTarget;
    if (!targetElement || targetElement === this.draggedTabElement) return;
    
    const children = Array.from(tabsList.children).filter(
      child => !child.classList.contains('tab-add-btn')
    );
    
    const currentIndex = children.indexOf(this.draggedTabElement);
    const actualTargetIndex = children.indexOf(targetElement);
    
    if (currentIndex === -1 || actualTargetIndex === -1) return;
    if (currentIndex === actualTargetIndex) return;
    
    // 计算目标位置（纵向列表，使用Y坐标判断）
    const rect = targetElement.getBoundingClientRect();
    const targetCenterY = rect.top + rect.height / 2;
    const insertBefore = e.clientY < targetCenterY;
    
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
    if (currentIndex === targetPosition) return;
    
    // 执行DOM移动
    if (insertBefore) {
      tabsList.insertBefore(this.draggedTabElement, targetElement);
    } else {
      const nextElement = targetElement.nextSibling;
      if (nextElement && nextElement !== this.draggedTabElement) {
        tabsList.insertBefore(this.draggedTabElement, nextElement);
      } else if (!nextElement) {
        // 如果目标元素是最后一个，插入到"新增标签页"按钮之前
        const addBtn = tabsList.querySelector('.tab-add-btn');
        if (addBtn) {
          tabsList.insertBefore(this.draggedTabElement, addBtn);
        } else {
          tabsList.appendChild(this.draggedTabElement);
        }
      }
    }
    
    // 更新索引
    this.draggedTabIndex = targetPosition;
    
    // 添加高亮样式
    targetElement.classList.add('drag-over');
  },

  handleTabDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  },

  async handleTabDrop(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();
    
    // 清除所有高亮
    document.querySelectorAll('.tab-item.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
    
    if (this.draggedTabIndex === null) {
      return;
    }
    
    // 根据DOM顺序更新State.tabs数组
    const tabsList = Utils.getElement('tabsList');
    if (!tabsList) return;
    
    const children = Array.from(tabsList.children).filter(
      child => !child.classList.contains('tab-add-btn')
    );
    
    // 创建新的标签页顺序数组
    const newTabsOrder = [];
    children.forEach(child => {
      const tabId = child.dataset.tabId;
      const tab = State.tabs.find(t => t.id === tabId);
      if (tab) {
        newTabsOrder.push(tab);
      }
    });
    
    // 检查顺序是否真的改变了
    if (newTabsOrder.length !== State.tabs.length) {
      Logger.warn('Tab order mismatch, skipping update');
      return;
    }
    
    // 检查顺序是否改变
    let orderChanged = false;
    for (let i = 0; i < newTabsOrder.length; i++) {
      if (newTabsOrder[i].id !== State.tabs[i].id) {
        orderChanged = true;
        break;
      }
    }
    
    if (!orderChanged) {
      return;
    }
    
    // 更新State.tabs
    State.tabs = newTabsOrder;
    
    // 保存到storage
    await Storage.saveTabs();
    
    // 重新渲染以确保索引正确
    UI.renderTabs();
  },

  handleTabDragEnd(e) {
    // 移除拖拽样式
    if (this.draggedTabElement) {
      this.draggedTabElement.classList.remove('dragging');
    }
    
    // 清除所有高亮
    document.querySelectorAll('.tab-item.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
    
    // 重置状态
    setTimeout(() => {
      this.draggedTabIndex = null;
      this.draggedTabElement = null;
    }, 0);
  }
};

// ==================== 快捷方式管理 ====================
const ShortcutManager = {
  add() {
    State.editingIndex = -1;
    UI.toggleModal(true, false);
  },

  edit(index) {
    State.editingIndex = index;
    const shortcut = State.shortcuts[index];
    
    // 如果是分组,打开分组而不是编辑
    if (shortcut.type === 'folder') {
      this.openFolder(index);
      return;
    }
    
    const siteName = Utils.getElement('siteName');
    const siteUrl = Utils.getElement('siteUrl');
    const siteIcon = Utils.getElement('siteIcon');
    const textIconInput = Utils.getElement('textIconInput');
    const textIconGroup = Utils.getElement('textIconGroup');
    const colorPicker = Utils.getElement('textIconColorPicker');
    const colorGrid = Utils.getElement('textIconColorGrid');

    if (siteName) siteName.value = shortcut.name;
    if (siteUrl) siteUrl.value = shortcut.url;
    if (siteIcon) siteIcon.value = shortcut.icon || '';
    
    // 检查是否是文字图标
    const textIconData = Utils.parseTextIcon(shortcut.icon);
    if (textIconData) {
      // 显示文字图标输入框
      if (textIconGroup) {
        textIconGroup.style.display = 'block';
      }
      
      // 填充文字
      if (textIconInput) {
        textIconInput.value = textIconData.text;
      }
      
      // 显示颜色选择器
      if (colorPicker) {
        colorPicker.style.display = 'block';
      }
      
      // 初始化颜色选择器（如果还没有创建）
      if (colorGrid && colorGrid.children.length === 0) {
        const colors = Utils.getTextIconColors();
        colors.forEach((color) => {
          const colorBtn = document.createElement('button');
          colorBtn.type = 'button';
          colorBtn.className = 'text-icon-color-btn';
          colorBtn.style.backgroundColor = color;
          colorBtn.dataset.color = color;
          colorBtn.title = '点击选择此颜色';
          colorBtn.addEventListener('click', () => {
            colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
              btn.classList.remove('selected');
            });
            colorBtn.classList.add('selected');
            
            const currentText = textIconInput ? textIconInput.value.trim() : '';
            if (currentText.length > 0 && siteIcon) {
              const textIcon = Utils.generateTextIcon(currentText, color);
              if (textIcon) {
                siteIcon.value = textIcon;
              }
            }
          });
          colorGrid.appendChild(colorBtn);
        });
      }
      
      // 高亮当前使用的颜色
      if (textIconData.color && colorGrid) {
        colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
          btn.classList.remove('selected');
          if (btn.dataset.color === textIconData.color) {
            btn.classList.add('selected');
          }
        });
      }
    } else {
      // 不是文字图标，隐藏文字图标输入框
      if (textIconGroup) {
        textIconGroup.style.display = 'none';
      }
      if (colorPicker) {
        colorPicker.style.display = 'none';
      }
      if (textIconInput) {
        textIconInput.value = '';
      }
    }

    UI.toggleModal(true, true);
  },

  async save() {
    const siteName = Utils.getElement('siteName');
    const siteUrl = Utils.getElement('siteUrl');
    const siteIcon = Utils.getElement('siteIcon');
    const textIconInput = Utils.getElement('textIconInput');

    if (!siteName || !siteUrl) return;

    const name = siteName.value.trim();
    const url = siteUrl.value.trim();
    const icon = siteIcon ? siteIcon.value.trim() : '';
    const textIconValue = textIconInput ? textIconInput.value.trim() : '';

    if (!name || !url) {
      Toast.warning('请填写网站名称和地址');
      return;
    }

    const validUrl = Utils.validateUrl(url);
    if (!validUrl) {
      Toast.error('请输入有效的网址');
      return;
    }

    // 如果没有手动输入图标，使用 Google Favicon API
    let iconUrl = icon;
    if (!iconUrl) {
      iconUrl = Utils.getFaviconUrl(validUrl);
    }

    const shortcutData = {
      name,
      url: validUrl,
      icon: iconUrl
    };
    
    // 🔑 关键修复：确保新增的快捷方式有唯一 ID
    Utils.ensureShortcutId(shortcutData);
    
    // 检查是否使用了文字图标
    const isTextIcon = textIconValue && icon && icon.startsWith('data:image/svg+xml;base64,');

    // 判断是否在编辑分组内的快捷方式
    if (State.editingFolderItemIndex >= 0 && State.editingIndex >= 0) {
      const folder = State.shortcuts[State.editingIndex];
      if (folder && folder.type === 'folder') {
        folder.items[State.editingFolderItemIndex] = shortcutData;
        
        // 🔑 关键：确保分组内的项目也有唯一 ID
        Utils.ensureShortcutId(folder.items[State.editingFolderItemIndex]);
        
        // 🔑 关键：保存当前编辑的 folderIndex，因为重新渲染可能改变它
        const currentFolderIndex = State.editingIndex;
        
        await Storage.saveShortcuts();
        UI.renderShortcuts();
        UI.toggleModal(false);
        
        // 重置编辑状态
        State.editingFolderItemIndex = -1;
        
        // 🔑 关键：使用保存的 folderIndex 重新打开分组，确保引用正确的分组
        const updatedFolder = State.shortcuts[currentFolderIndex];
        if (updatedFolder && updatedFolder.type === 'folder') {
          State.editingIndex = currentFolderIndex;
          UI.renderFolderContent(updatedFolder);
        }
        
        // 如果使用了文字图标，显示提示
        if (isTextIcon) {
          Toast.success('文字图标已生成');
        }
        return;
      }
    }

    if (State.editingIndex >= 0) {
      // 编辑模式(编辑主列表的快捷方式)
      State.shortcuts[State.editingIndex] = shortcutData;
      // 🔑 关键修复：确保编辑的快捷方式也有唯一 ID
      Utils.ensureShortcutId(State.shortcuts[State.editingIndex]);
    } else {
      // 添加模式
      State.shortcuts.push(shortcutData);
      // 🔑 关键修复：确保新增的快捷方式有唯一 ID（虽然上面已经添加了，但双重保险）
      Utils.ensureShortcutId(shortcutData);
    }

    await Storage.saveShortcuts();
    UI.renderShortcuts();
    UI.toggleModal(false);
    
    // 如果使用了文字图标，显示提示
    if (isTextIcon) {
      Toast.success('文字图标已生成');
    }
  },

  async delete(index) {
    // 保存删除的快捷方式数据
    const deletedShortcut = { ...State.shortcuts[index] };
    
    // 判断类型
    const isFolder = deletedShortcut.type === 'folder';
    const typeName = isFolder ? '分组' : '图标';

    // 删除快捷方式
    State.shortcuts.splice(index, 1);
    await Storage.saveShortcuts();
    UI.renderShortcuts();

    // 显示撤回提示
    Utils.showUndoToast(`已删除${typeName}「${deletedShortcut.name}」`, async () => {
      // 恢复快捷方式
      State.shortcuts.splice(index, 0, deletedShortcut);
      await Storage.saveShortcuts();
      UI.renderShortcuts();
    });
  },

  // 显示移入分组的模态框
  showMoveIntoFolderModal(index) {
    const shortcut = State.shortcuts[index];
    if (!shortcut) return;
    
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'modal move-folder-modal active';
    modal.style.display = 'flex';
    
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.width = '280px';
    content.style.maxHeight = '70vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    
    // 标题
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.justifyContent = 'center';
    header.innerHTML = `
      <h3 style="text-align: center;">移入：</h3>
    `;
    
    // 分组列表
    const foldersList = document.createElement('div');
    foldersList.style.flex = '1';
    foldersList.style.overflowY = 'auto';
    foldersList.style.padding = '0 20px 20px';
    foldersList.style.marginTop = '12px';
    
    // 获取所有分组
    State.shortcuts.forEach((item, idx) => {
      if (item.type !== 'folder') return;
      
      const folderItem = document.createElement('div');
      folderItem.className = 'folder-select-item';
      folderItem.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: rgba(255, 255, 255, 0.85);
        font-size: 14px;
        text-align: center;
      `;
      folderItem.textContent = item.name;
      
      folderItem.addEventListener('mouseenter', () => {
        folderItem.style.background = 'rgba(66, 133, 244, 0.15)';
        folderItem.style.borderColor = 'rgba(66, 133, 244, 0.4)';
        folderItem.style.color = 'rgba(66, 133, 244, 1)';
      });
      
      folderItem.addEventListener('mouseleave', () => {
        folderItem.style.background = 'rgba(255, 255, 255, 0.05)';
        folderItem.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        folderItem.style.color = 'rgba(255, 255, 255, 0.85)';
      });
      
      folderItem.addEventListener('click', () => {
        this.moveIntoFolder(index, idx);
        modal.remove();
      });
      
      foldersList.appendChild(folderItem);
    });
    
    content.appendChild(header);
    content.appendChild(foldersList);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // 点击外部关闭（防止从输入框拖拽到外部时关闭）
    let mouseDownInside = false;
    
    // 记录鼠标按下时的位置
    modal.addEventListener('mousedown', (e) => {
      // 检查点击是否在模态框内容区域
      if (content.contains(e.target)) {
        mouseDownInside = true;
      } else {
        mouseDownInside = false;
      }
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        // 如果是从模态框内容内开始拖拽到外部，不关闭
        if (mouseDownInside) {
          mouseDownInside = false; // 重置状态
          return;
        }
        modal.remove();
      }
    });
  },

  // 移入图标到指定分组
  async moveIntoFolder(shortcutIndex, folderIndex) {
    const shortcut = State.shortcuts[shortcutIndex];
    const folder = State.shortcuts[folderIndex];
    
    if (!shortcut || !folder || folder.type !== 'folder') return;
    
    // 添加到分组
    if (!folder.items) {
      folder.items = [];
    }
    folder.items.push({ ...shortcut });
    
    // 从主列表移除
    State.shortcuts.splice(shortcutIndex, 1);
    
    // 保存并更新显示
    await Storage.saveShortcuts();
    UI.renderShortcuts();
    
    // 移入后不显示撤回提示
  },

  // 显示移动到页面的模态框
  showMoveToTabModal(index) {
    const shortcut = State.shortcuts[index];
    if (!shortcut) return;
    
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'modal move-tab-modal active';
    modal.style.display = 'flex';
    
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.width = '280px';
    content.style.maxHeight = '70vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    
    // 标题
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.justifyContent = 'center';
    header.innerHTML = `
      <h3 style="text-align: center;">移动到：</h3>
    `;
    
    // 标签页列表
    const tabsList = document.createElement('div');
    tabsList.style.flex = '1';
    tabsList.style.overflowY = 'auto';
    tabsList.style.padding = '0 20px 20px';
    tabsList.style.marginTop = '12px';
    
    State.tabs.forEach(tab => {
      if (tab.id === State.currentTabId) return; // 跳过当前标签页
      
      const tabItem = document.createElement('div');
      tabItem.className = 'tab-select-item';
      tabItem.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: rgba(255, 255, 255, 0.85);
        font-size: 14px;
        text-align: center;
      `;
      tabItem.textContent = tab.name;
      
      tabItem.addEventListener('mouseenter', () => {
        tabItem.style.background = 'rgba(66, 133, 244, 0.15)';
        tabItem.style.borderColor = 'rgba(66, 133, 244, 0.4)';
        tabItem.style.color = 'rgba(66, 133, 244, 1)';
      });
      
      tabItem.addEventListener('mouseleave', () => {
        tabItem.style.background = 'rgba(255, 255, 255, 0.05)';
        tabItem.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        tabItem.style.color = 'rgba(255, 255, 255, 0.85)';
      });
      
      tabItem.addEventListener('click', () => {
        this.moveToTab(index, tab.id);
        modal.remove();
      });
      
      tabsList.appendChild(tabItem);
    });
    
    content.appendChild(header);
    content.appendChild(tabsList);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // 点击外部关闭（防止从输入框拖拽到外部时关闭）
    let mouseDownInside = false;
    
    // 记录鼠标按下时的位置
    modal.addEventListener('mousedown', (e) => {
      // 检查点击是否在模态框内容区域
      if (content.contains(e.target)) {
        mouseDownInside = true;
      } else {
        mouseDownInside = false;
      }
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        // 如果是从模态框内容内开始拖拽到外部，不关闭
        if (mouseDownInside) {
          mouseDownInside = false; // 重置状态
          return;
        }
        modal.remove();
      }
    });
  },

  // 移动图标/分组到指定标签页
  async moveToTab(index, targetTabId) {
    const shortcut = State.shortcuts[index];
    if (!shortcut) return;
    
    // 从当前标签页移除
    State.shortcuts.splice(index, 1);
    
    // 🔑 关键修复：先同步当前标签页的 shortcuts 到 State.tabs
    const currentTab = State.tabs.find(t => t.id === State.currentTabId);
    if (currentTab) {
      currentTab.shortcuts = JSON.parse(JSON.stringify(State.shortcuts));
    }
    
    // 添加到目标标签页
    const targetTab = State.tabs.find(t => t.id === targetTabId);
    if (targetTab) {
      if (!targetTab.shortcuts) {
        targetTab.shortcuts = [];
      }
      targetTab.shortcuts.push({ ...shortcut });
    }
    
    // 保存并更新显示
    await Storage.saveTabs();
    UI.renderShortcuts();
  },

  showContextMenu(index, event) {
    const shortcut = State.shortcuts[index];
    if (!shortcut) return;

    // 创建自定义右键菜单
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

    // 分组和普通快捷方式的菜单
    // 只有多个标签页时才显示"移动"选项
    const showMove = State.tabs.length > 1;
    // 只有普通图标且存在分组时才显示"移入"选项
    const hasFolders = State.shortcuts.some(s => s.type === 'folder');
    const showMoveIn = shortcut.type !== 'folder' && hasFolders;
    
    menu.innerHTML = `
      <div class="context-menu-item" data-action="edit">
        <span>✏️</span>编辑
      </div>
      ${showMoveIn ? `
      <div class="context-menu-item" data-action="movein">
        <span>📥</span>移入
      </div>
      ` : ''}
      ${showMove ? `
      <div class="context-menu-item" data-action="move">
        <span>📋</span>移动
      </div>
      ` : ''}
      <div class="context-menu-item context-menu-item-danger" data-action="delete">
        <span>🗑️</span>删除
      </div>
    `;

    document.body.appendChild(menu);

    // 点击菜单项
    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      if (action === 'edit') {
        // 根据类型调用不同的编辑方法
        if (shortcut.type === 'folder') {
          this.editFolderName(index);
        } else {
          this.edit(index);
        }
      } else if (action === 'movein') {
        this.showMoveIntoFolderModal(index);
      } else if (action === 'move') {
        this.showMoveToTabModal(index);
      } else if (action === 'delete') {
        this.delete(index);
      }

      menu.remove();
    });

    // 点击其他地方关闭菜单
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  // 拖拽开始
  handleDragStart(e, index) {
    dragHandler.handleDragStart(e, index, State.shortcuts);
  },

  // 拖拽经过
  handleDragOver(e, index) {
    const container = document.getElementById('shortcutsGrid');
    dragHandler.handleDragOver(e, index, State.shortcuts, container);
  },

  // 拖拽离开
  handleDragLeave(e) {
    dragHandler.handleDragLeave(e);
  },

  // 放置
  async handleDrop(e, targetIndex) {
    const result = dragHandler.handleDrop(e);
    
    if (!result.dropTarget) {
      // 🔑 关键修复：即使没有明确的 dropTarget，也要更新顺序
      this.updateShortcutsFromDOM();
      await Storage.saveShortcuts();
      Logger.debug('Shortcuts reordered (no dropTarget)');
      return;
    }
    
    const { draggedIndex, dropTarget } = result;
    const action = dropTarget.action;
    
    // 根据不同的动作处理
    if (action === 'reorder') {
      // 🔑 关键修复：直接根据 DOM 顺序更新数组（使用唯一 ID）
      const updateSuccess = this.updateShortcutsFromDOM();
      
      if (!updateSuccess) {
        Logger.error('Failed to update shortcuts from DOM');
        return;
      }
      
      // 🔑 关键修复：验证更新后的顺序是否正确
      if (State.shortcuts.length > 0) {
        Logger.debug('After reorder, shortcuts count:', State.shortcuts.length);
        Logger.debug('First shortcut name:', State.shortcuts[0]?.name);
        Logger.debug('State.shortcuts IDs:', State.shortcuts.map(s => s._id).join(', '));
        
        // 🔑 关键修复：保存到存储
        const saved = await Storage.saveShortcuts();
        if (saved) {
          Logger.debug('Shortcuts reordered and saved successfully');
          
          // 🔑 关键修复：立即验证保存的数据
          const verifyResult = await chrome.storage.local.get(['tabs']);
          if (verifyResult.tabs) {
            const currentTab = verifyResult.tabs.find(t => t.id === State.currentTabId);
            if (currentTab && currentTab.shortcuts) {
              Logger.debug('Verified saved shortcuts count:', currentTab.shortcuts.length);
              Logger.debug('Verified first shortcut name:', currentTab.shortcuts[0]?.name);
              Logger.debug('Verified shortcuts IDs:', currentTab.shortcuts.map(s => s._id).join(', '));
              
              // 验证顺序是否一致
              const orderMatches = State.shortcuts.every((s, i) => {
                return s._id === currentTab.shortcuts[i]?._id;
              });
              if (!orderMatches) {
                Logger.error('Order mismatch between State and saved data!');
                Logger.error('State order:', State.shortcuts.map(s => s.name).join(', '));
                Logger.error('Saved order:', currentTab.shortcuts.map(s => s.name).join(', '));
              } else {
                Logger.debug('✅ Order verified correctly!');
              }
            }
          }
        } else {
          Logger.error('Failed to save shortcuts');
        }
      } else {
        Logger.error('State.shortcuts is empty after reorder');
      }
      
      // 不调用 UI.renderShortcuts()，保持DOM不变，但确保数据已保存
      
    } else if (action === 'addToFolder') {
      // 使用对象引用而不是索引来查找
      const draggedShortcut = result.draggedShortcut;
      const targetShortcut = dropTarget.targetShortcut;
      
      // 确保目标是分组，拖拽的不是分组
      if (!draggedShortcut || draggedShortcut.type === 'folder' || 
          !targetShortcut || targetShortcut.type !== 'folder') {
        return;
      }
      
      // 在 State.shortcuts 中找到这两个对象的索引
      const draggedIdx = State.shortcuts.indexOf(draggedShortcut);
      const targetIdx = State.shortcuts.indexOf(targetShortcut);
      
      if (draggedIdx === -1 || targetIdx === -1) {
        Logger.error('无法找到拖拽或目标对象');
        return;
      }
      
      // 添加到分组（创建副本，避免引用问题）
      targetShortcut.items.push({ ...draggedShortcut });
      
      // 从主列表移除
      State.shortcuts.splice(draggedIdx, 1);
      
      await Storage.saveShortcuts();
      UI.renderShortcuts();
      
    } else if (action === 'createFolder') {
      // 使用对象引用而不是索引来查找
      const draggedShortcut = result.draggedShortcut;
      const targetShortcut = dropTarget.targetShortcut;
      
      // 确保两个都是普通快捷方式
      if (!draggedShortcut || draggedShortcut.type === 'folder' || 
          !targetShortcut || targetShortcut.type === 'folder') {
        return;
      }
      
      // 🔑 关键：先从 DOM 同步顺序到 State，确保使用最新的排列
      this.updateShortcutsFromDOM();
      
      // 现在在更新后的 State.shortcuts 中查找索引
      const draggedIdx = State.shortcuts.indexOf(draggedShortcut);
      const targetIdx = State.shortcuts.indexOf(targetShortcut);
      
      if (draggedIdx === -1 || targetIdx === -1) {
        Logger.error('无法找到拖拽或目标对象');
        return;
      }
      
      // 创建新分组
      const newFolder = {
        type: 'folder',
        name: Utils.getNextFolderName(),
        items: [
          { ...targetShortcut },
          { ...draggedShortcut }
        ]
      };
      
      // 确定新分组应该放在哪个位置（两个图标中较前的位置）
      const folderPosition = Math.min(draggedIdx, targetIdx);
      
      // 先移除两个原始图标（从后往前删，避免索引偏移）
      const maxIdx = Math.max(draggedIdx, targetIdx);
      const minIdx = Math.min(draggedIdx, targetIdx);
      State.shortcuts.splice(maxIdx, 1);  // 先删除后面的
      State.shortcuts.splice(minIdx, 1);  // 再删除前面的
      
      // 在原来较前的位置插入新分组
      State.shortcuts.splice(folderPosition, 0, newFolder);
      
      await Storage.saveShortcuts();
      UI.renderShortcuts();
    }
  },
  
  // 从DOM更新shortcuts数组顺序
  updateShortcutsFromDOM() {
    try {
      const container = document.getElementById('shortcutsGrid');
      if (!container) {
        Logger.warn('Container not found');
        return;
      }
      
      const items = Array.from(container.children);
      if (items.length === 0) {
        Logger.warn('No items in container');
        return;
      }
      
      if (!State.shortcuts || !Array.isArray(State.shortcuts)) {
        Logger.error('State.shortcuts is not valid, initializing to empty array');
        State.shortcuts = [];
        return;
      }
      
      // 🔑 关键修复：使用唯一 ID 来重建数组顺序
      // 创建 ID 到快捷方式的映射
      const idMap = new Map();
      State.shortcuts.forEach((shortcut) => {
        const id = Utils.ensureShortcutId(shortcut);
        idMap.set(id, shortcut);
      });
      
      Logger.debug('Before updateShortcutsFromDOM:', {
        shortcutsCount: State.shortcuts.length,
        idMapSize: idMap.size,
        domItemsCount: items.filter(item => !item.classList.contains('shortcut-add-btn')).length
      });
      
      const newShortcuts = [];
      const usedIds = new Set(); // 防止重复
      const missingIds = []; // 记录缺失的 ID
      
      // 🔑 关键：根据 DOM 中元素的顺序重建数组
      items.forEach((item, domIndex) => {
        // 跳过"新增"按钮等特殊元素
        if (item.classList.contains('shortcut-add-btn')) {
          return;
        }
        
        // 🔑 关键：使用 shortcutId 来找到对应的快捷方式对象
        const shortcutId = item.dataset.shortcutId;
        if (!shortcutId) {
          Logger.warn('Item missing shortcutId at DOM index', domIndex, item);
          missingIds.push(domIndex);
          return;
        }
        
        if (idMap.has(shortcutId) && !usedIds.has(shortcutId)) {
          const shortcut = idMap.get(shortcutId);
          newShortcuts.push(shortcut);
          usedIds.add(shortcutId);
          
          // 更新 dataset.index 为新的位置
          item.dataset.index = (newShortcuts.length - 1).toString();
        } else {
          Logger.warn('Invalid shortcutId or already used', {
            shortcutId,
            hasId: idMap.has(shortcutId),
            used: usedIds.has(shortcutId),
            domIndex
          });
          missingIds.push(domIndex);
        }
      });
      
      // 🔑 关键：只有当新数组的长度等于原数组长度时才更新
      if (newShortcuts.length === State.shortcuts.length) {
        // 直接替换数组，保持对象引用不变
        State.shortcuts.length = 0;
        State.shortcuts.push(...newShortcuts);
        Logger.debug('Shortcuts order updated from DOM using IDs:', newShortcuts.length, 'items');
        Logger.debug('New order:', newShortcuts.map(s => `${s.name}(${s._id})`).join(', '));
        return true; // 返回成功
      } else {
        Logger.error('Shortcuts count mismatch, keeping original', {
          newCount: newShortcuts.length,
          originalCount: State.shortcuts.length,
          missingIds: missingIds,
          missingIdsFromMap: Array.from(idMap.keys()).filter(id => !usedIds.has(id))
        });
        return false; // 返回失败
      }
    } catch (error) {
      Logger.error('Error in updateShortcutsFromDOM:', error);
      return false;
    }
  },

  // 拖拽结束
  async handleDragEnd(e) {
    dragHandler.handleDragEnd();
    
    // 🔑 关键修复：在拖拽结束时，如果 DOM 顺序改变了，也要保存
    // 这样可以确保即使 drop 事件没有正确触发，顺序也能被保存
    try {
      const container = document.getElementById('shortcutsGrid');
      if (container) {
        const items = Array.from(container.children);
        const domShortcuts = items
          .filter(item => !item.classList.contains('shortcut-add-btn'))
          .map(item => item.dataset.shortcutId)
          .filter(id => id);
        
        const stateIds = State.shortcuts.map(s => Utils.ensureShortcutId(s));
        
        // 检查 DOM 顺序是否和 State 顺序不同
        const orderChanged = domShortcuts.length === stateIds.length && 
          domShortcuts.some((id, index) => id !== stateIds[index]);
        
        if (orderChanged) {
          Logger.debug('Order changed detected in dragend, updating...');
          this.updateShortcutsFromDOM();
          await Storage.saveShortcuts();
        }
      }
    } catch (error) {
      Logger.error('Error in handleDragEnd:', error);
    }
  },

  // 打开分组
  openFolder(index) {
    const folder = State.shortcuts[index];
    if (!folder || folder.type !== 'folder') return;
    
    State.editingIndex = index;
    UI.toggleFolderModal(true, folder);
  },

  // 重命名分组
  // 内联编辑分组名称（主界面）
  editFolderName(index) {
    const folder = State.shortcuts[index];
    if (!folder || folder.type !== 'folder') return;
    
    // 找到分组的名称元素
    const shortcutItems = document.querySelectorAll('.shortcut-item');
    const folderItem = shortcutItems[index];
    if (!folderItem) return;
    
    const nameElement = folderItem.querySelector('.shortcut-name');
    if (!nameElement) return;
    
    // 保存原始文本
    const originalText = nameElement.textContent;
    
    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalText;
    input.className = 'inline-edit-input';
    input.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(66, 133, 244, 0.5);
      border-radius: 4px;
      padding: 2px 6px;
      color: rgba(255, 255, 255, 0.95);
      font-size: inherit;
      text-align: center;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    `;
    
    // 替换文本为输入框
    nameElement.textContent = '';
    nameElement.appendChild(input);
    input.focus();
    input.select();
    
    // 保存函数
    const save = async () => {
      const newName = input.value.trim();
      if (newName && newName !== originalText) {
        folder.name = newName;
        await Storage.saveShortcuts();
        UI.renderShortcuts();
      } else {
        nameElement.textContent = originalText;
      }
    };
    
    // 取消函数
    const cancel = () => {
      nameElement.textContent = originalText;
    };
    
    // 回车保存
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    
    // 失去焦点保存
    input.addEventListener('blur', save);
  },

  renameFolder(index) {
    const folder = State.shortcuts[index];
    if (!folder || folder.type !== 'folder') return;
    
    const newName = prompt('请输入分组名称:', folder.name);
    if (newName && newName.trim()) {
      folder.name = newName.trim();
      Storage.saveShortcuts();
      UI.renderShortcuts();
    }
  },

  // 在弹窗中重命名分组(直接编辑)
  renameFolderInModal(index) {
    const folder = State.shortcuts[index];
    if (!folder || folder.type !== 'folder') return;
    
    const folderNameEl = Utils.getElement('folderName');
    if (!folderNameEl) return;
    
    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.value = folder.name;
    input.className = 'folder-name-input';
    input.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      padding: 4px 12px;
      color: rgba(255, 255, 255, 0.95);
      font-size: inherit;
      font-weight: inherit;
      outline: none;
      width: 200px;
      text-align: center;
    `;
    
    // 替换标题
    const originalText = folderNameEl.textContent;
    folderNameEl.textContent = '';
    folderNameEl.appendChild(input);
    
    // 聚焦并选中
    input.focus();
    input.select();
    
    // 保存函数
    const save = async () => {
      const newName = input.value.trim();
      if (newName && newName !== folder.name) {
        folder.name = newName;
        await Storage.saveShortcuts();
        UI.renderShortcuts();
      }
      folderNameEl.textContent = folder.name;
      folderNameEl.style.cursor = 'pointer';
    };
    
    // 取消函数
    const cancel = () => {
      folderNameEl.textContent = originalText;
      folderNameEl.style.cursor = 'pointer';
    };
    
    // 回车保存
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    
    // 失去焦点保存
    input.addEventListener('blur', save);
  },

  // 从分组内拖拽开始
  handleFolderItemDragStart(e, folderIndex, itemIndex) {
    const folder = State.shortcuts[folderIndex];
    if (!folder || folder.type !== 'folder') return;
    
    State.draggedItem = {
      type: 'folderItem',
      folderIndex: folderIndex,
      itemIndex: itemIndex,
      item: folder.items[itemIndex]
    };
    
    const draggedElement = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    
    // iOS 风格：创建只包含图标的拖拽图像
    try {
      const ghost = document.createElement('div');
      const iconElement = draggedElement.querySelector('.folder-shortcut-icon');
      
      if (iconElement) {
        const iconClone = iconElement.cloneNode(true);
        ghost.appendChild(iconClone);
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.width = '56px';
        ghost.style.height = '56px';
        ghost.style.opacity = '0.85';
        ghost.style.pointerEvents = 'none';
        document.body.appendChild(ghost);
        
        e.dataTransfer.setDragImage(ghost, 28, 28);
        
        setTimeout(() => {
          if (ghost.parentNode) {
            document.body.removeChild(ghost);
          }
        }, 0);
      }
    } catch (err) {
      Logger.debug('Custom drag image failed:', err);
    }
    
    // 使用 setTimeout 延迟添加 dragging 类，避免阻止后续事件
    setTimeout(() => {
      if (draggedElement) {
        draggedElement.classList.add('dragging');
      }
    }, 0);
  },

  // 从分组内拖拽结束
  async handleFolderItemDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    
    // 重置位置缓存
    State.lastFolderMovePosition = null;
    
    // 🔑 关键修复：在拖拽结束时，如果 DOM 顺序改变了，也要保存
    // 这样可以确保即使 drop 事件没有正确触发，顺序也能被保存
    if (State.draggedItem && State.draggedItem.type === 'folderItem') {
      const folderIndex = State.draggedItem.folderIndex;
      const folder = State.shortcuts[folderIndex];
      
      if (folder && folder.type === 'folder') {
        try {
          const folderGrid = document.getElementById('folderGrid');
          if (folderGrid) {
            const items = Array.from(folderGrid.children);
            const domItemIds = items
              .map(element => element.dataset.itemId)
              .filter(id => id);
            
            const folderItemIds = folder.items.map(item => Utils.ensureShortcutId(item));
            
            // 检查 DOM 顺序是否和 folder.items 顺序不同
            const orderChanged = domItemIds.length === folderItemIds.length && 
              domItemIds.some((id, index) => id !== folderItemIds[index]);
            
            if (orderChanged) {
              Logger.debug('Folder item order changed detected in dragend, updating...');
              
              // 使用唯一 ID 来重建数组
              const idMap = new Map();
              folder.items.forEach((item) => {
                const id = Utils.ensureShortcutId(item);
                idMap.set(id, item);
              });
              
              const newOrder = [];
              const usedIds = new Set();
              
              items.forEach((element) => {
                const itemId = element.dataset.itemId;
                if (itemId && idMap.has(itemId) && !usedIds.has(itemId)) {
                  const item = idMap.get(itemId);
                  newOrder.push(item);
                  usedIds.add(itemId);
                  element.dataset.itemIndex = (newOrder.length - 1).toString();
                }
              });
              
              if (newOrder.length === folder.items.length) {
                folder.items = newOrder;
                await Storage.saveShortcuts();
                
                // 🔑 关键修复：更新主列表中分组图标显示（前4个图标）
                UI.renderShortcuts();
                
                // 🔑 关键修复：如果分组弹窗打开着，也需要更新分组弹窗内的显示
                if (State.editingIndex === folderIndex) {
                  UI.renderFolderContent(folder);
                }
                
                Logger.debug('Folder items reordered and saved successfully');
              }
            }
          }
        } catch (error) {
          Logger.error('Error in handleFolderItemDragEnd:', error);
        }
      }
    }
    
    // 检查鼠标位置是否在分组弹窗外
    const folderModal = Utils.getElement('folderModal');
    const rect = folderModal?.querySelector('.modal-content')?.getBoundingClientRect();
    
    const isOutsideModal = !rect || 
      e.clientX < rect.left || 
      e.clientX > rect.right || 
      e.clientY < rect.top || 
      e.clientY > rect.bottom;
    
    // 如果拖拽到分组外面
    if (State.draggedItem && State.draggedItem.type === 'folderItem' && isOutsideModal) {
      const dragData = State.draggedItem;
      const folder = State.shortcuts[dragData.folderIndex];
      
      if (folder && folder.type === 'folder') {
        // 🔑 关键修复：使用唯一 ID 来查找要移除的项目，而不是使用索引
        // 因为在拖拽过程中，DOM 顺序可能已经改变，itemIndex 可能不准确
        const itemId = Utils.ensureShortcutId(dragData.item);
        const actualIndex = folder.items.findIndex(item => Utils.ensureShortcutId(item) === itemId);
        
        if (actualIndex === -1) {
          Logger.error('Cannot find item to remove from folder');
          State.draggedItem = null;
          return;
        }
        
        // 从分组中移除
        const item = folder.items.splice(actualIndex, 1)[0];
        
        // 🔑 关键修复：先添加到主列表末尾，再判断是否解散分组
        // 这样可以确保无论哪个分支，item 都不会丢失
        State.shortcuts.push(item);
        
        // 检查分组是否还有足够的项目
        const shouldDismissFolder = folder.items.length <= 1;
        
        if (shouldDismissFolder) {
          // 如果分组只剩1个或0个,解散分组
          const remainingItem = folder.items[0];
          if (remainingItem) {
            State.shortcuts[dragData.folderIndex] = remainingItem;
          } else {
            State.shortcuts.splice(dragData.folderIndex, 1);
          }
          
          // 关闭弹窗（因为分组已解散）
          UI.toggleFolderModal(false);
        } else {
          // 分组还有多个项目，保持弹窗打开，只刷新内容
          UI.renderFolderContent(folder);
        }
        
        // 保存并重新渲染主列表
        await Storage.saveShortcuts();
        UI.renderShortcuts();
      }
    }
    
    State.draggedItem = null;
  },

  // 分组内拖拽悬停
  handleFolderItemDragOver(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!State.draggedItem || State.draggedItem.type !== 'folderItem') return;
    
    // 获取所有分组内的图标
    const folderGrid = document.getElementById('folderGrid');
    if (!folderGrid) return;
    
    const items = Array.from(folderGrid.children);
    
    // 找到正在被拖拽的元素（带有 dragging 类）
    const draggedElement = items.find(item => item.classList.contains('dragging'));
    if (!draggedElement) return;
    
    // 找到鼠标悬停的目标元素（通过事件）
    const targetElement = e.currentTarget;
    if (!targetElement || targetElement === draggedElement) return;
    
    // 获取当前实际位置
    const currentIndex = items.indexOf(draggedElement);
    const actualTargetIndex = items.indexOf(targetElement);
    
    if (currentIndex === -1 || actualTargetIndex === -1) return;
    
    // 计算鼠标在目标元素的位置，决定插入前还是后
    const rect = targetElement.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // 判断是横向还是纵向网格
    const isHorizontalGrid = rect.width > rect.height || 
                             (actualTargetIndex > 0 && items[actualTargetIndex - 1] && 
                              items[actualTargetIndex - 1].getBoundingClientRect().top === rect.top);
    
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
    if (currentIndex === targetPosition) return;
    
    // 防止过于频繁的移动（使用上次移动的位置缓存）
    if (State.lastFolderMovePosition === targetPosition) return;
    State.lastFolderMovePosition = targetPosition;
    
    // 执行DOM移动
    if (insertBefore) {
      folderGrid.insertBefore(draggedElement, targetElement);
    } else {
      const nextElement = targetElement.nextSibling;
      if (nextElement && nextElement !== draggedElement) {
        folderGrid.insertBefore(draggedElement, nextElement);
      } else if (!nextElement) {
        folderGrid.appendChild(draggedElement);
      }
    }
  },

  // 分组内拖拽放下
  async handleFolderItemDrop(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!State.draggedItem || State.draggedItem.type !== 'folderItem') return;
    
    const folderIndex = State.draggedItem.folderIndex;
    const folder = State.shortcuts[folderIndex];
    
    if (!folder || folder.type !== 'folder') return;
    
    // 🔑 关键修复：根据最终的 DOM 顺序，使用唯一 ID 来重建数组
    const folderGrid = document.getElementById('folderGrid');
    if (folderGrid) {
      const items = Array.from(folderGrid.children);
      
      Logger.debug('Before handleFolderItemDrop:', {
        folderItemsCount: folder.items.length,
        domItemsCount: items.length
      });
      
      // 创建 ID 到项目的映射
      const idMap = new Map();
      folder.items.forEach((item) => {
        const id = Utils.ensureShortcutId(item);
        idMap.set(id, item);
      });
      
      const newOrder = [];
      const usedIds = new Set(); // 防止重复
      const missingIds = []; // 记录缺失的 ID
      
      // 根据 DOM 顺序重建数组
      items.forEach((element, domIndex) => {
        const itemId = element.dataset.itemId;
        if (!itemId) {
          Logger.warn('Folder item missing itemId at DOM index', domIndex);
          missingIds.push(domIndex);
          return;
        }
        
        if (idMap.has(itemId) && !usedIds.has(itemId)) {
          const item = idMap.get(itemId);
          newOrder.push(item);
          usedIds.add(itemId);
          
          // 更新 dataset.itemIndex 为新的索引
          element.dataset.itemIndex = (newOrder.length - 1).toString();
        } else {
          Logger.warn('Invalid itemId or already used', {
            itemId,
            hasId: idMap.has(itemId),
            used: usedIds.has(itemId),
            domIndex
          });
          missingIds.push(domIndex);
        }
      });
      
      // 只有当顺序真的改变了才更新
      if (newOrder.length === folder.items.length) {
        folder.items = newOrder;
        
        Logger.debug('Folder items reordered:', newOrder.map(item => `${item.name}(${item._id})`).join(', '));
        
        await Storage.saveShortcuts();
        
        // 🔑 关键修复：更新主列表中分组图标显示（前4个图标）
        UI.renderShortcuts();
        
        // 🔑 关键修复：如果分组弹窗打开着，也需要更新分组弹窗内的显示
        if (State.editingIndex === folderIndex) {
          UI.renderFolderContent(folder);
        }
        
        Logger.debug('Folder items saved successfully');
      } else {
        Logger.error('Folder items count mismatch', {
          newCount: newOrder.length,
          originalCount: folder.items.length,
          missingIds: missingIds
        });
      }
    }
  },

  // 编辑分组内的快捷方式
  editFolderItem(folderIndex, itemId) {
    const folder = State.shortcuts[folderIndex];
    if (!folder || folder.type !== 'folder') return;
    
    // 🔑 关键修复：使用 itemId 查找实际索引
    const itemIndex = folder.items.findIndex(item => Utils.ensureShortcutId(item) === itemId);
    if (itemIndex === -1) {
      Logger.error('Item not found with id:', itemId);
      return;
    }
    
    const item = folder.items[itemIndex];
    if (!item) return;
    
    // 设置编辑状态
    State.editingIndex = folderIndex;
    State.editingFolderItemIndex = itemIndex;
    
    const siteName = Utils.getElement('siteName');
    const siteUrl = Utils.getElement('siteUrl');
    const siteIcon = Utils.getElement('siteIcon');
    const textIconInput = Utils.getElement('textIconInput');
    const textIconGroup = Utils.getElement('textIconGroup');
    const colorPicker = Utils.getElement('textIconColorPicker');
    const colorGrid = Utils.getElement('textIconColorGrid');

    if (siteName) siteName.value = item.name;
    if (siteUrl) siteUrl.value = item.url;
    if (siteIcon) siteIcon.value = item.icon || '';
    
    // 检查是否是文字图标
    const textIconData = Utils.parseTextIcon(item.icon);
    if (textIconData) {
      // 显示文字图标输入框
      if (textIconGroup) {
        textIconGroup.style.display = 'block';
      }
      
      // 填充文字
      if (textIconInput) {
        textIconInput.value = textIconData.text;
      }
      
      // 显示颜色选择器
      if (colorPicker) {
        colorPicker.style.display = 'block';
      }
      
      // 初始化颜色选择器（如果还没有创建）
      if (colorGrid && colorGrid.children.length === 0) {
        const colors = Utils.getTextIconColors();
        colors.forEach((color) => {
          const colorBtn = document.createElement('button');
          colorBtn.type = 'button';
          colorBtn.className = 'text-icon-color-btn';
          colorBtn.style.backgroundColor = color;
          colorBtn.dataset.color = color;
          colorBtn.title = '点击选择此颜色';
          colorBtn.addEventListener('click', () => {
            colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
              btn.classList.remove('selected');
            });
            colorBtn.classList.add('selected');
            
            const currentText = textIconInput ? textIconInput.value.trim() : '';
            if (currentText.length > 0 && siteIcon) {
              const textIcon = Utils.generateTextIcon(currentText, color);
              if (textIcon) {
                siteIcon.value = textIcon;
              }
            }
          });
          colorGrid.appendChild(colorBtn);
        });
      }
      
      // 高亮当前使用的颜色
      if (textIconData.color && colorGrid) {
        colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
          btn.classList.remove('selected');
          if (btn.dataset.color === textIconData.color) {
            btn.classList.add('selected');
          }
        });
      }
    } else {
      // 不是文字图标，隐藏文字图标输入框
      if (textIconGroup) {
        textIconGroup.style.display = 'none';
      }
      if (colorPicker) {
        colorPicker.style.display = 'none';
      }
      if (textIconInput) {
        textIconInput.value = '';
      }
    }

    // 保持分组弹窗打开,直接在上层打开编辑弹窗
    UI.toggleModal(true, true);
  },

  // 从分组中移出快捷方式(不删除,而是移到主列表)
  async removeFromFolder(folderIndex, itemId) {
    const folder = State.shortcuts[folderIndex];
    if (!folder || folder.type !== 'folder') return;
    
    // 🔑 关键修复：使用 itemId 查找实际索引
    const itemIndex = folder.items.findIndex(item => Utils.ensureShortcutId(item) === itemId);
    if (itemIndex === -1) {
      Logger.error('Item not found with id:', itemId);
      return;
    }
    
    const removedItem = folder.items[itemIndex];
    
    // 从分组中移除
    folder.items.splice(itemIndex, 1);
    
    // 🔑 关键修复：先添加到主列表，再判断是否解散分组
    // 这样可以确保移出的项目不会丢失
    State.shortcuts.push(removedItem);
    
    // 如果分组只剩1个或0个,解散分组
    const shouldDismissFolder = folder.items.length <= 1;
    
    if (shouldDismissFolder) {
      const remainingItem = folder.items[0];
      if (remainingItem) {
        // 用剩余的单个快捷方式替换分组
        State.shortcuts[folderIndex] = remainingItem;
      } else {
        // 没有剩余项,删除分组
        State.shortcuts.splice(folderIndex, 1);
      }
      // 关闭弹窗并重置编辑状态
      State.editingIndex = -1;
      State.editingFolderItemIndex = -1;
      UI.toggleFolderModal(false);
    } else {
      // 🔑 关键：保持 editingIndex 正确，重新渲染分组内容
      State.editingIndex = folderIndex;
      UI.renderFolderContent(folder);
    }
    
    await Storage.saveShortcuts();
    UI.renderShortcuts();
    
    // 移出分组不显示撤回提示
  },

  // 显示移动分组内快捷方式到其他标签页的模态框
  showMoveFolderItemToTabModal(folderIndex, itemId) {
    // 🔑 关键优化：直接复用外部快捷方式的移动模态框逻辑
    // 创建一个包装函数，将分组内的移动操作适配到外部的移动函数
    this.showMoveToTabModalForFolderItem(folderIndex, itemId);
  },

  // 显示移动到标签页的模态框（适配分组内快捷方式）
  showMoveToTabModalForFolderItem(folderIndex, itemId) {
    const folder = State.shortcuts[folderIndex];
    if (!folder || folder.type !== 'folder') return;
    
    // 🔑 关键修复：使用 itemId 查找实际索引
    const itemIndex = folder.items.findIndex(item => Utils.ensureShortcutId(item) === itemId);
    if (itemIndex === -1) {
      Logger.error('Item not found with id:', itemId);
      return;
    }
    
    const item = folder.items[itemIndex];
    if (!item) return;

    // 🔑 关键：使用与外部快捷方式完全相同的样式
    const modal = document.createElement('div');
    modal.className = 'modal move-tab-modal active';
    modal.style.display = 'flex';
    
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.width = '280px';
    content.style.maxHeight = '70vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    
    // 标题
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.justifyContent = 'center';
    header.innerHTML = `
      <h3 style="text-align: center;">移动到：</h3>
    `;
    
    // 标签页列表
    const tabsList = document.createElement('div');
    tabsList.style.flex = '1';
    tabsList.style.overflowY = 'auto';
    tabsList.style.padding = '0 20px 20px';
    tabsList.style.marginTop = '12px';
    
    State.tabs.forEach(tab => {
      if (tab.id === State.currentTabId) return; // 跳过当前标签页
      
      const tabItem = document.createElement('div');
      tabItem.className = 'tab-select-item';
      tabItem.style.cssText = `
        padding: 12px 16px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: rgba(255, 255, 255, 0.85);
        font-size: 14px;
        text-align: center;
      `;
      tabItem.textContent = tab.name;
      
      tabItem.addEventListener('mouseenter', () => {
        tabItem.style.background = 'rgba(66, 133, 244, 0.15)';
        tabItem.style.borderColor = 'rgba(66, 133, 244, 0.4)';
        tabItem.style.color = 'rgba(66, 133, 244, 1)';
      });
      
      tabItem.addEventListener('mouseleave', () => {
        tabItem.style.background = 'rgba(255, 255, 255, 0.05)';
        tabItem.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        tabItem.style.color = 'rgba(255, 255, 255, 0.85)';
      });
      
      tabItem.addEventListener('click', () => {
        this.moveFolderItemToTab(folderIndex, itemId, tab.id);
        modal.remove();
      });
      
      tabsList.appendChild(tabItem);
    });
    
    content.appendChild(header);
    content.appendChild(tabsList);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // 点击外部关闭（防止从输入框拖拽到外部时关闭）
    let mouseDownInside = false;
    
    // 记录鼠标按下时的位置
    modal.addEventListener('mousedown', (e) => {
      // 检查点击是否在模态框内容区域
      if (content.contains(e.target)) {
        mouseDownInside = true;
      } else {
        mouseDownInside = false;
      }
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        // 如果是从模态框内容内开始拖拽到外部，不关闭
        if (mouseDownInside) {
          mouseDownInside = false; // 重置状态
          return;
        }
        modal.remove();
      }
    });
  },

  // 移动分组内快捷方式到指定标签页
  async moveFolderItemToTab(folderIndex, itemId, targetTabId) {
    const folder = State.shortcuts[folderIndex];
    if (!folder || folder.type !== 'folder') return;
    
    // 🔑 关键修复：使用 itemId 查找实际索引
    const itemIndex = folder.items.findIndex(item => Utils.ensureShortcutId(item) === itemId);
    if (itemIndex === -1) {
      Logger.error('Item not found with id:', itemId);
      return;
    }
    
    const item = folder.items[itemIndex];
    if (!item) return;
    
    // 从分组中移除
    folder.items.splice(itemIndex, 1);
    
    // 🔑 关键修复：判断是否需要解散分组（剩余 ≤ 1 个项目）
    const shouldDismissFolder = folder.items.length <= 1;
    
    if (shouldDismissFolder) {
      const remainingItem = folder.items[0];
      if (remainingItem) {
        // 用剩余的单个快捷方式替换分组
        State.shortcuts[folderIndex] = remainingItem;
      } else {
        // 没有剩余项,删除分组
        State.shortcuts.splice(folderIndex, 1);
      }
    }
    
    // 🔑 关键修复：先同步当前标签页的 shortcuts 到 State.tabs
    const currentTab = State.tabs.find(t => t.id === State.currentTabId);
    if (currentTab) {
      currentTab.shortcuts = JSON.parse(JSON.stringify(State.shortcuts));
    }
    
    // 添加到目标标签页
    const targetTab = State.tabs.find(t => t.id === targetTabId);
    if (targetTab) {
      if (!targetTab.shortcuts) {
        targetTab.shortcuts = [];
      }
      targetTab.shortcuts.push({ ...item });
    }
    
    // 保存并更新显示
    await Storage.saveTabs();
    
    // 如果分组被解散，关闭分组弹窗
    if (shouldDismissFolder) {
      UI.toggleFolderModal(false);
    } else {
      // 否则重新渲染分组内容
      UI.renderFolderContent(folder);
    }
    
    UI.renderShortcuts();
  },

  // 从分组中删除快捷方式
  async deleteFromFolder(folderIndex, itemId) {
    const folder = State.shortcuts[folderIndex];
    if (!folder || folder.type !== 'folder') return;
    
    // 🔑 关键修复：使用 itemId 查找实际索引
    const itemIndex = folder.items.findIndex(item => Utils.ensureShortcutId(item) === itemId);
    if (itemIndex === -1) {
      Logger.error('Item not found with id:', itemId);
      return;
    }
    
    const deletedItem = folder.items[itemIndex];
    
    // 删除该项
    folder.items.splice(itemIndex, 1);
    
    // 如果分组只剩1个或0个,解散分组
    if (folder.items.length <= 1) {
      const remainingItem = folder.items[0];
      if (remainingItem) {
        // 用剩余的单个快捷方式替换分组
        State.shortcuts[folderIndex] = remainingItem;
      } else {
        // 没有剩余项,删除分组
        State.shortcuts.splice(folderIndex, 1);
      }
      // 关闭弹窗并重置编辑状态
      State.editingIndex = -1;
      State.editingFolderItemIndex = -1;
      UI.toggleFolderModal(false);
    } else {
      // 🔑 关键：保持 editingIndex 正确，重新渲染分组内容
      State.editingIndex = folderIndex;
      UI.renderFolderContent(folder);
    }
    
    await Storage.saveShortcuts();
    UI.renderShortcuts();
    
    // 显示撤回提示
    Utils.showUndoToast(`已删除图标「${deletedItem.name}」`, async () => {
      const currentFolder = State.shortcuts[folderIndex];
      if (currentFolder && currentFolder.type === 'folder') {
        currentFolder.items.splice(itemIndex, 0, deletedItem);
        await Storage.saveShortcuts();
        UI.renderShortcuts();
        setTimeout(() => this.openFolder(folderIndex), 100);
      }
    });
  }
};

// ==================== 搜索功能 ====================
const Search = {
  handle(query) {
    if (!query) return;

    query = query.trim();

    // 检查是否是完整的URL (包含协议)
    if (query.startsWith('http://') || query.startsWith('https://')) {
      window.location.href = query;
      return;
    }

    // 🔑 修复：更严格地判断域名格式
    // 只有当看起来像真正的域名时才跳转，而不是简单的"包含点且无空格"
    const looksLikeDomain = (str) => {
      // 如果包含空格，肯定不是域名
      if (str.includes(' ')) return false;
      
      // 如果以 www. 开头，可能是域名（但需要确保后面还有内容）
      if (str.startsWith('www.') && str.length > 4) return true;
      
      // 🔑 排除常见的编程语言文件扩展名（这些通常不是域名）
      const programmingExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.dart', '.vue', '.svelte', '.html', '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml', '.md', '.sh', '.bat', '.ps1', '.sql', '.r', '.m', '.pl', '.lua', '.scala', '.clj', '.hs', '.elm', '.ex', '.exs', '.erl', '.fs', '.fsx', '.vb', '.cs', '.d', '.nim', '.zig', '.v', '.cr', '.jl', '.cl', '.lisp', '.ml', '.mli', '.fsi', '.pas', '.p', '.ada', '.asm', '.s', '.sx', '.hpp', '.hxx', '.cxx', '.c++', '.h++', '.tpp', '.ipp', '.inl', '.idl', '.odl', '.def', '.rc', '.resx', '.xaml'];
      const lowerStr = str.toLowerCase();
      for (const ext of programmingExtensions) {
        if (lowerStr.endsWith(ext)) {
          return false; // 以编程语言扩展名结尾，不是域名
        }
      }
      
      // 使用正则表达式匹配域名格式：
      // - 包含字母、数字、连字符和点
      // - 以常见的顶级域名（TLD）结尾（2-6个字母）
      // - TLD 前面至少有一个字符
      // 匹配格式：xxx.xxx.xxx 或 xxx.xxx（其中最后一部分是 TLD）
      const domainPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,6}$/i;
      
      if (domainPattern.test(str)) {
        // 进一步验证：确保不是纯数字版本号（如 "1.2.3"）
        // 如果整个字符串都是数字和点，可能是版本号，不是域名
        if (/^[\d.]+$/.test(str)) {
          return false;
        }
        
        // 🔑 额外检查：确保TLD是有效的域名后缀
        // 提取最后一个点后的部分（TLD）
        const tld = str.split('.').pop().toLowerCase();
        
        // 常见的有效TLD列表（主要TLD和国家代码）
        const validTlds = ['com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'me', 'info', 'xyz', 'dev', 'app', 'tech', 'online', 'site', 'website', 'store', 'shop', 'blog', 'news', 'tv', 'cc', 'top', 'vip', 'pro', 'biz', 'mobi', 'asia', 'name', 'tel', 'travel', 'jobs', 'cn', 'uk', 'us', 'de', 'fr', 'jp', 'kr', 'in', 'ru', 'br', 'au', 'ca', 'mx', 'es', 'it', 'nl', 'se', 'no', 'dk', 'fi', 'pl', 'ch', 'at', 'be', 'nz', 'sg', 'hk', 'tw', 'my', 'th', 'id', 'ph', 'vn', 'ae', 'sa', 'il', 'tr', 'gr', 'pt', 'ie', 'cz', 'hu', 'ro', 'bg', 'hr', 'sk', 'si', 'lt', 'lv', 'ee', 'lu', 'mt', 'cy', 'is', 'li', 'mc', 'ad', 'sm', 'va', 'by', 'ua', 'kz', 'uz', 'ge', 'am', 'az', 'kg', 'tj', 'tm', 'mn', 'af', 'pk', 'bd', 'lk', 'np', 'bt', 'mv', 'mm', 'kh', 'la', 'bn', 'tl', 'pg', 'fj', 'nc', 'pf', 'vu', 'sb', 'ki', 'nr', 'pw', 'fm', 'mh', 'ws', 'to', 'tv', 'ck', 'nu', 'tk', 'as', 'gu', 'mp', 'vi', 'pr', 'do', 'ht', 'jm', 'bb', 'tt', 'gd', 'lc', 'vc', 'ag', 'dm', 'kn', 'bs', 'bz', 'cr', 'pa', 'ni', 'hn', 'sv', 'gt', 'pe', 'ec', 'bo', 'py', 'uy', 'ar', 'cl', 'gf', 'sr', 'gy', 've'];
        
        // 如果TLD不在有效列表中，且长度很短（≤3个字符），很可能是编程语言扩展名
        if (!validTlds.includes(tld) && tld.length <= 3) {
          return false;
        }
        
        return true;
      }
      
      return false;
    };

    // 只有当看起来像真正的域名时才跳转
    if (looksLikeDomain(query)) {
      window.location.href = `https://${query}`;
      return;
    }

    // 使用当前搜索引擎搜索
    const searchEngine = State.currentEngine || 'google';
    let searchUrl;
    
    if (searchEngine === 'custom') {
      // 使用自定义搜索引擎
      const customUrl = State.customEngineUrl || 'https://www.google.com/search?q=%s';
      searchUrl = customUrl.replace('%s', encodeURIComponent(query));
    } else {
      // 使用预设搜索引擎
      searchUrl = CONFIG.searchEngines[searchEngine] + encodeURIComponent(query);
    }
    
    window.location.href = searchUrl;
  }
};

// ==================== 数据备份管理 ====================
const BackupManager = {
  // 导出数据
  async exportData() {
    try {
      // 获取所有数据
      const allData = await chrome.storage.local.get(null);
      
      // 添加元数据
      const backupData = {
        version: '1.1.0',
        exportTime: new Date().toISOString(),
        data: allData
      };
      
      // 转换为 JSON
      const json = JSON.stringify(backupData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // 生成文件名：MiniTab_2024-10-31_15-30-45.json
      const now = new Date();
      const filename = `MiniTab_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.json`;
      
      // 创建下载链接
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      
      // 清理
      URL.revokeObjectURL(url);
      
      // 显示成功提示（使用统一的 Toast 系统）
      Toast.success('数据已导出');
      Logger.debug('Data exported successfully');
      
    } catch (error) {
      Logger.error('Export data error:', error);
      // 使用统一的 Toast 系统
      Toast.error('导出失败');
    }
  },
  
  // 显示导入方式选择对话框
  showImportModeDialog(backupData, validTabs) {
    return new Promise((resolve) => {
      // 创建模态框
      const modal = document.createElement('div');
      modal.className = 'modal import-mode-modal';
      modal.style.display = 'flex';
      
      const content = document.createElement('div');
      content.className = 'modal-content';
      content.style.maxWidth = '500px';
      
      const backupTime = backupData.exportTime ? new Date(backupData.exportTime).toLocaleString('zh-CN') : '未知';
      const tabsCount = validTabs.length;
      const shortcutsCount = validTabs.reduce((sum, tab) => sum + (tab.shortcuts?.length || 0), 0);
      const currentTabsCount = State.tabs.length;
      const currentShortcutsCount = State.tabs.reduce((sum, tab) => sum + (tab.shortcuts?.length || 0), 0);
      
      const header = document.createElement('div');
      header.className = 'modal-header';
      const title = document.createElement('h3');
      title.textContent = '恢复数据';
      header.appendChild(title);

      const body = document.createElement('div');
      body.className = 'modal-body';

      const backupInfo = document.createElement('div');
      backupInfo.style.marginBottom = '20px';
      const backupLabel = document.createElement('p');
      const backupStrong = document.createElement('strong');
      backupStrong.textContent = '备份信息：';
      backupLabel.appendChild(backupStrong);
      const backupTimeText = document.createElement('p');
      backupTimeText.textContent = `备份时间：${backupTime}`;
      const backupTabsText = document.createElement('p');
      backupTabsText.textContent = `标签页数量：${tabsCount}`;
      const backupShortcutsText = document.createElement('p');
      backupShortcutsText.textContent = `快捷方式总数：${shortcutsCount}`;
      backupInfo.appendChild(backupLabel);
      backupInfo.appendChild(backupTimeText);
      backupInfo.appendChild(backupTabsText);
      backupInfo.appendChild(backupShortcutsText);

      const currentInfo = document.createElement('div');
      currentInfo.style.marginBottom = '20px';
      const currentLabel = document.createElement('p');
      const currentStrong = document.createElement('strong');
      currentStrong.textContent = '当前数据：';
      currentLabel.appendChild(currentStrong);
      const currentTabsText = document.createElement('p');
      currentTabsText.textContent = `标签页数量：${currentTabsCount}`;
      const currentShortcutsText = document.createElement('p');
      currentShortcutsText.textContent = `快捷方式总数：${currentShortcutsCount}`;
      currentInfo.appendChild(currentLabel);
      currentInfo.appendChild(currentTabsText);
      currentInfo.appendChild(currentShortcutsText);

      const modePrompt = document.createElement('div');
      modePrompt.style.marginBottom = '20px';
      const modeLabel = document.createElement('p');
      const modeStrong = document.createElement('strong');
      modeStrong.textContent = '请选择导入方式：';
      modeLabel.appendChild(modeStrong);
      modePrompt.appendChild(modeLabel);

      const modeList = document.createElement('div');
      modeList.style.display = 'flex';
      modeList.style.gap = '12px';
      modeList.style.flexDirection = 'column';

      const replaceBtn = document.createElement('button');
      replaceBtn.className = 'btn btn-secondary import-mode-btn';
      replaceBtn.dataset.mode = 'replace';
      replaceBtn.style.justifyContent = 'flex-start';
      replaceBtn.style.textAlign = 'left';
      const replaceTitle = document.createElement('div');
      replaceTitle.textContent = '覆盖现有数据';
      replaceTitle.style.fontWeight = '600';
      replaceTitle.style.marginBottom = '4px';
      const replaceDesc = document.createElement('div');
      replaceDesc.textContent = '删除所有现有数据，用备份数据替换';
      replaceDesc.style.fontSize = '12px';
      replaceDesc.style.opacity = '0.8';
      replaceBtn.appendChild(replaceTitle);
      replaceBtn.appendChild(replaceDesc);

      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'btn btn-secondary import-mode-btn';
      mergeBtn.dataset.mode = 'merge';
      mergeBtn.style.justifyContent = 'flex-start';
      mergeBtn.style.textAlign = 'left';
      const mergeTitle = document.createElement('div');
      mergeTitle.textContent = '合并到现有数据';
      mergeTitle.style.fontWeight = '600';
      mergeTitle.style.marginBottom = '4px';
      const mergeDesc = document.createElement('div');
      mergeDesc.textContent = '将备份数据追加到现有数据后面';
      mergeDesc.style.fontSize = '12px';
      mergeDesc.style.opacity = '0.8';
      mergeBtn.appendChild(mergeTitle);
      mergeBtn.appendChild(mergeDesc);

      modeList.appendChild(replaceBtn);
      modeList.appendChild(mergeBtn);

      body.appendChild(backupInfo);
      body.appendChild(currentInfo);
      body.appendChild(modePrompt);
      body.appendChild(modeList);

      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      const cancelBtnEl = document.createElement('button');
      cancelBtnEl.className = 'btn btn-secondary';
      cancelBtnEl.id = 'cancelImportBtn';
      cancelBtnEl.textContent = '取消';
      const confirmBtnEl = document.createElement('button');
      confirmBtnEl.className = 'btn btn-primary';
      confirmBtnEl.id = 'confirmImportBtn';
      confirmBtnEl.disabled = true;
      confirmBtnEl.textContent = '确定';
      footer.appendChild(cancelBtnEl);
      footer.appendChild(confirmBtnEl);

      content.appendChild(header);
      content.appendChild(body);
      content.appendChild(footer);
      
      modal.appendChild(content);
      document.body.appendChild(modal);
      
      let selectedMode = null;
      const confirmBtn = content.querySelector('#confirmImportBtn');
      const cancelBtn = content.querySelector('#cancelImportBtn');
      
      if (!confirmBtn || !cancelBtn) {
        Logger.error('Import dialog buttons not found');
        modal.remove();
        resolve(null);
        return;
      }
      
      // 点击背景关闭
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
          resolve(null);
        }
      });
      
      // 取消按钮
      cancelBtn.addEventListener('click', () => {
        modal.remove();
        resolve(null);
      });
      
      // 选择导入方式
      const modeButtons = content.querySelectorAll('.import-mode-btn');
      modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          // 移除所有按钮的选中状态
          modeButtons.forEach(b => {
            b.classList.remove('btn-primary');
            b.classList.add('btn-secondary');
          });
          
          // 选中当前按钮
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
          
          // 保存选中的模式
          selectedMode = btn.dataset.mode;
          
          // 启用确定按钮
          if (confirmBtn) {
            confirmBtn.disabled = false;
          }
        });
      });
      
      // 确定按钮
      confirmBtn.addEventListener('click', () => {
        if (selectedMode) {
          modal.remove();
          resolve(selectedMode);
        }
      });
    });
  },

  // 导入数据
  async importData(file) {
    try {
      // 读取文件
      const text = await file.text();
      const backupData = JSON.parse(text);
      
      // 验证数据格式
      if (!backupData.data) {
        throw new Error('无效的备份文件格式');
      }
      
      // 验证必要字段
      if (!backupData.data.tabs || !Array.isArray(backupData.data.tabs)) {
        throw new Error('备份文件缺少标签页数据');
      }
      
      // 使用 Validator 清理数据
      const validTabs = Validator.sanitizeTabs(backupData.data.tabs);
      
      if (validTabs.length === 0) {
        throw new Error('备份文件中没有有效的标签页数据');
      }
      
      // 显示导入方式选择对话框
      const importMode = await this.showImportModeDialog(backupData, validTabs);
      
      if (!importMode) {
        // 用户取消了导入
        return;
      }
      
      if (importMode === 'replace') {
        // 覆盖模式：清空现有数据
        await chrome.storage.local.clear();
        await chrome.storage.local.set(backupData.data);
        Toast.success('数据已导入（覆盖模式），即将刷新页面...');
      } else if (importMode === 'merge') {
        // 合并模式：追加到现有数据
        const currentTabs = State.tabs;
        
        // 确保导入的标签页和快捷方式都有唯一ID
        validTabs.forEach(tab => {
          Utils.ensureShortcutId(tab);
          if (tab.shortcuts) {
            Utils.ensureShortcutIds(tab.shortcuts);
          }
        });
        
        // 合并标签页
        const mergedTabs = [...currentTabs, ...validTabs];
        
        // 获取当前所有数据，只更新tabs，保留其他设置
        const currentData = await chrome.storage.local.get(null);
        
        // 保存合并后的数据（只更新tabs，保留其他所有数据）
        await chrome.storage.local.set({
          ...currentData,
          tabs: mergedTabs
          // 保留 currentTabId 和其他设置不变
        });
        
        Toast.success(`数据已导入（合并模式），已添加 ${validTabs.length} 个标签页，即将刷新页面...`);
      }
      
      // 2秒后刷新页面
      setTimeout(() => {
        location.reload();
      }, 2000);
      
    } catch (error) {
      Logger.error('Import data error:', error);
      // 使用统一的 Toast 系统
      Toast.error(`导入失败：${error.message}`);
    }
  },

  // 显示书签导入确认对话框
  showBookmarkImportDialog() {
    return new Promise((resolve) => {
      // 创建模态框
      const modal = document.createElement('div');
      modal.className = 'modal import-mode-modal';
      modal.style.display = 'flex';
      
      const content = document.createElement('div');
      content.className = 'modal-content';
      content.style.maxWidth = '500px';
      
      content.innerHTML = `
        <div class="modal-header">
          <h3>导入浏览器书签</h3>
        </div>
        <div class="modal-body">
          <div style="margin-bottom: 20px;">
            <p style="margin-bottom: 8px;"><strong>导入说明：</strong></p>
            <p style="margin-bottom: 8px;">• 书签将被添加至当前标签页</p>
            <p style="margin-bottom: 8px;">• 书签中的文件夹（无论层级）将被转换为分组形式</p>
            <p style="margin-bottom: 8px;">• 当前标签页的快捷方式将被保留，导入的书签会追加到后面</p>

          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancelBookmarkImportBtn">取消</button>
          <button class="btn btn-primary" id="confirmBookmarkImportBtn">确定</button>
        </div>
      `;
      
      modal.appendChild(content);
      document.body.appendChild(modal);
      
      // 点击背景关闭
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
          resolve(false);
        }
      });
      
      // 取消按钮
      const cancelBtn = content.querySelector('#cancelBookmarkImportBtn');
      const confirmBtn = content.querySelector('#confirmBookmarkImportBtn');
      
      if (!cancelBtn || !confirmBtn) {
        Logger.error('Bookmark import dialog buttons not found');
        modal.remove();
        resolve(false);
        return;
      }
      
      cancelBtn.addEventListener('click', () => {
        modal.remove();
        resolve(false);
      });
      
      // 确认按钮
      confirmBtn.addEventListener('click', () => {
        modal.remove();
        resolve(true);
      });
    });
  },

  // 从浏览器书签导入
  async importBookmarks() {
    try {
      // 检查权限
      if (!chrome.bookmarks) {
        Toast.error('无法访问浏览器书签，请检查扩展权限');
        return;
      }

      // 显示确认对话框
      const confirmed = await this.showBookmarkImportDialog();

      if (!confirmed) {
        return;
      }

      // 获取书签树
      const bookmarkTree = await chrome.bookmarks.getTree();
      
      if (!bookmarkTree || bookmarkTree.length === 0) {
        Toast.warning('未找到任何书签');
        return;
      }

      // 递归处理书签树，只导入有直接书签的文件夹作为分组
      const shortcuts = [];
      let skippedCount = 0;
      
      // 收集文件夹内的直接书签（不递归嵌套文件夹）
      const collectDirectBookmarks = (node) => {
        const bookmarks = [];
        
        if (!node.children) {
          return bookmarks;
        }
        
        node.children.forEach(child => {
          if (child.url) {
            const validUrl = Utils.validateUrl(child.url);
            if (!validUrl) {
              skippedCount++;
              return;
            }
            // 只收集直接书签，不处理嵌套文件夹
            bookmarks.push({
              name: child.title || '未命名',
              url: validUrl,
              icon: ''
            });
          }
        });
        
        return bookmarks;
      };
      
      const processBookmarkNode = (node) => {
        // 跳过根节点（"书签栏"、"其他书签"等）
        // Chrome书签API的根节点ID通常是 '0'（书签栏）、'1'（其他书签）、'2'（移动设备书签）
        if (node.id === '0' || node.id === '1' || node.id === '2') {
          // 处理子节点
          if (node.children) {
            node.children.forEach(child => processBookmarkNode(child));
          }
          return;
        }

        // 如果是文件夹
        if (node.children) {
          // 只收集文件夹内的直接书签（不包括嵌套文件夹中的书签）
          const folderItems = collectDirectBookmarks(node);
          
          // 只有当文件夹有直接书签时，才创建分组
          if (folderItems.length > 0) {
            shortcuts.push({
              type: 'folder',
              name: node.title || '未命名分组',
              items: folderItems
            });
          }
          
          // 继续处理子节点中的嵌套文件夹（它们会单独成为分组）
          node.children.forEach(child => {
            if (child.children) {
              processBookmarkNode(child);
            }
          });
        } else if (node.url) {
          const validUrl = Utils.validateUrl(node.url);
          if (!validUrl) {
            skippedCount++;
            return;
          }
          // 普通书签（不在文件夹中）
          shortcuts.push({
            name: node.title || '未命名',
            url: validUrl,
            icon: ''
          });
        }
      };

      // 处理所有书签
      bookmarkTree.forEach(root => processBookmarkNode(root));

      if (shortcuts.length === 0) {
        Toast.warning('未找到可导入的书签');
        return;
      }

      // 添加到当前标签页
      const currentTab = State.tabs.find(t => t.id === State.currentTabId);
      if (!currentTab) {
        Toast.error('未找到当前标签页');
        return;
      }

      // 确保所有导入的快捷方式都有唯一ID
      shortcuts.forEach(shortcut => {
        Utils.ensureShortcutId(shortcut);
        if (shortcut.type === 'folder' && shortcut.items) {
          shortcut.items.forEach(item => Utils.ensureShortcutId(item));
        }
      });
      
      // 追加到现有快捷方式后面
      State.shortcuts = [...State.shortcuts, ...shortcuts];
      
      // 保存
      await Storage.saveShortcuts();
      
      // 重新渲染
      UI.renderShortcuts();

      // 统计信息
      const folderCount = shortcuts.filter(s => s.type === 'folder').length;
      const bookmarkCount = shortcuts.filter(s => !s.type || s.type !== 'folder').length;
      const totalInFolders = shortcuts
        .filter(s => s.type === 'folder')
        .reduce((sum, f) => sum + (f.items?.length || 0), 0);

      Toast.success(
        `导入成功！\n` +
        `分组：${folderCount} 个\n` +
        `快捷方式：${bookmarkCount + totalInFolders} 个` +
        (skippedCount > 0 ? `\n已跳过无效链接：${skippedCount} 个` : ''),
        4000
      );

      Logger.debug('Bookmarks imported:', {
        folders: folderCount,
        shortcuts: bookmarkCount,
        itemsInFolders: totalInFolders
      });

    } catch (error) {
      Logger.error('Import bookmarks error:', error);
      Toast.error(`导入失败：${error.message}`);
    }
  }
};

// ==================== 设置管理 ====================
const Settings = {
  async init() {
    const settings = await Storage.loadSettings();

    // 应用背景
    if (settings.background) {
      // 判断是渐变还是图片
      if (settings.background.startsWith('linear-gradient')) {
        document.body.style.background = settings.background;
      } else {
        document.body.style.backgroundImage = `url(${settings.background})`;
      }
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      // ✅ 设置默认渐变背景（青靛渐变）
      const defaultGradient = 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)';
      document.body.style.background = defaultGradient;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    }

    // 应用搜索引擎
    State.currentEngine = settings.searchEngine;
    State.customEngineUrl = settings.customEngineUrl;
    UI.updateSearchEngineUI();
    
    // 显示/隐藏自定义搜索引擎输入框
    const customEngineInput = Utils.getElement('customEngineInput');
    const customEngineUrl = Utils.getElement('customEngineUrl');
    if (settings.searchEngine === 'custom') {
      if (customEngineInput) customEngineInput.style.display = 'block';
      if (customEngineUrl) customEngineUrl.value = settings.customEngineUrl;
    }

    // 应用搜索框透明度
    UI.applySearchOpacity(settings.searchOpacity);
    const opacitySlider = Utils.getElement('searchOpacity');
    const opacityValue = Utils.getElement('opacityValue');
    if (opacitySlider) opacitySlider.value = settings.searchOpacity;
    if (opacityValue) opacityValue.textContent = settings.searchOpacity + '%';

    // 应用图标区域宽度设置
    UI.applyGridColumns(settings.gridColumns);
    const gridColumnsSlider = Utils.getElement('gridColumns');
    const columnsValue = Utils.getElement('columnsValue');
    if (gridColumnsSlider) gridColumnsSlider.value = settings.gridColumns;
    if (columnsValue) columnsValue.textContent = settings.gridColumns.toString();

    // 应用自动隐藏设置
    const autoHideToggle = Utils.getElement('autoHideToggle');
    if (autoHideToggle) {
      autoHideToggle.checked = settings.autoHideControls;
    }
    this.applyAutoHideSettings(settings.autoHideControls);
  },

  applyAutoHideSettings(autoHide) {
    const tabsSidebar = document.querySelector('.tabs-sidebar');
    const settingsBtn = Utils.getElement('settingsBtn');

    if (autoHide) {
      // 启用自动隐藏
      if (tabsSidebar) {
        tabsSidebar.classList.remove('no-auto-hide');
        tabsSidebar.classList.remove('show');
        // 如果不是在编辑状态，移除 editing 类
        if (!tabsSidebar.classList.contains('editing')) {
          tabsSidebar.classList.remove('show');
        }
      }
      if (settingsBtn) {
        settingsBtn.classList.remove('no-auto-hide');
        settingsBtn.style.opacity = '';
        settingsBtn.style.transform = '';
      }
    } else {
      // 禁用自动隐藏，始终显示
      if (tabsSidebar) {
        tabsSidebar.classList.add('no-auto-hide');
        tabsSidebar.classList.add('show');
      }
      if (settingsBtn) {
        settingsBtn.classList.add('no-auto-hide');
        settingsBtn.style.opacity = '1';
        settingsBtn.style.transform = 'translateY(0)';
      }
    }
  },

  async uploadBackground() {
    const input = Utils.getElement('bgUpload');
    if (!input || !input.files || !input.files[0]) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      document.body.style.backgroundImage = `url(${dataUrl})`;
      await Storage.set({ background: dataUrl });
    };

    reader.readAsDataURL(file);
  },

  async setRandomBackground() {
    // 随机渐变色背景（30种精美配色）
    const gradients = [
      // 原有 20 种双色渐变
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
      'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
      'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      'linear-gradient(135deg, #ff6e7f 0%, #bfe9ff 100%)',
      'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
      'linear-gradient(135deg, #fdcbf1 0%, #e6dee9 100%)',
      'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
      'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
      'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
      'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)',
      'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      
      // ✨ 新增 10 种三色混合渐变
      'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',        // 蓝紫粉
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 50%, #43e97b 100%)',        // 蓝青绿
      'linear-gradient(135deg, #fa709a 0%, #fee140 50%, #f093fb 100%)',        // 粉黄紫
      'linear-gradient(135deg, #30cfd0 0%, #330867 50%, #a8edea 100%)',        // 青靛蓝
      'linear-gradient(135deg, #ff6e7f 0%, #bfe9ff 50%, #667eea 100%)',        // 红蓝紫
      'linear-gradient(135deg, #f6d365 0%, #fda085 50%, #ff9a9e 100%)',        // 金橙粉
      'linear-gradient(135deg, #84fab0 0%, #8fd3f4 50%, #fbc2eb 100%)',        // 绿蓝粉
      'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 50%, #89f7fe 100%)',        // 紫蓝青
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 50%, #ff6e7f 100%)',        // 米橙红
      'linear-gradient(135deg, #a8edea 0%, #fed6e3 50%, #d299c2 100%)'         // 青粉紫
    ];

    const randomGradient = gradients[Math.floor(Math.random() * gradients.length)];
    document.body.style.background = randomGradient;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    await Storage.set({ background: randomGradient });
  },

  async resetBackground() {
    // ✅ 恢复默认渐变背景
    // 先清除所有背景样式
    document.body.style.background = '';
    document.body.style.backgroundImage = '';
    
    // 然后设置默认渐变背景（青靛渐变）
    const defaultGradient = 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)';
    document.body.style.background = defaultGradient;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    
    // 保存设置（null 表示使用默认背景）
    await Storage.set({ background: null });
  },

  async applyBackground(backgroundValue) {
    let background = backgroundValue;
    if (background === undefined) {
      const stored = await Storage.get(['background']);
      background = stored.background;
    }

    if (background) {
      if (background.startsWith('linear-gradient')) {
        document.body.style.background = background;
        document.body.style.backgroundImage = '';
      } else {
        document.body.style.background = '';
        document.body.style.backgroundImage = `url(${background})`;
      }
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
      return;
    }

    const defaultGradient = 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)';
    document.body.style.background = defaultGradient;
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  }
};

// ==================== 事件处理 ====================
const Events = {
  // 第一次聚焦标记（提升到外部作用域）
  isFirstFocus: true,

  init() {
    this.setupSearch();
    this.setupShortcuts();
    this.setupTabs();
    this.setupTabEdit();
    this.setupSettings();
    this.setupFolder();
    this.setupKeyboard();
    this.setupPageContextMenu();
  },

  setupSearch() {
    const searchInput = Utils.getElement('searchInput');
    if (!searchInput) return;

    // 聚焦时插入空格，帮助输入法定位
    searchInput.addEventListener('focus', () => {
      if (this.isFirstFocus && !searchInput.value) {
        searchInput.value = ' ';
        searchInput.setSelectionRange(1, 1);
        this.isFirstFocus = false;
      }
    });

    // 开始输入时，如果只有空格则清空
    searchInput.addEventListener('input', (e) => {
      if (searchInput.value === ' ') {
        searchInput.value = '';
      }
    });

    // 处理按键
    searchInput.addEventListener('keydown', (e) => {
      // 如果只有空格，按退格或删除键时清空
      if ((e.key === 'Backspace' || e.key === 'Delete') && searchInput.value.trim() === '') {
        searchInput.value = '';
        return;
      }

      if (e.key === 'Enter') {
        // 如果输入法正在工作（composing 状态），不触发搜索
        if (e.isComposing) {
          return;
        }
        
        e.preventDefault();
        const query = e.target.value.trim();
        if (query) {
          Search.handle(query);
          searchInput.value = '';
          searchInput.blur();
          this.isFirstFocus = true; // 重置标记
        }
      }
    });

    // 失去焦点时，如果只有空格则清空
    searchInput.addEventListener('blur', () => {
      if (searchInput.value.trim() === '') {
        searchInput.value = '';
      }
      // 失去焦点时也重置标记，下次点击时重新插入空格
      this.isFirstFocus = true;
    });

    // 初始不自动聚焦，避免加载时光标闪烁
  },

  setupShortcuts() {
    const addBtn = Utils.getElement('addShortcut');
    const modal = Utils.getElement('addShortcutModal');
    const cancelBtn = Utils.getElement('cancelBtn');
    const saveBtn = Utils.getElement('saveBtn');

    if (addBtn) {
      addBtn.addEventListener('click', () => ShortcutManager.add());
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => UI.toggleModal(false));
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => ShortcutManager.save());
    }

    // 点击模态框外部关闭（防止从输入框拖拽到外部时关闭）
    if (modal) {
      let mouseDownInside = false;
      
      // 记录鼠标按下时的位置
      modal.addEventListener('mousedown', (e) => {
        // 检查点击是否在模态框内容区域
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent && modalContent.contains(e.target)) {
          mouseDownInside = true;
        } else {
          mouseDownInside = false;
        }
      });
      
      // 点击外部关闭
      modal.addEventListener('click', (e) => {
        // 只有点击背景（模态框本身）时才关闭
        if (e.target === modal) {
          // 如果是从模态框内容内开始拖拽到外部，不关闭
          if (mouseDownInside) {
            mouseDownInside = false; // 重置状态
            return;
          }
          UI.toggleModal(false);
        }
      });
    }

    // 设置图标上传功能
    this.setupIconUpload();

    // 为快捷方式网格添加拖拽区域支持(接收从分组拖出的项目)
    const shortcutsGrid = Utils.getElement('shortcutsGrid');
    if (shortcutsGrid) {
      shortcutsGrid.addEventListener('dragover', (e) => {
        if (State.draggedItem && State.draggedItem.type === 'folderItem') {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });
    }
  },

  setupIconUpload() {
    const uploadBtn = Utils.getElement('uploadIconBtn');
    const textIconBtn = Utils.getElement('textIconBtn');
    const fileInput = Utils.getElement('iconFileInput');
    const iconInput = Utils.getElement('siteIcon');
    const textIconGroup = Utils.getElement('textIconGroup');
    const textIconInput = Utils.getElement('textIconInput');
    const colorPicker = Utils.getElement('textIconColorPicker');
    const colorGrid = Utils.getElement('textIconColorGrid');
    
    if (!uploadBtn || !fileInput) return;
    
    // 清空文字图标输入框的辅助函数
    const clearTextIcon = () => {
      if (textIconInput) {
        textIconInput.value = '';
      }
      if (textIconGroup) {
        textIconGroup.style.display = 'none';
      }
      if (colorPicker) {
        colorPicker.style.display = 'none';
      }
      if (colorGrid) {
        colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
          btn.classList.remove('selected');
        });
      }
    };
    
    // 监听图标URL输入框的变化
    if (iconInput) {
      iconInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        // 如果输入了值且不是文字图标格式，清空文字图标输入框
        if (value && !value.startsWith('data:image/svg+xml;base64,')) {
          clearTextIcon();
        }
      });
    }
    
    // 点击上传按钮触发文件选择
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
    
    // 文件选择后处理
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        Toast.error('请选择图片文件');
        // 🔑 关键修复：验证失败后也要清空 input，确保下次选择同一文件时会触发 change 事件
        fileInput.value = '';
        return;
      }
      
      // 检查文件大小（限制 2MB）
      if (file.size > 2 * 1024 * 1024) {
        Toast.error('图片大小不能超过 2MB');
        // 🔑 关键修复：验证失败后也要清空 input，确保下次选择同一文件时会触发 change 事件
        fileInput.value = '';
        return;
      }
      
      try {
        // 读取文件为 Base64
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target.result;
          
          // 设置到图标输入框
          if (iconInput) {
            iconInput.value = base64;
          }
          
          // 清空文字图标输入框
          clearTextIcon();
          
          Toast.success('图标已上传');
          
          // 🔑 关键修复：只有在成功读取后才清空 input，允许重复选择同一文件
          fileInput.value = '';
        };
        
        reader.onerror = () => {
          Toast.error('图片读取失败');
          // 🔑 关键修复：读取失败后也要清空 input
          fileInput.value = '';
        };
        
        reader.readAsDataURL(file);
      } catch (error) {
        Logger.error('图标上传失败:', error);
        Toast.error('图标上传失败');
        fileInput.value = '';
      }
    });
    
    // 文字图标按钮
    if (textIconBtn && textIconGroup) {
      textIconBtn.addEventListener('click', () => {
        // 切换文字图标输入框的显示
        const isVisible = textIconGroup.style.display !== 'none';
        textIconGroup.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible && textIconInput) {
          // 显示时聚焦输入框
          setTimeout(() => textIconInput.focus(), 100);
          
          // 初始化颜色选择器
          const colorPicker = Utils.getElement('textIconColorPicker');
          const colorGrid = Utils.getElement('textIconColorGrid');
          if (colorPicker && colorGrid && colorGrid.children.length === 0) {
            // 创建颜色选择器
            const colors = Utils.getTextIconColors();
            colors.forEach((color) => {
              const colorBtn = document.createElement('button');
              colorBtn.type = 'button';
              colorBtn.className = 'text-icon-color-btn';
              colorBtn.style.backgroundColor = color;
              colorBtn.dataset.color = color;
              colorBtn.title = '点击选择此颜色';
              colorBtn.addEventListener('click', () => {
                // 移除其他按钮的选中状态
                colorGrid.querySelectorAll('.text-icon-color-btn').forEach(btn => {
                  btn.classList.remove('selected');
                });
                // 添加选中状态
                colorBtn.classList.add('selected');
                
                // 如果已有文字，立即更新图标
                const currentText = textIconInput ? textIconInput.value.trim() : '';
                if (currentText.length > 0 && iconInput) {
                  const textIcon = Utils.generateTextIcon(currentText, color);
                  if (textIcon) {
                    iconInput.value = textIcon;
                  }
                }
              });
              colorGrid.appendChild(colorBtn);
            });
          }
          
          // 显示颜色选择器（只要有文字图标输入框显示）
          if (colorPicker) {
            colorPicker.style.display = 'block';
          }
        }
      });
    }
    
    // 文字图标输入框实时生成（静默生成，不提示）
    if (textIconInput && iconInput) {
      textIconInput.addEventListener('input', (e) => {
        const text = e.target.value.trim();
        
        // 显示颜色选择器（始终显示，不依赖文字输入）
        const colorPicker = Utils.getElement('textIconColorPicker');
        if (colorPicker) {
          colorPicker.style.display = 'block';
        }
        
        if (text.length > 0) {
          // 检查是否有选中的颜色
          const colorGrid = Utils.getElement('textIconColorGrid');
          const selectedColorBtn = colorGrid?.querySelector('.text-icon-color-btn.selected');
          const selectedColor = selectedColorBtn ? selectedColorBtn.dataset.color : null;
          
          // 使用选中的颜色或默认颜色（根据文本计算）
          const textIcon = Utils.generateTextIcon(text, selectedColor);
          if (textIcon) {
            iconInput.value = textIcon;
            // 静默生成，不显示提示
          }
        } else {
          // 清空时恢复
          iconInput.value = '';
          // 清除颜色选择
          const colorGrid = Utils.getElement('textIconColorGrid');
          colorGrid?.querySelectorAll('.text-icon-color-btn').forEach(btn => {
            btn.classList.remove('selected');
          });
        }
      });
    }
  },

  setupTabs() {
    // 全局滚轮切换标签页
    let wheelTimeout = null;
    let accumulatedDelta = 0;
    let hideTimeout = null;
    let lastDirection = 0; // 记录上次的滚动方向
    const threshold = 50; // 累积阈值，避免触摸板微小滚动触发
    const tabsSidebar = document.querySelector('.tabs-sidebar');
    
    // 鼠标进入显示
    if (tabsSidebar) {
      tabsSidebar.addEventListener('mouseenter', () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
        tabsSidebar.classList.add('show');
      });
      
      // 鼠标离开 0.68 秒后隐藏
      tabsSidebar.addEventListener('mouseleave', () => {
        hideTimeout = setTimeout(() => {
          tabsSidebar.classList.remove('show');
        }, 680); // 0.68 秒后隐藏
      });
    }
    
    document.addEventListener('wheel', (e) => {
      if (State.tabs.length <= 1) return;
      // 如果在模态框、设置面板中，不切换标签页
      const modal = Utils.getElement('addShortcutModal');
      const settingsPanel = Utils.getElement('settingsPanel');
      
      // 统一使用 classList.contains('active') 检查模态框状态
      if ((modal && modal.classList.contains('active')) || 
          (settingsPanel && settingsPanel.classList.contains('active'))) {
        return;
      }
      
      // 检查是否在设置面板或模态框的子元素中
      if (e.target.closest('.settings-panel') || e.target.closest('.modal')) {
        return;
      }
      
      // 检查页面是否滚动到底部
      const container = document.querySelector('.container');
      let isAtBottom = false;
      if (container) {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        // 允许1px的误差，因为有些情况下可能不会完全相等
        isAtBottom = scrollHeight - scrollTop - clientHeight <= 1;
      } else {
        // 如果没有container，使用window的滚动位置
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = window.innerHeight;
        isAtBottom = scrollHeight - scrollTop - clientHeight <= 1;
      }
      
      // 如果还没到底部，允许正常滚动，不切换标签页
      if (!isAtBottom) {
        // 重置累积量，防止快速滚动后立即切换
        accumulatedDelta = 0;
        lastDirection = 0;
        if (wheelTimeout) {
          clearTimeout(wheelTimeout);
          wheelTimeout = null;
        }
        return; // 允许正常滚动
      }
      
      // 已经到底部，可以切换标签页
      // 检测方向改变
      const currentDirection = e.deltaY > 0 ? 1 : -1;
      
      // 如果方向改变，完全重置
      if (lastDirection !== 0 && currentDirection !== lastDirection) {
        accumulatedDelta = 0;
        lastDirection = currentDirection;
        // 清除防抖定时器，允许立即响应新方向
        if (wheelTimeout) {
          clearTimeout(wheelTimeout);
          wheelTimeout = null;
        }
      }
      
      lastDirection = currentDirection;
      
      // 防抖处理，避免切换过快
      if (wheelTimeout) {
        // 在防抖期间不累积，直接返回
        return;
      }
      
      // 累积滚动量
      accumulatedDelta += e.deltaY;
      
      // 达到阈值才切换
      if (Math.abs(accumulatedDelta) >= threshold) {
        TabManager.switchByWheel(accumulatedDelta);
        accumulatedDelta = 0; // 重置累积量
        
        wheelTimeout = setTimeout(() => {
          wheelTimeout = null;
        }, 300); // 300ms 内只能切换一次
      }
    }, { passive: true }); // 使用 passive: true，不阻止默认行为，兼容 macOS
  },

  setupTabEdit() {
    const tabEditModal = Utils.getElement('tabEditModal');
    const cancelTabEdit = Utils.getElement('cancelTabEdit');
    const saveTabEdit = Utils.getElement('saveTabEdit');
    const tabNameInput = Utils.getElement('tabName');

    // 取消按钮
    if (cancelTabEdit) {
      cancelTabEdit.addEventListener('click', () => {
        UI.toggleTabEditModal(false);
        State.editingTabId = null;
      });
    }

    // 保存按钮
    if (saveTabEdit) {
      saveTabEdit.addEventListener('click', () => TabManager.saveTabEdit());
    }

    // 回车保存
    if (tabNameInput) {
      tabNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          TabManager.saveTabEdit();
        } else if (e.key === 'Escape') {
          UI.toggleTabEditModal(false);
          State.editingTabId = null;
        }
      });
    }

    // 点击模态框外部关闭（防止从输入框拖拽到外部时关闭）
    if (tabEditModal) {
      let mouseDownInside = false;
      
      // 记录鼠标按下时的位置
      tabEditModal.addEventListener('mousedown', (e) => {
        // 检查点击是否在模态框内容区域
        const modalContent = tabEditModal.querySelector('.tab-edit-content');
        if (modalContent && modalContent.contains(e.target)) {
          mouseDownInside = true;
        } else {
          mouseDownInside = false;
        }
      });
      
      // 点击外部关闭
      tabEditModal.addEventListener('click', (e) => {
        // 只有点击背景（模态框本身）时才关闭
        if (e.target === tabEditModal) {
          // 如果是从模态框内容内开始拖拽到外部，不关闭
          if (mouseDownInside) {
            mouseDownInside = false; // 重置状态
            return;
          }
          UI.toggleTabEditModal(false);
          State.editingTabId = null;
        }
      });
    }
  },

  setupSettings() {
    const settingsBtn = Utils.getElement('settingsBtn');
    const settingsPanel = Utils.getElement('settingsPanel');
    const closeSettings = Utils.getElement('closeSettings');

    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.toggleSettings(true);
      });
    }

    if (closeSettings) {
      closeSettings.addEventListener('click', () => UI.toggleSettings(false));
    }

    // 鼠标靠近右下角时显示设置按钮
    const cornerSize = 150; // 右下角 150px 区域
    document.addEventListener('mousemove', (e) => {
      if (settingsBtn) {
        const isNearCorner = (window.innerWidth - e.clientX <= cornerSize) && 
                            (window.innerHeight - e.clientY <= cornerSize);
        
        if (isNearCorner) {
          settingsBtn.style.opacity = '1';
          settingsBtn.style.transform = 'translateY(0)';
        } else {
          settingsBtn.style.opacity = '0';
          settingsBtn.style.transform = 'translateY(20px)';
        }
      }
    });

    // 点击面板外部关闭（防止从输入框拖拽到外部时关闭）
    if (settingsPanel) {
      let mouseDownInside = false;
      
      // 记录鼠标按下时的位置
      settingsPanel.addEventListener('mousedown', (e) => {
        // 检查点击是否在设置面板内容区域
        const settingsContent = settingsPanel.querySelector('.settings-content');
        if (settingsContent && settingsContent.contains(e.target)) {
          mouseDownInside = true;
        } else {
          mouseDownInside = false;
        }
      });
      
      // 点击外部关闭
      settingsPanel.addEventListener('click', (e) => {
        // 点击面板本身（背景）关闭
        if (e.target === settingsPanel) {
          // 如果是从设置面板内容内开始拖拽到外部，不关闭
          if (mouseDownInside) {
            mouseDownInside = false; // 重置状态
            return;
          }
          UI.toggleSettings(false);
        }
      });
    }

    // 背景设置
    const uploadBgBtn = Utils.getElement('uploadBgBtn');
    const bgUpload = Utils.getElement('bgUpload');
    const randomBgBtn = Utils.getElement('randomBgBtn');
    const resetBgBtn = Utils.getElement('resetBgBtn');

    if (uploadBgBtn && bgUpload) {
      uploadBgBtn.addEventListener('click', () => bgUpload.click());
      bgUpload.addEventListener('change', () => Settings.uploadBackground());
    }

    if (randomBgBtn) {
      randomBgBtn.addEventListener('click', () => Settings.setRandomBackground());
    }

    if (resetBgBtn) {
      resetBgBtn.addEventListener('click', () => Settings.resetBackground());
    }

    // 自定义下拉选择器
    const customSelect = Utils.getElement('engineSelect');
    const selectTrigger = customSelect?.querySelector('.custom-select-trigger');
    const selectOptions = customSelect?.querySelectorAll('.custom-select-option');
    
    if (selectTrigger && selectOptions) {
      // 点击触发器切换下拉框
      selectTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        customSelect.classList.toggle('active');
      });
      
      // 点击选项
      selectOptions.forEach(option => {
        option.addEventListener('click', async () => {
          const value = option.dataset.value;
          State.currentEngine = value;
          await Storage.set({ searchEngine: State.currentEngine });
          UI.updateSearchEngineUI();
          customSelect.classList.remove('active');
          
          // 显示/隐藏自定义搜索引擎输入框
          const customEngineInput = Utils.getElement('customEngineInput');
          if (customEngineInput) {
            customEngineInput.style.display = value === 'custom' ? 'block' : 'none';
          }
        });
      });
      
      // 点击外部关闭下拉框
      document.addEventListener('click', () => {
        customSelect.classList.remove('active');
      });
    }

    // 搜索框透明度设置
    const opacitySlider = Utils.getElement('searchOpacity');
    const opacityValue = Utils.getElement('opacityValue');

    if (opacitySlider && opacityValue) {
      opacitySlider.addEventListener('input', async (e) => {
        const opacity = parseInt(e.target.value);
        opacityValue.textContent = opacity + '%';
        UI.applySearchOpacity(opacity);
        await Storage.set({ searchOpacity: opacity });
      });
    }

    // 图标区域宽度设置
    const gridColumnsSlider = Utils.getElement('gridColumns');
    const columnsValue = Utils.getElement('columnsValue');

    if (gridColumnsSlider && columnsValue) {
      gridColumnsSlider.addEventListener('input', async (e) => {
        const columns = parseInt(e.target.value);
        columnsValue.textContent = columns.toString();
        UI.applyGridColumns(columns);
        await Storage.set({ gridColumns: columns });
      });
    }

    // 自动隐藏开关
    const autoHideToggle = Utils.getElement('autoHideToggle');
    if (autoHideToggle) {
      autoHideToggle.addEventListener('change', async (e) => {
        const autoHide = e.target.checked;
        Settings.applyAutoHideSettings(autoHide);
        await Storage.set({ autoHideControls: autoHide });
      });
    }

    // 自定义搜索引擎 URL
    const customEngineUrl = Utils.getElement('customEngineUrl');
    if (customEngineUrl) {
      customEngineUrl.addEventListener('blur', async (e) => {
        const url = e.target.value.trim();
        if (url && !url.includes('%s')) {
          Toast.warning('自定义搜索引擎 URL 必须包含 %s 作为搜索关键词的占位符', 4000);
          return;
        }
        State.customEngineUrl = url;
        await Storage.set({ customEngineUrl: url });
      });
    }

    // ✅ 数据备份按钮
    const exportDataBtn = Utils.getElement('exportDataBtn');
    const importDataBtn = Utils.getElement('importDataBtn');
    const importBookmarksBtn = Utils.getElement('importBookmarksBtn');
    const dataImport = Utils.getElement('dataImport');

    if (exportDataBtn) {
      exportDataBtn.addEventListener('click', () => {
        BackupManager.exportData();
      });
    }

    if (importDataBtn && dataImport) {
      importDataBtn.addEventListener('click', () => {
        dataImport.click();
      });
      
      dataImport.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          BackupManager.importData(file);
          // 清空文件选择，允许重复选择同一文件
          dataImport.value = '';
        }
      });
    }

    if (importBookmarksBtn) {
      importBookmarksBtn.addEventListener('click', () => {
        BackupManager.importBookmarks();
      });
    }

  },

  setupFolder() {
    const folderModal = Utils.getElement('folderModal');

    // 点击背景关闭分组弹窗
    if (folderModal) {
      folderModal.addEventListener('click', (e) => {
        // 只有点击背景（modal本身）时才关闭，点击内容区域不关闭
        if (e.target === folderModal) {
          UI.toggleFolderModal(false);
          State.editingIndex = -1;
        }
      });
    }

    // 点击模态框外部关闭
    if (folderModal) {
      folderModal.addEventListener('click', (e) => {
        if (e.target === folderModal) {
          UI.toggleFolderModal(false);
          State.editingIndex = -1;
        }
      });
    }
  },

  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // ESC 关闭模态框和设置面板
      if (e.key === 'Escape') {
        UI.toggleModal(false);
        UI.toggleSettings(false);
        UI.toggleFolderModal(false);
        
        // 关闭所有自定义右键菜单
        document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
      }

      // Ctrl/Cmd + K 打开搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = Utils.getElement('searchInput');
        if (searchInput) searchInput.focus();
      }

      // Ctrl/Cmd + , 打开设置
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        UI.toggleSettings(true);
      }
    });
  },

  // 页面右键菜单
  setupPageContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      // 检查是否有模态框打开
      const hasModalOpen = document.querySelector('.modal.active') || 
                          document.querySelector('.settings-panel.active') ||
                          document.querySelector('.tab-edit-modal.active') ||
                          document.querySelector('.folder-modal.active');
      
      // 如果有模态框打开，阻止右键菜单但不显示任何菜单
      if (hasModalOpen) {
        e.preventDefault();
        return;
      }
      
      // 检查右键点击的位置
      const isExistingMenu = e.target.closest('.context-menu');
      
      // 检查是否点击在不应该显示菜单的区域（优先检测）
      const isAddButton = e.target.closest('.shortcut-add-btn') || e.target.closest('.tab-add-btn');
      const isSearchArea = e.target.closest('.search-container') || e.target.closest('.search-wrapper');
      const isSettingsBtn = e.target.closest('.settings-btn');
      const isSidebar = e.target.closest('.tabs-sidebar');
      
      // 检查快捷方式、分组、标签页（需要排除添加按钮）
      const element = e.target.closest('.shortcut-item, .folder-shortcut-item, .tab-item');
      const isShortcutItem = element && !element.classList.contains('shortcut-add-btn') && !element.classList.contains('tab-add-btn');
      
      // 如果右键点击在现有菜单上，阻止浏览器菜单但不做其他处理
      if (isExistingMenu) {
        e.preventDefault();
        return;
      }
      
      // 如果右键点击在按钮、搜索框、设置按钮、侧边栏区域，阻止但不显示菜单
      if (isAddButton || isSearchArea || isSettingsBtn || isSidebar) {
        e.preventDefault();
        return;
      }
      
      // 如果右键点击在快捷方式或分组或标签页上，显示对应的右键菜单
      if (isShortcutItem) {
        return; // 让原有的右键菜单正常显示
      }
      
      // 阻止浏览器默认右键菜单
      e.preventDefault();
      
      // 移除已存在的菜单
      const existingMenu = document.querySelector('.context-menu');
      if (existingMenu) existingMenu.remove();
      
      // 创建页面右键菜单
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.left = e.pageX + 'px';
      menu.style.top = e.pageY + 'px';
      
      menu.innerHTML = `
        <div class="context-menu-item" data-action="add-shortcut">
          <span>➕</span>添加图标
        </div>
        <div class="context-menu-item" data-action="settings">
          <span>⚙️</span>页面设置
        </div>
      `;
      
      document.body.appendChild(menu);
      
      // 点击菜单项
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;
        
        const action = item.dataset.action;
        if (action === 'add-shortcut') {
          // 添加图标（与点击加号按钮功能一致）
          ShortcutManager.add();
        } else if (action === 'settings') {
          // 打开设置（与点击设置按钮功能一致）
          UI.toggleSettings(true);
        }
        
        menu.remove();
      });
      
      // 点击其他地方关闭菜单
      const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      
      setTimeout(() => {
        document.addEventListener('click', closeMenu);
      }, 0);
    });
  }
};

// ==================== 多标签页同步 ====================
// 监听 chrome.storage 的变化，实现多标签页实时同步
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  
  Logger.debug('Storage changed:', changes);
  
  let needsUpdate = false;
  
  // 检查标签页数据是否变化
  if (changes.tabs) {
    const oldCurrentTabId = State.currentTabId; // 保存当前标签页ID
    State.tabs = changes.tabs.newValue || [];
    
    // 检查当前标签页是否还存在
    const currentTabStillExists = State.tabs.some(t => t.id === oldCurrentTabId);
    if (!currentTabStillExists && State.tabs.length > 0) {
      // 如果当前标签页被删除，切换到第一个标签页
      State.currentTabId = State.tabs[0].id;
    } else {
      // 否则保持在当前标签页（不跟随其他页面切换）
      State.currentTabId = oldCurrentTabId;
    }
    
    needsUpdate = true;
  }
  
  // ⚠️ 不同步 currentTabId - 每个页面保持自己的当前标签页
  // 这样就不会出现"点击另一个页面时自动切换到新增页面"的问题
  
  // 检查背景设置是否变化
  if (changes.backgroundType || changes.backgroundImage || changes.backgroundColor || changes.backgroundBlur) {
    needsUpdate = true;
  }
  
  // 检查搜索引擎设置是否变化
  if (changes.searchEngine || changes.customEngineUrl) {
    if (changes.searchEngine) {
      State.currentEngine = changes.searchEngine.newValue || CONFIG.defaultSettings.searchEngine;
    }
    if (changes.customEngineUrl) {
      State.customEngineUrl = changes.customEngineUrl.newValue || '';
    }
    UI.updateSearchEngineUI();
    const customEngineInput = Utils.getElement('customEngineInput');
    const customEngineUrlInput = Utils.getElement('customEngineUrl');
    if (State.currentEngine === 'custom') {
      if (customEngineInput) customEngineInput.style.display = 'block';
      if (customEngineUrlInput) customEngineUrlInput.value = State.customEngineUrl || '';
    } else if (customEngineInput) {
      customEngineInput.style.display = 'none';
    }
    needsUpdate = true;
  }
  
  // 检查搜索框透明度是否变化
  if (changes.searchOpacity) {
    const opacity = changes.searchOpacity.newValue || CONFIG.defaultSettings.searchOpacity;
    UI.applySearchOpacity(opacity);
    const opacitySlider = Utils.getElement('searchOpacity');
    const opacityValue = Utils.getElement('opacityValue');
    if (opacitySlider) opacitySlider.value = opacity;
    if (opacityValue) opacityValue.textContent = `${opacity}%`;
  }
  
  // 检查网格列数是否变化
  if (changes.gridColumns) {
    needsUpdate = true;
  }
  
  // 如果需要更新，重新渲染界面
  if (needsUpdate) {
    // 更新当前标签页的快捷方式
    const currentTab = State.tabs.find(t => t.id === State.currentTabId);
    if (currentTab) {
      State.shortcuts = currentTab.shortcuts || [];
    }
    
    // 重新渲染标签页和快捷方式
    UI.renderTabs();
    UI.renderShortcuts();
    
    // 如果背景设置变化，重新应用背景
    if (changes.background) {
      Settings.applyBackground(changes.background.newValue);
    }
    
    // 如果网格列数变化，重新应用
    if (changes.gridColumns) {
      const columns = changes.gridColumns.newValue || CONFIG.defaultSettings.gridColumns;
      UI.applyGridColumns(columns);
    }
    
    Logger.debug('UI updated due to storage changes');
  }
});

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Settings.init();
    await TabManager.init();
    Events.init();
  } catch (error) {
    Logger.error('Initialization error:', error);
  }
});
