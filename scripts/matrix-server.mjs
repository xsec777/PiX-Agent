#!/usr/bin/env node
/**
 * matrix-server.mjs — 零依赖原生 SSE 实时攻防大屏服务 (Live Matrix Server)
 *
 * 核心功能：
 * 1. 采用 Node.js 原生 http / fs / path 模块编写，零第三方 npm 依赖，开箱即用；
 * 2. 默认监听本地端口 30142 (与主服务 30141 物理隔离，互不干扰)；
 * 3. 提供 /events 端点 (Server-Sent Events / SSE 协议)：
 *    - 实时监听 cwd/pix-live-matrix.json 文件更新，毫秒级向前端推流最新增量；
 * 4. 提供 /api/matrix REST 端点与 / 根路由原生赛博暗黑主题大屏前端页面。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number.parseInt(process.env.PIX_MATRIX_PORT || "30142", 10);
const HOST = process.env.PIX_MATRIX_HOST || "127.0.0.1";
const CWD = process.cwd();
const MATRIX_FILE = path.join(CWD, "pix-live-matrix.json");

const sseClients = new Set();

/** 读取当前实时矩阵数据 (带容错兜底) */
function getMatrixData() {
	if (fs.existsSync(MATRIX_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
		} catch {}
	}
	return {
		version: "2.0.16",
		updatedAt: new Date().toISOString(),
		lastSource: "idle",
		metrics: {
			totalEndpoints: 0,
			closedEndpoints: 0,
			closedPercentage: 0,
			confirmedCount: 0,
			rejectedCount: 0,
			blockedCount: 0,
			escalatingCount: 0,
			bypassingCount: 0,
			probingCount: 0,
			discoveredCount: 0,
		},
		currentFocus: null,
		hosts: [],
		endpoints: [],
	};
}

/** 广播 SSE 增量事件给所有已连接的浏览器客户端 */
function broadcastSSE(data) {
	const payload = `data: ${JSON.stringify(data)}\n\n`;
	for (const client of sseClients) {
		try {
			client.write(payload);
		} catch {
			sseClients.delete(client);
		}
	}
}

// 监听 pix-live-matrix.json 文件变更
let watchDebounce = null;
if (fs.existsSync(CWD)) {
	try {
		fs.watch(CWD, (_eventType, filename) => {
			if (filename === "pix-live-matrix.json") {
				if (watchDebounce) clearTimeout(watchDebounce);
				watchDebounce = setTimeout(() => {
					broadcastSSE(getMatrixData());
				}, 150);
			}
		});
	} catch {}
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>PiX — 攻防接口测试实时监控大屏</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg: #0b0f19;
      --card: #111827;
      --border: #1f293d;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --primary: #3b82f6;
      --green: #10b981;
      --red: #ef4444;
      --yellow: #f59e0b;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 100vh;
    }
    header {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
      font-weight: 700;
    }
    .pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px var(--green);
      animation: p 2s infinite;
    }
    @keyframes p { 0%,100%{opacity:1} 50%{opacity:.3} }
    .stats-bar {
      display: flex;
      gap: 18px;
      font-size: 12px;
      color: var(--muted);
      flex-wrap: wrap;
      width: 100%;
      border-top: 1px solid var(--border);
      padding-top: 10px;
      margin-top: 6px;
    }
    .stats-bar b { color: var(--text); }
    .progress-wrap {
      width: 100%;
      height: 8px;
      background: #1f2937;
      border-radius: 999px;
      overflow: hidden;
      display: flex;
      margin-top: 4px;
    }
    .seg { height: 100%; transition: width .3s ease; }
    .main-grid {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 14px;
      flex: 1;
    }
    @media (max-width: 860px) { .main-grid { grid-template-columns: 1fr; } }
    .card-panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      max-height: 480px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #0f172a; padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; position: sticky; top: 0; }
    td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:hover { background: rgba(255,255,255,0.03); cursor: pointer; }
    .badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 12px;
      font-weight: 600;
      display: inline-block;
    }
    .badge.confirmed { background: rgba(239,68,68,0.2); color: #fca5a5; }
    .badge.rejected { background: rgba(16,185,129,0.18); color: #86efac; }
    .badge.bypassing { background: rgba(139,92,246,0.2); color: #c4b5fd; }
    .badge.probing { background: rgba(245,158,11,0.2); color: #fcd34d; }
    .badge.discovered { background: rgba(100,116,139,0.2); color: #94a3b8; }
    .badge.escalating { background: rgba(59,130,246,0.2); color: #93c5fd; }
    .method { font-weight: 700; font-size: 10px; padding: 1px 4px; border-radius: 3px; }
    .method.get { background: #1e3a8a; color: #93c5fd; }
    .method.post { background: #064e3b; color: #6ee7b7; }
    .code-box {
      background: #080c14;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px;
      font-size: 11px;
      max-height: 160px;
      overflow-x: auto;
      white-space: pre-wrap;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="pulse" id="sse-pulse"></span>
      PiX 攻防接口测试实时监控大屏 (Live SSE Matrix)
    </div>
    <div style="font-size: 11px; color: var(--muted);" id="sse-status">
      已建立 SSE 实时通道 (端口 30142)
    </div>
    <div class="stats-bar">
      <div>全部资产: <b id="stat-hosts">0</b> 主机</div>
      <div>提取端点: <b id="stat-total">0</b> 接口</div>
      <div>已闭环: <b id="stat-closed" style="color: var(--green);">0</b> (<span id="stat-pct">0%</span>)</div>
      <div>坐实漏洞: <b id="stat-vuln" style="color: var(--red);">0</b> 处</div>
      <div>变异绕过中: <b id="stat-bypassing" style="color: var(--purple);">0</b> 处</div>
      <div>焦点攻坚: <b id="stat-focus" style="color: #60a5fa;">空闲</b></div>
    </div>
    <div class="progress-wrap">
      <div class="seg" id="b-confirmed" style="background: var(--red); width: 0%;"></div>
      <div class="seg" id="b-rejected" style="background: var(--green); width: 0%;"></div>
      <div class="seg" id="b-bypassing" style="background: var(--purple); width: 0%;"></div>
      <div class="seg" id="b-probing" style="background: var(--yellow); width: 0%;"></div>
      <div class="seg" id="b-discovered" style="background: #475569; width: 0%;"></div>
    </div>
  </header>

  <div class="main-grid">
    <div class="card-panel">
      <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">目标站点资产</div>
      <div id="hosts-container" style="display:flex; flex-direction:column; gap:8px;"></div>
    </div>

    <div class="card-panel">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">全量接口台账矩阵</span>
        <span style="font-size: 11px; color: var(--muted);" id="table-summary">0 接口</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:60px;">方法</th>
              <th>URL 端点</th>
              <th>核心参数</th>
              <th style="width:70px; text-align:center;">测试次数</th>
              <th style="width:95px;">状态机</th>
              <th>实测结论</th>
            </tr>
          </thead>
          <tbody id="ep-tbody"></tbody>
        </table>
      </div>

      <div style="border-top:1px solid var(--border); padding-top:10px; display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:12px; font-weight:600;" id="drawer-title">点击上方任意接口查看实时复现报文与证据</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <div style="font-size:10px; color:var(--muted); margin-bottom:2px;">原始请求包 (Raw Request):</div>
            <div class="code-box" id="drawer-req">暂无</div>
          </div>
          <div>
            <div style="font-size:10px; color:var(--muted); margin-bottom:2px;">响应差分证据 (Response Diff):</div>
            <div class="code-box" id="drawer-resp">暂无</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentData = null;
    let selectedId = null;

    function render(data) {
      if (!data) return;
      currentData = data;
      const m = data.metrics || {};
      const total = m.totalEndpoints || 0;

      document.getElementById('stat-hosts').innerText = (data.hosts || []).length;
      document.getElementById('stat-total').innerText = total;
      document.getElementById('stat-closed').innerText = m.closedEndpoints || 0;
      document.getElementById('stat-pct').innerText = (m.closedPercentage || 0) + '%';
      document.getElementById('stat-vuln').innerText = m.confirmedCount || 0;
      document.getElementById('stat-bypassing').innerText = m.bypassingCount || 0;
      document.getElementById('stat-focus').innerText = data.currentFocus ? (data.currentFocus.method + ' ' + data.currentFocus.url) : '无活动焦点';

      if (total > 0) {
        document.getElementById('b-confirmed').style.width = ((m.confirmedCount / total) * 100) + '%';
        document.getElementById('b-rejected').style.width = ((m.rejectedCount / total) * 100) + '%';
        document.getElementById('b-bypassing').style.width = ((m.bypassingCount / total) * 100) + '%';
        document.getElementById('b-probing').style.width = ((m.probingCount / total) * 100) + '%';
        document.getElementById('b-discovered').style.width = ((m.discoveredCount / total) * 100) + '%';
      }

      // 渲染 Hosts
      const hBox = document.getElementById('hosts-container');
      hBox.innerHTML = (data.hosts || []).map(h => \`
        <div style="background:#0b0f19; border:1px solid var(--border); border-radius:6px; padding:8px 10px;">
          <div style="font-weight:600; font-size:12px; display:flex; justify-content:space-between;">
            <span>\${h.hostname || h.ips[0]}</span>
            <span style="font-size:10px; color:\${h.isCompromised ? 'var(--red)' : 'var(--muted)'};">\${h.isCompromised ? 'PWNED' : h.networkScope || 'EXT'}</span>
          </div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">\${h.ips.join('/')} | 服务: \${(h.services || []).length}个</div>
        </div>
      \`).join('') || '<div style="font-size:11px; color:var(--muted);">暂无存活主机资产</div>';

      // 渲染 Endpoints
      const tbody = document.getElementById('ep-tbody');
      tbody.innerHTML = (data.endpoints || []).map(e => \`
        <tr onclick="selectEp('\${e.id}')">
          <td><span class="method \${e.method.toLowerCase()}">\${e.method}</span></td>
          <td style="font-weight:500;">\${e.url}</td>
          <td style="color:var(--muted); font-size:11px;">\${(e.params || []).join(', ') || '-'}</td>
          <td style="text-align:center;">\${e.testedTimes || 0}</td>
          <td><span class="badge \${e.status}">\${e.status}</span></td>
          <td style="color:\${e.status === 'confirmed' ? 'var(--red)' : 'inherit'};">\${(e.vulnerabilities || []).join('、') || '-'}</td>
        </tr>
      \`).join('') || '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--muted);">暂无接口台账记录</td></tr>';

      document.getElementById('table-summary').innerText = \`共 \${total} 端点\`;
      if (selectedId) selectEp(selectedId);
    }

    function selectEp(id) {
      selectedId = id;
      if (!currentData || !currentData.endpoints) return;
      const ep = currentData.endpoints.find(e => e.id === id);
      if (!ep) return;
      document.getElementById('drawer-title').innerText = \`[\${ep.id}] \${ep.method} \${ep.url} (已测 \${ep.testedTimes} 次 | 状态: \${ep.status.toUpperCase()})\`;
      document.getElementById('drawer-req').innerText = ep.evidenceRequest || '未捕获原始请求包';
      document.getElementById('drawer-resp').innerText = ep.evidenceResponse || '未捕获差分响应特征';
    }

    // 建立 SSE 实时通道
    function initSSE() {
      const evt = new EventSource('/events');
      evt.onmessage = (e) => {
        try { render(JSON.parse(e.data)); } catch {}
      };
      evt.onerror = () => {
        document.getElementById('sse-status').innerText = '正在尝试重连 SSE...';
      };
      evt.onopen = () => {
        document.getElementById('sse-status').innerText = 'SSE 实时推流已就绪 (端口 30142)';
      };
    }

    fetch('/api/matrix').then(r => r.json()).then(render).finally(initSSE);
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
	const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

	// Passive telemetry only: reject all methods that could be interpreted as writes.
	if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
		res.writeHead(405, {
			"Content-Type": "application/json",
			Allow: "GET, HEAD, OPTIONS",
			"Access-Control-Allow-Origin": "*",
		});
		res.end(JSON.stringify({ error: "Method Not Allowed", message: "PiX Matrix Server is read-only; state changes must use the authorized CLI session." }));
		return;
	}

	// 1. SSE 实时推流
	if (url.pathname === "/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Access-Control-Allow-Origin": "*",
		});
		res.write(`data: ${JSON.stringify(getMatrixData())}\n\n`);
		sseClients.add(res);
		req.on("close", () => sseClients.delete(res));
		return;
	}

	// 2. REST API 接口
	if (url.pathname === "/api/matrix") {
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		});
		res.end(JSON.stringify(getMatrixData()));
		return;
	}

	// 3. HTML 大屏页面
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(HTML_PAGE);
});

server.listen(PORT, HOST, () => {
	console.log(`[PiX Matrix Server] 实时监控大屏已启动: http://${HOST}:${PORT}`);
});
