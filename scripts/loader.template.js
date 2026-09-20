/**
 * 战阵 · 回合制战斗面板 —— 酒馆助手脚本加载器
 * 本文件是模板：scripts/pack-loader.mjs 把面板单文件 HTML 与脚本按钮名
 * 注入下方代码中的两个占位符（PANEL_HTML 与 BTN_NAME 常量），
 * 再打包进 panel/dist/tavern-battle-script.json。
 *
 * 运行环境：酒馆助手「脚本库」的隐藏脚本 iframe。
 * 职责：把内嵌的面板 HTML 以 srcdoc iframe 挂进酒馆主界面的浮动窗；
 * 常驻悬浮球（点按开关 / 拖动换位）；脚本停用/重载时清理注入的 DOM。
 * 面板与楼层渲染形态同构——都从 window.parent.TavernHelper 取 API。
 *
 * 尺寸策略：桌面端右侧浮动窗（可拖动/拉伸），启用时自动弹出；
 * 手机端（≤768px）不自动弹窗——悬浮球为入口，点开全屏，✕ 收回悬浮球。
 */
__CONTROLLER_JS__
(function () {
  'use strict';

  const PANEL_HTML = __PANEL_HTML__;

  const WIN_ID = 'tavern-battle-panel-window';
  const BALL_ID = 'tavern-battle-panel-ball';
  const STYLE_ID = 'tavern-battle-panel-style';
  const SS_CLOSED = 'tavern-battle-panel:manually-closed';
  const LS_BALL_POS = 'tavern-battle-panel:ball-pos';
  const BTN_NAME = __BTN_NAME__;

  // 宿主 = 酒馆主窗口（脚本本身跑在酒馆助手的隐藏 iframe 里，与其同源）
  let host = window;
  try {
    if (window.parent && window.parent !== window && window.parent.document) host = window.parent;
  } catch (err) {
    /* 跨域保护：理论不触发 */
  }
  const doc = host.document;

  // 手机形态：小屏即手机（悬浮球入口 + 全屏面板，不打扰聊天界面）
  const isMobile = (function () {
    try {
      return host.matchMedia('(max-width: 768px)').matches;
    } catch (err) {
      return host.innerWidth <= 768;
    }
  })();

  // 世代令牌：脚本 iframe 重载后，旧实例挂在宿主事件总线上的处理器仍在。
  // 只有最新一代实例行动，过代实例的开关/清理一律空转，避免新旧窗口互相拆台。
  const GEN = 'gen-' + Math.random().toString(36).slice(2);
  try {
    host.__tavernBattlePanelGen = GEN;
  } catch (err) {
    /* 宿主不可写时退化为无令牌（单实例场景无影响） */
  }
  function isCurrent() {
    try {
      return host.__tavernBattlePanelGen === undefined || host.__tavernBattlePanelGen === GEN;
    } catch (err) {
      return true;
    }
  }

  const STYLE_TEXT = [
    '#' + WIN_ID + '{position:fixed;top:64px;right:18px;width:min(880px,96vw);height:min(80vh,880px);',
    'min-width:480px;min-height:360px;z-index:999999;display:flex;flex-direction:column;',
    'background:#14161c;border:1px solid #323847;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);',
    'resize:both;overflow:hidden}',
    '#' + WIN_ID + ' .tb-bar{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#1c1f27;',
    'border-bottom:1px solid #323847;cursor:move;user-select:none;touch-action:none;',
    'font:12px/1.4 "Segoe UI","Microsoft YaHei",sans-serif;color:#e8c56b;white-space:nowrap;overflow:hidden}',
    '#' + WIN_ID + ' .tb-bar .tb-hint{color:#8b93a5;font-size:11px;font-weight:normal}',
    '#' + WIN_ID + ' .tb-bar .tb-x{margin-left:auto;cursor:pointer;color:#8b93a5;font-size:14px;padding:0 4px}',
    '#' + WIN_ID + ' .tb-bar .tb-x:hover{color:#ff5e5e}',
    '#' + WIN_ID + ' iframe{flex:1;width:100%;border:0;background:#14161c}',
    // 手机：全屏呈现，禁拖动/拉伸（拖动标题栏与拉伸手柄在小屏没有意义且误触多）
    '@media (max-width:768px){',
    '#' + WIN_ID + '{top:0;left:0;right:auto;width:100vw;height:100vh;height:100dvh;',
    'min-width:0;min-height:0;border:none;border-radius:0;resize:none}',
    '#' + WIN_ID + ' .tb-bar{padding:10px;cursor:default;',
    'padding-top:calc(10px + env(safe-area-inset-top,0px))}',
    '#' + WIN_ID + ' iframe{padding-bottom:env(safe-area-inset-bottom,0px)}',
    '}',
    // 悬浮球：面板关闭时常驻，点按开关、拖动换位
    '#' + BALL_ID + '{position:fixed;width:44px;height:44px;border-radius:50%;',
    'background:rgba(28,31,39,.92);border:1px solid #323847;color:#e8c56b;',
    'display:flex;align-items:center;justify-content:center;font-size:20px;z-index:999990;',
    'box-shadow:0 4px 14px rgba(0,0,0,.45);cursor:pointer;user-select:none;touch-action:none;',
    'opacity:.85}',
    '#' + BALL_ID + ':active{opacity:1}'
  ].join('');

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = STYLE_TEXT;
    doc.head.appendChild(st);
  }

  // ---------- 悬浮球 ----------

  function clampBall(left, top) {
    const size = 44;
    return {
      left: Math.max(0, Math.min(left, host.innerWidth - size)),
      top: Math.max(0, Math.min(top, host.innerHeight - size)),
    };
  }

  function placeBall(ball, left, top) {
    const c = clampBall(left, top);
    ball.style.left = c.left + 'px';
    ball.style.top = c.top + 'px';
    ball.style.right = 'auto';
    return c;
  }

  function createBall() {
    if (doc.getElementById(BALL_ID)) return;
    ensureStyle();
    const ball = doc.createElement('div');
    ball.id = BALL_ID;
    ball.title = '战阵面板（点按开关，拖动移位）';
    ball.textContent = '⚔';

    // 位置：持久化的坐标 > 默认（右侧偏上）
    let restored = false;
    try {
      const raw = host.localStorage.getItem(LS_BALL_POS);
      if (raw) {
        const p = JSON.parse(raw);
        if (Number.isFinite(p.left) && Number.isFinite(p.top)) {
          placeBall(ball, p.left, p.top);
          restored = true;
        }
      }
    } catch (err) {
      /* localStorage 不可用则用默认位 */
    }
    if (!restored) {
      ball.style.right = '10px';
      ball.style.top = '38%';
    }
    doc.body.appendChild(ball);

    // 点按 vs 拖动：位移不足 8px 视为点按。pointermove 在悬停时也会触发，
    // 必须以按住状态门控——否则鼠标划过即被当作拖拽，球会瞬移飞走
    let sx = 0, sy = 0, moved = false, holding = false;
    ball.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      holding = true;
      sx = e.clientX;
      sy = e.clientY;
      moved = false;
      try {
        ball.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 旧浏览器无指针捕获 */
      }
      e.preventDefault();
    });
    ball.addEventListener('pointermove', function (e) {
      if (!holding) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && dx * dx + dy * dy < 64) return;
      moved = true;
      const r = ball.getBoundingClientRect();
      placeBall(ball, r.left + dx, r.top + dy);
      sx = e.clientX;
      sy = e.clientY;
    });
    ball.addEventListener('pointerup', function () {
      holding = false;
      if (!isCurrent()) return;
      if (moved) {
        const r = ball.getBoundingClientRect();
        try {
          host.localStorage.setItem(LS_BALL_POS, JSON.stringify({ left: r.left, top: r.top }));
        } catch (err) {
          /* 同上 */
        }
      } else {
        togglePanel();
      }
    });
    ball.addEventListener('pointercancel', function () {
      holding = false;
      moved = true; // 中断的拖动不触发开关
    });

    // 转屏/缩放后收回界内
    host.addEventListener('resize', function () {
      if (!isCurrent()) return;
      const b = doc.getElementById(BALL_ID);
      if (!b) return;
      const r = b.getBoundingClientRect();
      placeBall(b, r.left, r.top);
    });
  }

  function showBall(show) {
    const ball = doc.getElementById(BALL_ID);
    if (ball) ball.style.display = show ? 'flex' : 'none';
  }

  // ---------- 面板窗口 ----------

  function isOpen() {
    return !!doc.getElementById(WIN_ID);
  }

  function closePanel(manual) {
    const win = doc.getElementById(WIN_ID);
    if (win) win.remove();
    showBall(true);
    if (manual) {
      try {
        host.sessionStorage.setItem(SS_CLOSED, '1');
      } catch (err) {
        /* 隐私模式等：仅失去「本会话不再自动弹出」语义 */
      }
    }
  }

  function openPanel() {
    if (isOpen()) return;
    ensureStyle();

    const win = doc.createElement('div');
    win.id = WIN_ID;

    const bar = doc.createElement('div');
    bar.className = 'tb-bar';
    bar.textContent = '⚔ 战阵 · 回合制战斗';

    const hint = doc.createElement('span');
    hint.className = 'tb-hint';
    hint.textContent = isMobile ? '点击 ✕ 收起为悬浮球' : '拖动标题栏移动 · 右下角拉伸尺寸';

    const x = doc.createElement('span');
    x.className = 'tb-x';
    x.title = '关闭（悬浮球或脚本按钮「' + BTN_NAME + '」重新打开）';
    x.textContent = '✕';
    bar.appendChild(hint);
    bar.appendChild(x);

    const frame = doc.createElement('iframe');
    frame.srcdoc = PANEL_HTML;

    win.appendChild(bar);
    win.appendChild(frame);
    doc.body.appendChild(win);
    showBall(false);

    x.addEventListener('click', function () {
      closePanel(true);
    });

    // 标题栏拖拽（手机全屏形态不拖）；首次拖动把 right 定位切换为 left/top
    // 按下点在 ✕ 上时不启动拖拽——指针捕获会把 click 重定向到标题栏，按钮将收不到事件
    if (!isMobile) {
      let dragging = false;
      let sx = 0, sy = 0, ox = 0, oy = 0;
      bar.addEventListener('pointerdown', function (e) {
        if (x.contains(e.target)) return;
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        const r = win.getBoundingClientRect();
        ox = r.left;
        oy = r.top;
        try {
          bar.setPointerCapture(e.pointerId);
        } catch (err) {
          /* 旧浏览器无指针捕获：仍可拖，出窗即停 */
        }
        e.preventDefault();
      });
      bar.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        win.style.left = Math.max(0, Math.min(ox + e.clientX - sx, host.innerWidth - 80)) + 'px';
        win.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
        win.style.right = 'auto';
      });
      bar.addEventListener('pointerup', function () {
        dragging = false;
      });
      bar.addEventListener('pointercancel', function () {
        dragging = false;
      });
    }

    try {
      host.sessionStorage.removeItem(SS_CLOSED);
    } catch (err) {
      /* 同上 */
    }
  }

  function togglePanel() {
    if (!isCurrent()) return;
    if (isOpen()) closePanel(true);
    else openPanel();
  }

  // 脚本按钮（名称须与脚本配置 button.buttons 里的名称一致）
  try {
    if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
      eventOn(getButtonEvent(BTN_NAME), togglePanel);
    } else {
      console.warn('[战阵] 当前酒馆助手版本未提供脚本按钮 API，请用悬浮球开关面板');
    }
  } catch (err) {
    console.warn('[战阵] 脚本按钮注册失败', err);
  }


  // 入口：桌面端启动即打开（本会话内手动关闭过则不强开）；手机端只亮悬浮球
  createBall();
  if (!isMobile) {
    let manuallyClosed = false;
    try {
      manuallyClosed = host.sessionStorage.getItem(SS_CLOSED) === '1';
    } catch (err) {
      /* 同上 */
    }
    if (!manuallyClosed) openPanel();
  }

  // 脚本停用/重载（或页面卸载）时清理注入的窗口、悬浮球与样式；过代实例不清理新一代的 DOM
  function cleanup() {
    if (!isCurrent()) return;
    const win = doc.getElementById(WIN_ID);
    if (win) win.remove();
    const ball = doc.getElementById(BALL_ID);
    if (ball) ball.remove();
    const st = doc.getElementById(STYLE_ID);
    if (st) st.remove();
  }
  window.addEventListener('pagehide', cleanup);
  if (typeof $ === 'function') {
    try {
      $(window).on('pagehide', cleanup);
    } catch (err) {
      /* jQuery 不可用则仅走原生监听 */
    }
  }
})();
