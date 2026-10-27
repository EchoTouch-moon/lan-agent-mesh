// Static single-page assets for the read-only trace console. The HTML carries
// no interpolated data: every value shown is fetched from /api/* (JSON) and
// rendered through DOM textContent/createElement only, so untrusted task text
// can never execute. No external origins, fonts or CDNs are referenced.
// Protocol enum values (task states, event types) stay in English on purpose;
// every label, hint and notice around them is Chinese.

export const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LAM 链路观察台（只读）</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header>
  <div class="brand">
    <span class="logo">LAM</span>
    <h1>链路观察台</h1>
    <span class="ro-badge" title="本页面不能批准、发送、取消或配对任何操作，仅展示可观察事实。">只读观察</span>
  </div>
  <span id="conn" class="conn conn-connecting">连接中…</span>
  <span class="spacer"></span>
  <button id="pause" type="button" title="时间线新增事件时不再自动滚动到底部">暂停自动滚动</button>
  <button id="reconnect" type="button" title="网关重启后控制令牌已轮换时，重新读取 control.json">重新连接网关</button>
</header>
<div id="banner" hidden></div>
<main>
  <div class="col-left">
    <section class="panel" id="nodes-panel">
      <h2>节点视图</h2>
      <div class="node-row">
        <div class="node local" id="local-node">
          <div class="node-title"><span class="dot dot-ok"></span>本机节点（发起方）</div>
          <div class="node-body">…</div>
        </div>
        <div class="arrow" title="调用方向：本机 → 对端">──▶</div>
        <div class="node remote" id="remote-node">
          <div class="node-title"><span class="dot"></span>对端节点（接收方）</div>
          <div class="node-body">未选择任务</div>
        </div>
      </div>
      <div class="hint">事件经加密 mesh 传输；本观察台只通过本机网关读取。</div>
    </section>
    <section class="panel" id="watch-panel">
      <h2>观察任务</h2>
      <form id="add-task">
        <input id="task-id" placeholder="任务ID（来自调用方 / MCP 结果）" autocomplete="off" required>
        <input id="peer-id" placeholder="接收方 peerId" list="peer-list" autocomplete="off" required>
        <datalist id="peer-list"></datalist>
        <button type="submit">添加观察</button>
      </form>
      <ul id="task-list"></ul>
      <div class="hint">等待 ACK 的本地外发消息（outbox）中发现的任务会自动加入，并标注 <code>外发箱</code>。</div>
    </section>
    <section class="panel" id="sessions-panel">
      <h2>本机侧会话</h2>
      <table id="session-table"><thead><tr><th>会话ID</th><th>Agent</th><th>工作区</th><th>状态</th><th>创建时间</th></tr></thead><tbody></tbody></table>
      <div class="hint">会话记录保存在 Agent 所属节点（接收方）；发起方网关合法地为空。想看对端会话，请在接收方节点运行本观察台。原生会话ID已在服务端脱敏，不会到达本页面。</div>
    </section>
  </div>
  <div class="col-right">
    <section class="panel" id="timeline-panel">
      <h2>任务时间线 <span id="timeline-task" class="mono"></span></h2>
      <div class="controls">
        <input id="filter-text" placeholder="按文本过滤" autocomplete="off">
        <select id="filter-type" title="按事件类型过滤">
          <option value="all">全部类型</option>
          <option value="delta">流式输出（delta）</option>
          <option value="permission">权限请求（permission）</option>
          <option value="terminal">终态事件</option>
          <option value="other">其他</option>
        </select>
        <button id="export" type="button" title="下载按白名单脱敏后的完整事件 JSON">导出脱敏 JSON</button>
      </div>
      <div class="legend">
        <span>列：序号 / 状态 / 类型 / 观察时间 / 摘要</span>
        <span>任务事件本身不含时间戳；此处时间为观察台收到该行的时间（按游标顺序，无重复乱序）。</span>
      </div>
      <ol id="events"></ol>
      <div id="not-observable" class="not-observable" hidden></div>
    </section>
  </div>
</main>
<footer>
  <strong>观察边界（V0，设计如此）：</strong>
  只显示外部可观察事实。本机接收的任务（本机为接收方）、对端的私有推理过程、原生工具内部、
  其他 Harness 的提示词以及非 Mesh 工具调用均为<em>不可观察（NOT-OBSERVABLE）</em>内容，绝不由本页面编造。
  UNKNOWN 不会自动恢复；取消请求只有收到终态事件后才显示为 CANCELLED；权限请求由网关 deny-only 策略自动拒绝（本页面不提供审批）。
</footer>
<script src="/app.js"></script>
</body>
</html>`;

export const PAGE_CSS = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0e1218; color: #d7dde6; font: 14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", ui-monospace, Menlo, Consolas, monospace; }
header { display: flex; align-items: center; gap: 12px; padding: 10px 18px; background: #161c26; border-bottom: 1px solid #2a3342; position: sticky; top: 0; z-index: 5; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; }
.logo { font-weight: 700; font-size: 13px; color: #7ee2a0; border: 1px solid #2e6b45; border-radius: 6px; padding: 2px 8px; letter-spacing: 1px; }
h1 { font-size: 15px; margin: 0; letter-spacing: .5px; font-weight: 600; }
h2 { font-size: 12px; margin: 0 0 10px; color: #8fa3bd; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
button { background: #222c3a; color: #d7dde6; border: 1px solid #37455a; border-radius: 6px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; }
button:hover { background: #2b3850; border-color: #4c5f7d; }
input, select { background: #0b0f14; border: 1px solid #37455a; color: #d7dde6; border-radius: 6px; padding: 6px 10px; font: inherit; font-size: 13px; }
input:focus, select:focus, button:focus-visible { outline: 1px solid #6a8dbd; outline-offset: 1px; }
.spacer { flex: 1; }
.ro-badge { background: #3b2f55; color: #cdb9ff; border: 1px solid #6a53a8; padding: 2px 9px; border-radius: 10px; font-size: 11px; }
.conn { padding: 2px 9px; border-radius: 10px; font-size: 11px; white-space: nowrap; }
.conn-ok { background: #14351f; color: #7ee2a0; border: 1px solid #2e6b45; }
.conn-down { background: #401414; color: #ff9c9c; border: 1px solid #7a2e2e; }
.conn-connecting { background: #3a3114; color: #ffe08a; border: 1px solid #7a6a2e; }
#banner { padding: 9px 18px; background: #401414; color: #ffb3b3; border-bottom: 1px solid #7a2e2e; font-size: 13px; }
main { padding: 14px 18px; display: grid; grid-template-columns: minmax(340px, 430px) 1fr; gap: 14px; max-width: 1400px; align-items: start; }
@media (max-width: 980px) { main { grid-template-columns: 1fr; } }
.col-left, .col-right { display: grid; gap: 14px; min-width: 0; }
.panel { background: #141a23; border: 1px solid #26303f; border-radius: 10px; padding: 14px; }
.hint { color: #6f7f95; font-size: 12px; margin-top: 10px; line-height: 1.6; }
.node-row { display: flex; align-items: stretch; gap: 10px; }
.node { flex: 1; border: 1px solid #2e3a4d; border-radius: 8px; padding: 10px 12px; min-height: 68px; background: #101620; }
.node.local { border-color: #2e6b45; }
.node.remote { border-color: #37455a; }
.node-title { font-size: 11px; color: #8fa3bd; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.node-body { white-space: pre-wrap; word-break: break-all; font-size: 12px; line-height: 1.7; color: #b9c4d4; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #525f70; display: inline-block; }
.dot-ok { background: #7ee2a0; }
.arrow { align-self: center; color: #7ee2a0; font-size: 22px; letter-spacing: -2px; }
#add-task { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
#task-id { flex: 2; min-width: 200px; }
#peer-id { flex: 1; min-width: 150px; }
#task-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; max-height: 34vh; overflow-y: auto; }
#task-list li { border: 1px solid #2e3a4d; border-radius: 8px; padding: 9px 11px; cursor: pointer; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; transition: border-color .15s; }
#task-list li:hover { border-color: #4c5f7d; }
#task-list li.selected { border-color: #8a6fd0; background: #1c2030; box-shadow: 0 0 0 1px #8a6fd0 inset; }
#task-list li.terminal { opacity: .8; }
.state { padding: 1px 9px; border-radius: 10px; font-size: 11px; border: 1px solid; white-space: nowrap; }
.state-QUEUED { color: #9fc1e8; border-color: #3c5a7a; background: #14202c; }
.state-RUNNING { color: #7ec3ff; border-color: #2e6b8a; background: #12222e; }
.state-WAITING_INPUT { color: #ffcf7e; border-color: #8a6a2e; background: #2e2412; }
.state-COMPLETED { color: #7ee2a0; border-color: #2e6b45; background: #12291a; }
.state-FAILED { color: #ff9c9c; border-color: #7a2e2e; background: #2a1414; }
.state-CANCELLED { color: #b9c2cf; border-color: #525f70; background: #1b2028; }
.state-UNKNOWN { color: #ff9cf3; border-color: #a82e9a; background: #2a1430; font-weight: bold; }
.state-NOT_OBSERVABLE { color: #8b93a0; border-color: #4a5260; border-style: dashed; background: #161a20; }
.task-meta { color: #8fa3bd; font-size: 12px; word-break: break-all; }
.task-source { font-size: 10px; color: #6f7f95; border: 1px solid #37455a; border-radius: 8px; padding: 0 7px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #222c3a; word-break: break-all; }
th { color: #8fa3bd; font-weight: normal; }
.controls { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
#filter-text { flex: 1; min-width: 150px; }
.legend { display: flex; justify-content: space-between; gap: 10px; color: #6f7f95; font-size: 11px; margin-bottom: 10px; flex-wrap: wrap; }
#events { list-style: none; margin: 0; padding: 0; max-height: 58vh; overflow-y: auto; border: 1px solid #222c3a; border-radius: 6px; background: #0e131b; }
#events li { display: flex; gap: 10px; padding: 5px 12px; border-bottom: 1px solid #1a2230; align-items: baseline; }
#events li:hover { background: #1a2230; }
.ev-seq { color: #5f6f85; min-width: 44px; text-align: right; font-size: 12px; }
.ev-type { min-width: 96px; font-size: 12px; }
.ev-type-delta { color: #7ec3ff; }
.ev-type-permission { color: #ffcf7e; }
.ev-type-terminal { color: #7ee2a0; }
.ev-type-other { color: #9fc1e8; }
.ev-time { color: #6f7f95; font-size: 11px; min-width: 100px; }
.ev-preview { white-space: pre-wrap; word-break: break-all; flex: 1; font-size: 13px; }
.ev-preview.dim { color: #8fa3bd; }
.ev-preview .sub { color: #6f7f95; font-size: 11px; margin-top: 2px; }
.not-observable { border: 1px dashed #4a5260; color: #9aa4b2; padding: 11px 13px; margin-top: 10px; border-radius: 6px; font-size: 12px; line-height: 1.7; background: #12161d; }
.mono { font-weight: normal; color: #7ee2a0; font-size: 12px; }
footer { padding: 14px 18px 26px; color: #6f7f95; font-size: 12px; max-width: 1400px; line-height: 1.8; }
code { color: #9fc1e8; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #26303f; border-radius: 6px; }
::-webkit-scrollbar-track { background: transparent; }`;

export const PAGE_JS = `'use strict';
(function () {
  var overview = null;
  var tasks = new Map();  // taskId -> view
  var selected = null;
  var paused = false;
  var POLL_MS = 800;

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function cookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i].trim();
      if (bit.indexOf(name + '=') === 0) return bit.slice(name.length + 1);
    }
    return '';
  }
  function api(path, options) {
    var init = options || {};
    init.credentials = 'same-origin';
    if (init.method && init.method !== 'GET') init.headers = { 'X-LAM-CSRF': cookie('lam_trace_csrf') };
    return fetch(path, init).then(function (res) {
      if (res.status === 401) {
        setConn('down', '会话已失效——请重启观察台进程，获取新的登录链接');
        throw new Error('unauthorized');
      }
      return res.json();
    });
  }
  function setConn(kind, text) {
    var node = $('conn');
    node.textContent = text;
    node.className = 'conn conn-' + kind;
  }
  function banner(text) {
    var node = $('banner');
    if (!text) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.textContent = text;
  }

  function taskView(taskId, peer, source) {
    if (!tasks.has(taskId)) {
      tasks.set(taskId, {
        taskId: taskId, peer: peer, cursor: 0, state: 'QUEUED', events: [],
        error: null, notObservable: false, terminal: false, lastObserved: null, source: source,
      });
    }
    return tasks.get(taskId);
  }

  function addTask(taskId, peer, source) {
    var view = taskView(taskId, peer, source);
    if (!selected) selected = taskId;
    renderTasks();
    pollTask(view, true);
  }

  function pullPage(view) {
    return api('/api/task?peer=' + encodeURIComponent(view.peer) + '&taskId=' + encodeURIComponent(view.taskId) + '&cursor=' + view.cursor)
      .then(function (data) {
        view.lastObserved = data.observedAt || new Date().toISOString();
        if (data.ok === false) {
          view.notObservable = true;
          view.error = data.error || (data.reason || '不可观察');
          view.notObservableReason = data.reason || null;
          renderTasks();
          if (selected === view.taskId) renderTimeline();
          return;
        }
        view.notObservable = false;
        view.state = data.state;
        view.terminal = !!data.terminal;
        var got = (data.events || []).length;
        for (var i = 0; i < got; i++) {
          var event = data.events[i];
          event.observedAt = data.observedAt;
          event.sourceType = '对端任务事件（经加密 mesh，由本机网关读取）';
          view.events.push(event);
        }
        view.cursor = data.next;
        renderTasks();
        if (selected === view.taskId) renderTimeline();
        // 网关每次只返回一页游标事件；即使状态已终态，也继续取到空页，
        // 保证补放的历史事件完整后再停止轮询。
        if (got > 0 && view.events.length < 8192) return pullPage(view);
      })
      .catch(function () { /* 瞬时轮询失败；断线提示在别处统一处理 */ });
  }

  function pollTask(view, force) {
    if (view.terminal && !force) return Promise.resolve();
    return pullPage(view);
  }

  function pollOverview() {
    return api('/api/overview').then(function (data) {
      overview = data;
      if (data.ok) {
        setConn('ok', '网关正常');
        banner('');
      } else {
        setConn('down', '网关不可达（' + (data.error || 'unknown') + '）');
        banner('无法读取本机网关。若网关已重启，其控制令牌已轮换：请点击「重新连接网关」。');
      }
      renderNodes();
      renderSessions();
      renderPeerOptions();
      autoDiscover();
    }).catch(function () {});
  }

  function autoDiscover() {
    if (!overview || !overview.pending) return;
    for (var i = 0; i < overview.pending.length; i++) {
      var row = overview.pending[i];
      if (row.taskId && !tasks.has(row.taskId)) addTask(row.taskId, row.peer, 'outbox');
    }
  }

  function renderNodes() {
    var local = $('local-node').querySelector('.node-body');
    var remote = $('remote-node').querySelector('.node-body');
    var statusSig = JSON.stringify(overview && overview.status) || 'null';
    if (renderNodes.statusSig !== statusSig) {
      renderNodes.statusSig = statusSig;
      local.textContent = '';
      if (overview && overview.status && overview.status.nodeId) {
        local.appendChild(el('div', null, '节点ID：' + overview.status.nodeId));
        local.appendChild(el('div', null, '指纹：' + (overview.status.fingerprint || '')));
        local.appendChild(el('div', null, '地址：' + (overview.status.addresses || []).join('，')));
      } else {
        local.textContent = '状态不可观察（网关不可达）';
      }
    }
    var view = selected ? tasks.get(selected) : null;
    var remoteSig = view ? (view.peer + '|' + view.taskId + '|' + (view.notObservable ? 'N' : view.state)) : 'none';
    if (renderNodes.remoteSig !== remoteSig) {
      renderNodes.remoteSig = remoteSig;
      remote.textContent = '';
      if (view) {
        remote.appendChild(el('div', null, 'peerId：' + view.peer));
        remote.appendChild(el('div', null, '任务ID：' + view.taskId));
        remote.appendChild(el('div', null, '状态：' + (view.notObservable ? '不可观察（NOT-OBSERVABLE）' : view.state)));
      } else {
        remote.textContent = '未选择任务';
      }
    }
  }

  function renderSessions() {
    var sig = JSON.stringify(overview && overview.sessions);
    if (renderSessions.sig === sig) return;
    renderSessions.sig = sig;
    var body = $('session-table').querySelector('tbody');
    body.textContent = '';
    var rows = (overview && overview.sessions) || [];
    if (!rows.length) {
      var tr = el('tr');
      var td = el('td', null, overview ? '暂无会话（会话记录在接收方节点）' : '不可观察（网关不可达）');
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i];
      var row = el('tr');
      row.appendChild(el('td', null, s.id));
      row.appendChild(el('td', null, s.agentId));
      row.appendChild(el('td', null, s.workspaceAlias));
      row.appendChild(el('td', null, s.state));
      row.appendChild(el('td', null, s.createdAt));
      body.appendChild(row);
    }
  }

  function renderPeerOptions() {
    var list = $('peer-list');
    list.textContent = '';
    var seen = {};
    var peers = (overview && overview.peers) || [];
    for (var i = 0; i < peers.length; i++) seen[peers[i].peer] = true;
    tasks.forEach(function (view) { seen[view.peer] = true; });
    Object.keys(seen).forEach(function (peer) {
      var option = el('option');
      option.value = peer;
      list.appendChild(option);
    });
  }

  var SOURCE_LABEL = { outbox: '外发箱', manual: '手动', link: '链接' };

  function renderTasks() {
    // 轮询期间内容通常不变：仅在签名变化时重建列表，避免 800ms 一次的
    // 全量重排打断点击、滚动与文本选择。
    var sig = '';
    tasks.forEach(function (view) {
      sig += view.taskId + ',' + (view.notObservable ? 'N' : view.state) + ',' + view.events.length + ',' + (view.error || '') + ',' + (view.taskId === selected ? 1 : 0) + ',' + view.terminal + ';';
    });
    if (renderTasks.sig === sig) return;
    renderTasks.sig = sig;
    var list = $('task-list');
    list.textContent = '';
    tasks.forEach(function (view) {
      var li = el('li');
      if (view.taskId === selected) li.className = 'selected' + (view.terminal ? ' terminal' : '');
      else if (view.terminal) li.className = 'terminal';
      var state = view.notObservable ? 'NOT_OBSERVABLE' : view.state;
      li.appendChild(el('span', 'state state-' + state, view.notObservable ? '不可观察' : state));
      li.appendChild(el('span', 'task-meta', view.taskId + ' → ' + view.peer));
      li.appendChild(el('span', 'task-source', SOURCE_LABEL[view.source] || view.source));
      li.appendChild(el('span', 'task-meta', view.events.length + ' 条事件'));
      if (view.error) li.appendChild(el('span', 'task-meta', '错误：' + view.error));
      li.addEventListener('click', function () { selected = view.taskId; renderTasks(); renderNodes(); renderTimeline(); });
      list.appendChild(li);
    });
  }

  function typeClass(type) {
    if (type === 'delta') return 'delta';
    if (type === 'permission') return 'permission';
    if (type === 'completed' || type === 'failed' || type === 'cancelled' || type === 'unknown') return 'terminal';
    return 'other';
  }

  function renderTimeline() {
    var view = selected ? tasks.get(selected) : null;
    // 同 renderTasks：内容签名未变化时不重建，保持滚动位置与交互稳定。
    var sig = view
      ? view.taskId + '|' + view.state + '|' + view.notObservable + '|' + view.terminal + '|' + view.events.length + '|' + ($('filter-text').value || '') + '|' + $('filter-type').value
      : 'none';
    if (renderTimeline.sig === sig) return;
    renderTimeline.sig = sig;
    $('timeline-task').textContent = view ? (view.taskId + ' @ ' + view.peer) : '';
    var list = $('events');
    var notice = $('not-observable');
    list.textContent = '';
    notice.hidden = true;
    notice.textContent = '';
    if (!view) {
      notice.hidden = false;
      notice.textContent = '尚未选择任务。请在左侧填入任务ID（调用方持有它），或等待外发箱任务自动出现。';
      return;
    }
    var filterText = ($('filter-text').value || '').toLowerCase();
    var filterType = $('filter-type').value;
    var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    for (var i = 0; i < view.events.length; i++) {
      var event = view.events[i];
      if (filterType !== 'all' && typeClass(event.type) !== filterType) continue;
      var preview = event.preview || '';
      if (filterText && (event.type + ' ' + preview).toLowerCase().indexOf(filterText) === -1) continue;
      var li = el('li');
      li.appendChild(el('span', 'ev-seq', '#' + event.seq));
      var stateNode = el('span', 'state state-' + view.state, event.type === 'permission' ? 'WAITING_INPUT' : view.state);
      li.appendChild(stateNode);
      li.appendChild(el('span', 'ev-type ev-type-' + typeClass(event.type), event.type));
      li.appendChild(el('span', 'ev-time', event.observedAt || ''));
      if (event.permission) {
        var p = el('span', 'ev-preview');
        p.appendChild(el('div', null, '权限请求 ' + event.permission.requestId));
        var sub1 = el('div', 'sub', '摘要 ' + event.permission.operationDigest + ' · 有效期至 ' + event.permission.expiresAt);
        p.appendChild(sub1);
        var sub2 = el('div', 'sub', '网关审批策略为 deny-only：已自动拒绝；本页面不提供任何批准操作');
        p.appendChild(sub2);
        li.appendChild(p);
      } else if (event.droppedFields && event.droppedFields.length) {
        var d = el('span', 'ev-preview');
        d.appendChild(el('div', null, preview || '（无摘要）'));
        var sub3 = el('div', 'sub', '服务端已丢弃未列入白名单的字段：' + event.droppedFields.join('，'));
        d.appendChild(sub3);
        li.appendChild(d);
      } else {
        li.appendChild(el('span', 'ev-preview' + (event.type === 'delta' ? ' dim' : ''), preview || '（无摘要）'));
      }
      list.appendChild(li);
    }
    if (view.notObservable) {
      notice.hidden = false;
      notice.textContent = '不可观察（NOT-OBSERVABLE）：' + (view.notObservableReason || ('网关拒绝（' + view.error + '）。该任务可能属于其他授权范围、对端可能离线，或本机即接收方（V0 仅提供发起方事件）。'));
    } else if (view.terminal) {
      notice.hidden = false;
      notice.textContent = '已到终态 ' + view.state + '，轮询停止（可导出，或重新添加以刷新）。';
    }
    if (!paused && atBottom) list.scrollTop = list.scrollHeight;
  }

  $('add-task').addEventListener('submit', function (event) {
    event.preventDefault();
    var taskId = $('task-id').value.trim();
    var peer = $('peer-id').value.trim();
    if (!taskId || !peer) return;
    addTask(taskId, peer, 'manual');
    $('task-id').value = '';
  });
  $('pause').addEventListener('click', function () {
    paused = !paused;
    $('pause').textContent = paused ? '恢复自动滚动' : '暂停自动滚动';
  });
  $('reconnect').addEventListener('click', function () {
    api('/api/reconnect', { method: 'POST' }).then(function (data) {
      banner(data.ok ? '已重新连接网关控制接口。' : '重连失败：' + (data.error || 'unknown'));
    }).catch(function () {});
  });
  $('export').addEventListener('click', function () {
    var view = selected ? tasks.get(selected) : null;
    if (!view) return;
    fetch('/api/export?peer=' + encodeURIComponent(view.peer) + '&taskId=' + encodeURIComponent(view.taskId), { credentials: 'same-origin' })
      .then(function (res) { return res.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'lam-trace-' + view.taskId + '-redacted.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
  });
  $('filter-text').addEventListener('input', renderTimeline);
  $('filter-type').addEventListener('change', renderTimeline);

  renderTasks();
  renderTimeline();
  // 支持形如 #task=<任务ID>&peer=<peerId> 的深链预填（值来自调用方已知信息），
  // 便于演示与现场联调。
  try {
    var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    var presetTask = hash.get('task');
    var presetPeer = hash.get('peer');
    if (presetTask && presetPeer) addTask(presetTask, presetPeer, 'link');
  } catch (e) { /* 非法 hash 直接忽略 */ }
  pollOverview();
  setInterval(pollOverview, POLL_MS);
  setInterval(function () {
    tasks.forEach(function (view) { pollTask(view, false); });
  }, POLL_MS);
})();`;
