// Static single-page assets for the read-only trace console. The HTML carries
// no interpolated data: every value shown is fetched from /api/* (JSON) and
// rendered through DOM textContent/createElement only, so untrusted task text
// can never execute. No external origins, fonts or CDNs are referenced.

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LAM Trace Console (read-only)</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header>
  <h1>LAM Trace Console</h1>
  <span class="ro-badge" title="This console cannot approve, send, cancel or pair anything.">READ-ONLY OBSERVER</span>
  <span id="conn" class="conn conn-connecting">CONNECTING</span>
  <span class="spacer"></span>
  <button id="pause" type="button">Pause auto-scroll</button>
  <button id="reconnect" type="button">Re-attach Gateway</button>
</header>
<div id="banner" hidden></div>
<main>
  <section class="panel" id="nodes-panel">
    <h2>Nodes</h2>
    <div class="node-row">
      <div class="node local" id="local-node"><div class="node-title">This node (caller)</div><div class="node-body">…</div></div>
      <div class="arrow" id="arrow">──▶</div>
      <div class="node remote" id="remote-node"><div class="node-title">Selected peer (receiver)</div><div class="node-body">no task selected</div></div>
    </div>
    <div class="hint">Events flow over the encrypted mesh; this console reads them through the local Gateway only.</div>
  </section>
  <section class="panel" id="watch-panel">
    <h2>Watched tasks</h2>
    <form id="add-task">
      <input id="task-id" placeholder="taskId (from the caller / MCP result)" autocomplete="off" required>
      <input id="peer-id" placeholder="receiver peerId" list="peer-list" autocomplete="off" required>
      <datalist id="peer-list"></datalist>
      <button type="submit">Watch</button>
    </form>
    <ul id="task-list"></ul>
    <div class="hint">Tasks discovered from the local outbox (awaiting ACK) are added automatically and marked <code>outbox</code>.</div>
  </section>
  <section class="panel" id="sessions-panel">
    <h2>Sessions on this node</h2>
    <table id="session-table"><thead><tr><th>sessionId</th><th>agent</th><th>workspace</th><th>state</th><th>created</th></tr></thead><tbody></tbody></table>
    <div class="hint">Sessions are persisted by the node that owns the agent (the receiver); a caller-side Gateway has none. Run this console on the receiver node to see its sessions. Native session IDs are redacted server-side and never reach this page.</div>
  </section>
  <section class="panel" id="timeline-panel">
    <h2>Timeline <span id="timeline-task" class="mono"></span></h2>
    <div class="controls">
      <input id="filter-text" placeholder="filter by text" autocomplete="off">
      <select id="filter-type">
        <option value="all">all types</option>
        <option value="delta">delta</option>
        <option value="permission">permission</option>
        <option value="terminal">terminal</option>
        <option value="other">other</option>
      </select>
      <button id="export" type="button">Export redacted JSON</button>
    </div>
    <div class="legend">
      <span>seq / state / type / observed-at / preview</span>
      <span>Task events carry no embedded timestamp; the time shown is when this console observed the row (cursor-ordered).</span>
    </div>
    <ol id="events"></ol>
    <div id="not-observable" class="not-observable" hidden></div>
  </section>
</main>
<footer>
  <strong>Observability limits (V0, by design):</strong>
  only externally observable facts are shown. Locally-received tasks (this node as receiver),
  the receiver's private reasoning, native tool internals, prompts of other harnesses and
  non-Mesh tool calls are <em>NOT-OBSERVABLE</em> and never invented. UNKNOWN never auto-resolves;
  a cancel request is only CANCELLED after the terminal event. Permission requests are answered by
  the Gateway's deny-only policy (no approval UI here).
</footer>
<script src="/app.js"></script>
</body>
</html>`;

export const PAGE_CSS = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #10141a; color: #d7dde6; font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #171d26; border-bottom: 1px solid #2a3342; position: sticky; top: 0; }
h1 { font-size: 15px; margin: 0; letter-spacing: .5px; }
h2 { font-size: 13px; margin: 0 0 8px; color: #8fa3bd; text-transform: uppercase; letter-spacing: .8px; }
button { background: #222c3a; color: #d7dde6; border: 1px solid #37455a; border-radius: 4px; padding: 5px 10px; font: inherit; cursor: pointer; }
button:hover { background: #2b3850; }
input, select { background: #0d1117; border: 1px solid #37455a; color: #d7dde6; border-radius: 4px; padding: 5px 8px; font: inherit; }
.spacer { flex: 1; }
.ro-badge { background: #3b2f55; color: #cdb9ff; border: 1px solid #6a53a8; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.conn { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.conn-ok { background: #14351f; color: #7ee2a0; border: 1px solid #2e6b45; }
.conn-down { background: #401414; color: #ff9c9c; border: 1px solid #7a2e2e; }
.conn-connecting { background: #3a3114; color: #ffe08a; border: 1px solid #7a6a2e; }
#banner { padding: 8px 16px; background: #401414; color: #ffb3b3; border-bottom: 1px solid #7a2e2e; }
main { padding: 14px 16px; display: grid; gap: 14px; max-width: 1100px; }
.panel { background: #151b24; border: 1px solid #26303f; border-radius: 6px; padding: 12px; }
.hint { color: #6f7f95; font-size: 12px; margin-top: 8px; }
.node-row { display: flex; align-items: stretch; gap: 12px; }
.node { flex: 1; border: 1px solid #2e3a4d; border-radius: 6px; padding: 8px 10px; min-height: 64px; }
.node.local { border-color: #2e6b45; }
.node.remote { border-color: #37455a; }
.node-title { font-size: 11px; color: #8fa3bd; text-transform: uppercase; margin-bottom: 6px; }
.node-body { white-space: pre-wrap; word-break: break-all; font-size: 12px; }
.arrow { align-self: center; color: #7ee2a0; font-size: 20px; }
#add-task { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
#task-id { flex: 2; min-width: 220px; }
#peer-id { flex: 1; min-width: 160px; }
#task-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
#task-list li { border: 1px solid #2e3a4d; border-radius: 6px; padding: 8px 10px; cursor: pointer; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#task-list li.selected { border-color: #6a53a8; background: #1c2030; }
#task-list li.terminal { opacity: .85; }
.state { padding: 1px 8px; border-radius: 10px; font-size: 11px; border: 1px solid; white-space: nowrap; }
.state-QUEUED { color: #9fc1e8; border-color: #3c5a7a; background: #14202c; }
.state-RUNNING { color: #7ec3ff; border-color: #2e6b8a; background: #12222e; }
.state-WAITING_INPUT { color: #ffcf7e; border-color: #8a6a2e; background: #2e2412; }
.state-COMPLETED { color: #7ee2a0; border-color: #2e6b45; background: #12291a; }
.state-FAILED { color: #ff9c9c; border-color: #7a2e2e; background: #2a1414; }
.state-CANCELLED { color: #b9c2cf; border-color: #525f70; background: #1b2028; }
.state-UNKNOWN { color: #ff9cf3; border-color: #a82e9a; background: #2a1430; font-weight: bold; }
.state-NOT_OBSERVABLE { color: #8b93a0; border-color: #4a5260; border-style: dashed; background: #161a20; }
.task-meta { color: #8fa3bd; font-size: 12px; word-break: break-all; }
.task-source { font-size: 10px; color: #6f7f95; border: 1px solid #37455a; border-radius: 8px; padding: 0 6px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #222c3a; word-break: break-all; }
th { color: #8fa3bd; font-weight: normal; }
.controls { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
#filter-text { flex: 1; min-width: 160px; }
.legend { display: flex; justify-content: space-between; gap: 10px; color: #6f7f95; font-size: 11px; margin-bottom: 8px; flex-wrap: wrap; }
#events { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow-y: auto; border: 1px solid #222c3a; border-radius: 4px; }
#events li { display: flex; gap: 10px; padding: 4px 10px; border-bottom: 1px solid #1a2230; align-items: baseline; }
#events li:hover { background: #1a2230; }
.ev-seq { color: #5f6f85; min-width: 44px; text-align: right; }
.ev-type { color: #9fc1e8; min-width: 90px; }
.ev-time { color: #6f7f95; font-size: 11px; min-width: 96px; }
.ev-preview { white-space: pre-wrap; word-break: break-all; flex: 1; }
.ev-preview.dim { color: #8fa3bd; }
.not-observable { border: 1px dashed #4a5260; color: #8b93a0; padding: 10px; margin-top: 8px; border-radius: 4px; }
.mono { font-weight: normal; color: #7ee2a0; }
footer { padding: 12px 16px 24px; color: #6f7f95; font-size: 12px; max-width: 1100px; }
code { color: #9fc1e8; }`;

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
        setConn('down', 'SESSION EXPIRED — restart the console process for a new login URL');
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
          view.error = data.error || (data.reason || 'not observable');
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
          event.sourceType = 'remote-task-events (encrypted mesh via local Gateway)';
          view.events.push(event);
        }
        view.cursor = data.next;
        renderTasks();
        if (selected === view.taskId) renderTimeline();
        // The Gateway returns one cursor page per call; keep draining until an
        // empty page even after the state is terminal, so replayed history is
        // complete before polling stops.
        if (got > 0 && view.events.length < 8192) return pullPage(view);
      })
      .catch(function () { /* transient poll failure; banner handled elsewhere */ });
  }

  function pollTask(view, force) {
    if (view.terminal && !force) return Promise.resolve();
    return pullPage(view);
  }

  function pollOverview() {
    return api('/api/overview').then(function (data) {
      overview = data;
      if (data.ok) {
        setConn('ok', 'GATEWAY OK');
        banner('');
      } else {
        setConn('down', 'GATEWAY UNREACHABLE (' + (data.error || 'unknown') + ')');
        banner('Cannot read the local Gateway. If the Gateway restarted, its control token rotated: use Re-attach Gateway.');
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
    local.textContent = '';
    remote.textContent = '';
    if (overview && overview.status && overview.status.nodeId) {
      local.appendChild(el('div', null, 'nodeId: ' + overview.status.nodeId));
      local.appendChild(el('div', null, 'fingerprint: ' + (overview.status.fingerprint || '')));
      local.appendChild(el('div', null, 'addresses: ' + (overview.status.addresses || []).join(', ')));
    } else {
      local.textContent = 'status NOT-OBSERVABLE (gateway unreachable)';
    }
    var view = selected ? tasks.get(selected) : null;
    if (view) {
      remote.appendChild(el('div', null, 'peerId: ' + view.peer));
      remote.appendChild(el('div', null, 'taskId: ' + view.taskId));
      remote.appendChild(el('div', null, 'state: ' + (view.notObservable ? 'NOT-OBSERVABLE' : view.state)));
    } else {
      remote.textContent = 'no task selected';
    }
  }

  function renderSessions() {
    var body = $('session-table').querySelector('tbody');
    body.textContent = '';
    var rows = (overview && overview.sessions) || [];
    if (!rows.length) {
      var tr = el('tr');
      var td = el('td', null, rows.length === 0 && overview ? 'no sessions' : 'NOT-OBSERVABLE (gateway unreachable)');
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

  function renderTasks() {
    var list = $('task-list');
    list.textContent = '';
    tasks.forEach(function (view) {
      var li = el('li');
      if (view.taskId === selected) li.className = 'selected' + (view.terminal ? ' terminal' : '');
      else if (view.terminal) li.className = 'terminal';
      var state = view.notObservable ? 'NOT_OBSERVABLE' : view.state;
      li.appendChild(el('span', 'state state-' + state, state));
      li.appendChild(el('span', 'task-meta', view.taskId + ' → ' + view.peer));
      li.appendChild(el('span', 'task-source', view.source === 'outbox' ? 'outbox' : 'manual'));
      li.appendChild(el('span', 'task-meta', view.events.length + ' events'));
      if (view.error) li.appendChild(el('span', 'task-meta', 'error: ' + view.error));
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
    $('timeline-task').textContent = view ? (view.taskId + ' @ ' + view.peer) : '';
    var list = $('events');
    var notice = $('not-observable');
    list.textContent = '';
    notice.hidden = true;
    notice.textContent = '';
    if (!view) {
      notice.hidden = false;
      notice.textContent = 'No task selected. Add a taskId above (the caller side knows it), or watch outbox tasks appear automatically.';
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
      li.appendChild(el('span', 'ev-type', event.type));
      li.appendChild(el('span', 'ev-time', event.observedAt || ''));
      if (event.permission) {
        var p = el('span', 'ev-preview');
        p.appendChild(el('div', null, 'permission request ' + event.permission.requestId));
        p.appendChild(el('div', 'dim', 'digest ' + event.permission.operationDigest + ' · expires ' + event.permission.expiresAt));
        p.appendChild(el('div', 'dim', 'Gateway approval policy is deny-only: auto-denied, no approval from this page'));
        li.appendChild(p);
      } else if (event.droppedFields && event.droppedFields.length) {
        var d = el('span', 'ev-preview');
        d.appendChild(el('div', null, preview || '(no text)'));
        d.appendChild(el('div', 'dim', 'server dropped non-whitelisted fields: ' + event.droppedFields.join(', ')));
        li.appendChild(d);
      } else {
        li.appendChild(el('span', 'ev-preview' + (event.type === 'delta' ? ' dim' : ''), preview || '(no preview)'));
      }
      list.appendChild(li);
    }
    if (view.notObservable) {
      notice.hidden = false;
      notice.textContent = 'NOT-OBSERVABLE: ' + (view.notObservableReason || ('Gateway refused (' + view.error + '). The task may belong to another grant, the peer may be offline, or this node may be the receiver (caller-side events only in V0).'));
    } else if (view.terminal) {
      notice.hidden = false;
      notice.textContent = 'Terminal state ' + view.state + ' reached; polling stopped (export or re-add to refresh).';
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
    $('pause').textContent = paused ? 'Resume auto-scroll' : 'Pause auto-scroll';
  });
  $('reconnect').addEventListener('click', function () {
    api('/api/reconnect', { method: 'POST' }).then(function (data) {
      banner(data.ok ? 'Re-attached to the Gateway control endpoint.' : 'Re-attach failed: ' + (data.error || 'unknown'));
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
  // Deep links like #task=<taskId>&peer=<peerId> pre-watch a task (values the
  // caller already knows); useful for pairing this page with a demo run.
  try {
    var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    var presetTask = hash.get('task');
    var presetPeer = hash.get('peer');
    if (presetTask && presetPeer) addTask(presetTask, presetPeer, 'link');
  } catch (e) { /* malformed hash is ignored */ }
  pollOverview();
  setInterval(pollOverview, POLL_MS);
  setInterval(function () {
    tasks.forEach(function (view) { pollTask(view, false); });
  }, POLL_MS);
})();`;
