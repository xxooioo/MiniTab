// ==================== Popup 页面逻辑 ====================

// 安全获取元素
function getElement(id) {
  return document.getElementById(id);
}

// 简单的提示函数
function showMessage(message, type = 'error') {
  // 移除已存在的提示
  const existing = document.querySelector('.popup-message');
  if (existing) existing.remove();
  
  const msgDiv = document.createElement('div');
  msgDiv.className = 'popup-message';
  msgDiv.textContent = message;
  msgDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(66, 133, 244, 0.95)'};
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    animation: slideDown 0.3s ease;
  `;
  
  document.body.appendChild(msgDiv);
  
  setTimeout(() => {
    msgDiv.style.opacity = '0';
    msgDiv.style.transform = 'translateX(-50%) translateY(-10px)';
    msgDiv.style.transition = 'all 0.3s ease';
    setTimeout(() => msgDiv.remove(), 300);
  }, 2000);
}

// 生成唯一 ID
function generateId() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 从页面中获取图标 URL（优先使用）
async function getIconFromPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const icons = [];
        
        // 解析尺寸字符串，返回面积（width * height）
        function parseSize(sizeStr) {
          if (!sizeStr) return 0;
          // sizes 可能是 "16x16"、"192x192"、"any" 等
          const match = sizeStr.match(/(\d+)x(\d+)/);
          if (match) {
            return parseInt(match[1]) * parseInt(match[2]);
          }
          // 如果是 "any"，返回一个较大的值以优先选择
          if (sizeStr.toLowerCase() === 'any') {
            return 10000;
          }
          return 0;
        }
        
        // 从 URL 中提取尺寸信息（如 favicon-192x192.png）
        function extractSizeFromUrl(url) {
          const match = url.match(/(\d+)x(\d+)/);
          if (match) {
            return parseInt(match[1]) * parseInt(match[2]);
          }
          return 0;
        }
        
        // 判断是否是 PNG 格式
        function isPng(url) {
          return url.toLowerCase().endsWith('.png');
        }
        
        // 查找所有 link[rel*="icon"] 标签
        document.querySelectorAll('link[rel*="icon"]').forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            try {
              const fullUrl = new URL(href, window.location.origin).href;
              const rel = link.getAttribute('rel');
              const sizes = link.getAttribute('sizes');
              
              // 优先从 sizes 属性获取尺寸，如果没有则从 URL 中提取
              let sizeArea = parseSize(sizes);
              if (sizeArea === 0) {
                sizeArea = extractSizeFromUrl(fullUrl);
              }
              
              // 标准 favicon 和 Apple Touch Icon 使用相同的优先级（1）
              const isIcon = rel.includes('icon') || rel.includes('apple-touch-icon');
              
              if (isIcon) {
                icons.push({
                  type: rel,
                  sizes: sizes,
                  url: fullUrl,
                  priority: 1, // 标准 favicon 和 Apple Touch Icon 优先级相同
                  sizeArea: sizeArea,
                  isPng: isPng(fullUrl)
                });
              }
            } catch (e) {
              // 忽略无效 URL
            }
          }
        });
        
        // 查找页面中的图标图片（如果 URL 包含尺寸信息，也解析）
        document.querySelectorAll('img[src*="icon"], img[src*="logo"]').forEach(img => {
          const src = img.getAttribute('src');
          if (src) {
            try {
              const fullUrl = new URL(src, window.location.origin).href;
              const sizeArea = extractSizeFromUrl(fullUrl);
              
              icons.push({
                type: 'image',
                url: fullUrl,
                priority: 4,
                sizeArea: sizeArea,
                isPng: isPng(fullUrl)
              });
            } catch (e) {
              // 忽略无效 URL
            }
          }
        });
        
        // 尝试常见路径
        const commonPaths = [
          '/favicon.ico',
          '/apple-touch-icon.png',
          '/apple-touch-icon-precomposed.png',
          '/icon.png',
          '/logo.png',
          '/favicon.png'
        ];
        
        commonPaths.forEach(path => {
          try {
            icons.push({
              type: 'common path',
              url: new URL(path, window.location.origin).href,
              priority: 5,
              sizeArea: 0,
              isPng: isPng(path)
            });
          } catch (e) {
            // 忽略无效 URL
          }
        });
        
        // 排序规则：
        // 1. 先按优先级排序
        // 2. 相同优先级时，优先选择面积更大的（尺寸大的优先）
        // 3. 如果面积相同或都为 0，优先选择 .png 结尾的
        icons.sort((a, b) => {
          if (a.priority !== b.priority) {
            return a.priority - b.priority;
          }
          // 相同优先级时，优先选择面积更大的
          if (a.sizeArea !== b.sizeArea) {
            return b.sizeArea - a.sizeArea;
          }
          // 面积相同时，优先选择 .png 结尾的
          if (a.isPng !== b.isPng) {
            return b.isPng ? -1 : 1; // true 排在前面
          }
          return 0;
        });
        
        return icons;
      }
    });
    
    if (results && results[0] && results[0].result && results[0].result.length > 0) {
      return results[0].result[0].url;
    }
  } catch (error) {
    console.log('无法从页面获取图标:', error);
  }
  return null;
}

// 获取 Favicon URL（后备方案）
function getFaviconUrl(url) {
  try {
    const domain = new URL(url).origin;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  } catch {
    return '';
  }
}

// 验证 URL
function validateUrl(url) {
  try {
    const validUrl = url.startsWith('http') ? url : `https://${url}`;
    new URL(validUrl);
    return validUrl;
  } catch {
    return null;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  const tabSelect = getElement('tabSelect');
  const tabSelectValue = getElement('tabSelectValue');
  const tabSelectOptions = getElement('tabSelectOptions');
  const editName = getElement('editName');
  const editUrl = getElement('editUrl');
  const addBtn = getElement('addBtn');
  const cancelBtn = getElement('cancelBtn');

  let selectedTabId = null;

  try {
    // 加载所有页面
    const result = await chrome.storage.local.get(['tabs', 'currentTabId']);
    let pageTabs = result.tabs || [];
    let activePageTabId = result.currentTabId;

    // 如果没有页面，创建默认页面
    if (pageTabs.length === 0) {
      const defaultTab = {
        id: generateId(),
        name: '默认',
        shortcuts: []
      };
      pageTabs = [defaultTab];
      activePageTabId = defaultTab.id;
      await chrome.storage.local.set({ tabs: pageTabs, currentTabId: activePageTabId });
    }

    // 填充自定义下拉框选项
    if (tabSelectOptions) {
      tabSelectOptions.innerHTML = '';
      pageTabs.forEach((tab, index) => {
        const option = document.createElement('div');
        option.className = 'custom-select-option';
        option.textContent = tab.name;
        option.dataset.value = tab.id;
        
        // 默认选中第一个页面（页面1），而不是当前激活的页面
        if (index === 0) {
          option.classList.add('selected');
          selectedTabId = tab.id;
          if (tabSelectValue) {
            tabSelectValue.textContent = tab.name;
          }
        }
        
        // 点击选项
        option.addEventListener('click', () => {
          selectedTabId = tab.id;
          if (tabSelectValue) {
            tabSelectValue.textContent = tab.name;
          }
          
          // 更新选中状态
          tabSelectOptions.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.classList.remove('selected');
          });
          option.classList.add('selected');
          
          // 关闭下拉框
          if (tabSelect) {
            tabSelect.classList.remove('active');
          }
        });
        
        tabSelectOptions.appendChild(option);
      });
    }

    // 自定义下拉框交互
    if (tabSelect) {
      const trigger = tabSelect.querySelector('.custom-select-trigger');
      
      if (trigger) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          tabSelect.classList.toggle('active');
        });
      }

      // 点击外部关闭下拉框
      document.addEventListener('click', () => {
        tabSelect.classList.remove('active');
      });

      tabSelect.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // 获取当前浏览器标签信息
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (currentTab) {
      // 预填充网站信息
      if (editName) editName.value = currentTab.title || '';
      if (editUrl) editUrl.value = currentTab.url || '';
    }

    // 添加按钮事件
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const name = editName ? editName.value.trim() : '';
        const url = editUrl ? editUrl.value.trim() : '';

        if (!name || !url) {
          showMessage('请填写网站名称和地址');
          return;
        }

        const validUrl = validateUrl(url);
        if (!validUrl) {
          showMessage('请输入有效的网址');
          return;
        }

        try {
          // 获取选中的页面 ID
          if (!selectedTabId) {
            showMessage('请选择一个页面');
            return;
          }
          
          // 读取现有数据
          const result = await chrome.storage.local.get(['tabs']);
          let pageTabs = result.tabs || [];

          // 找到选中的页面
          const targetPageTab = pageTabs.find(t => t.id === selectedTabId);
          
          if (!targetPageTab) {
            showMessage('请选择一个页面');
            return;
          }

          if (!targetPageTab.shortcuts) {
            targetPageTab.shortcuts = [];
          }

          // 优先从当前页面获取图标
          let iconUrl = null;
          if (currentTab && currentTab.id && currentTab.url === validUrl) {
            try {
              iconUrl = await getIconFromPage(currentTab.id);
            } catch (error) {
              console.log('从页面获取图标失败:', error);
            }
          }
          
          // 如果无法从页面获取，使用 Google Favicon API
          if (!iconUrl) {
            iconUrl = getFaviconUrl(validUrl);
          }

          // 添加新快捷方式
          const newShortcut = {
            name,
            url: validUrl,
            icon: iconUrl,
            _id: generateId() // 🔑 关键修复：为新快捷方式添加唯一 ID
          };

          targetPageTab.shortcuts.push(newShortcut);

          // 保存到 storage
          await chrome.storage.local.set({ tabs: pageTabs });

          // 显示成功消息
          if (addBtn) {
            const originalText = addBtn.textContent;
            addBtn.textContent = '✅ 已添加！';
            addBtn.disabled = true;
            
            setTimeout(() => {
              window.close();
            }, 800);
          }
        } catch (error) {
          console.error('保存失败:', error);
          showMessage('保存失败，请重试');
        }
      });
    }

    // 取消按钮事件
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        window.close();
      });
    }

    // 自动聚焦名称输入框
    if (editName) {
      editName.focus();
      editName.select();
    }

  } catch (error) {
    console.error('Popup 初始化错误:', error);
  }
});
