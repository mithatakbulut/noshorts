// ==UserScript==
// @name         NoShorts — YouTube Time
// @namespace    https://github.com/mithatakbulut/noshorts
// @version      0.2.2
// @description  An intentional daily YouTube budget, with private viewing history.
// @license      MIT
// @match        *://youtube.com/*
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @run-at       document-start
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// ==/UserScript==

(() => {
  'use strict';
  const PREFIX = 'noshorts:v1:';
  const MINUTE = 60000;
  const dayKey = time => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const nextMidnight = time => {
    const d = new Date(time);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  };
  const tomorrow = day => dayKey(nextMidnight(new Date(`${day}T12:00:00`).getTime()));

  const dailySeries = (budget, count) => {
    const end = new Date(`${budget.day()}T12:00:00`);
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(end); date.setDate(date.getDate() - count + index + 1);
      const day = dayKey(date.getTime());
      return { day, ms: budget.summary(day).used };
    });
  };
  const renewalText = (day, now) => {
    const renewal = new Date(`${tomorrow(day)}T00:00:00`).getTime();
    const minutes = Math.max(0, Math.ceil((renewal - now) / MINUTE));
    return `Renews in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  // No global read/modify/write counter: each document owns its cumulative usage
  // keys; settings and playback starts are immutable, uniquely named events.
  class Store {
    constructor(api) { this.api = api; }
    async read() {
      const keys = (await this.api.listValues()).filter(k => k.startsWith(PREFIX));
      const values = await Promise.all(keys.map(k => this.api.getValue(k)));
      return new Map(keys.map((k, i) => [k, values[i]]));
    }
    async put(key, value) { await this.api.setValue(PREFIX + key, value); }
  }
  class Budget {
    constructor(store, id, now = Date.now) {
      this.store = store; this.id = id; this.now = now;
      this.records = new Map(); this.owned = new Map(); this.sequence = 0;
    }
    async sync() {
      const records = await this.store.read();
      // Merge instead of replacing: a delayed snapshot must never reduce a total.
      for (const [k, v] of records) {
        const old = this.records.get(k);
        if (!old || v.kind !== 'usage' || v.ms >= old.ms) this.records.set(k, v);
      }
      const day = this.day();
      if (!this.records.has(PREFIX + `day:${day}:${this.id}`)) {
        await this.write(`day:${day}:${this.id}`, { kind: 'day', day });
      }
    }
    day(time = this.now()) {
      return [...this.records.values()].reduce((day, r) => r.day > day ? r.day : day, dayKey(time));
    }
    values(kind) { return [...this.records.values()].filter(r => r.kind === kind); }
    async write(key, record) {
      await this.store.put(key, record);
      this.records.set(PREFIX + key, record);
    }
    async configure(minutes) {
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) throw Error('Choose 5–240 whole minutes.');
      await this.sync();
      const day = this.day();
      await this.write(`setting:${this.id}:${++this.sequence}`, {
        kind: 'setting', day, at: this.now(), ms: minutes * MINUTE,
        effective: this.started(day) ? tomorrow(day) : day
      });
    }
    started(day) { return this.values('start').some(r => r.day === day); }
    limit(day) {
      const starts = this.values('start').filter(r => r.day === day).sort((a, b) => a.at - b.at || a.limit - b.limit);
      if (starts[0]?.limit) return starts[0].limit;
      const first = starts[0]?.at ?? Infinity;
      const settings = this.values('setting').filter(r => {
        // A setting racing a first playback is deferred, even if its author had
        // not yet seen that tab's start record.
        const effective = r.effective === r.day && r.day === day && r.at > first ? tomorrow(r.day) : r.effective;
        return effective <= day;
      }).sort((a, b) => a.at - b.at || a.ms - b.ms);
      return settings.at(-1)?.ms || 0;
    }
    summary(day = this.day()) {
      const videos = new Map();
      for (const r of this.values('usage').filter(r => r.day === day)) {
        const old = videos.get(r.video.id);
        videos.set(r.video.id, { ...r.video, ms: (old?.ms || 0) + r.ms, at: Math.min(old?.at ?? Infinity, r.at), lastAt: Math.max(old?.lastAt ?? 0, r.lastAt ?? r.at) });
      }
      const used = [...videos.values()].reduce((sum, v) => sum + v.ms, 0);
      const limit = this.limit(day);
      return { day, used, limit, remaining: Math.max(0, limit - used), videos: [...videos.values()].sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id)) };
    }
    async start(time = this.now(), day = this.day(time)) {
      const limit = this.limit(day);
      if (limit && !this.started(day)) await this.write(`start:${day}:${this.id}`, { kind: 'start', day, at: time, limit });
    }
    async add(ms, video, time = this.now(), day = this.day(time)) {
      const amount = Math.min(Math.max(0, Math.floor(ms)), this.summary(day).remaining);
      if (!amount) return;
      await this.start(time, day);
      const key = `usage:${day}:${this.id}:${video.id}`;
      const old = this.owned.get(key);
      const record = { kind: 'usage', day, video, at: old?.at ?? time, lastAt: Math.max(old?.lastAt ?? 0, time), ms: (old?.ms || 0) + amount };
      await this.write(key, record);
      this.owned.set(key, record);
    }
    async warnings(previous) {
      const s = this.summary();
      for (const minutes of [10, 5, 1]) {
        const key = `warning:${s.day}:${minutes}`;
        if (s.limit > minutes * MINUTE && previous > minutes * MINUTE && s.remaining <= minutes * MINUTE && !this.records.has(PREFIX + key)) {
          // GM has no compare-and-swap: delivery is best effort across tabs.
          await this.write(key, { kind: 'warning', day: s.day });
          return minutes;
        }
      }
      return null;
    }
  }
  class PlaybackClock {
    constructor() { this.reset(); }
    reset() { this.last = null; this.media = null; this.active = false; }
    sample(now, media, playable) {
      const delta = this.last === null ? 0 : now - this.last;
      const advancing = this.media !== null && media > this.media;
      const ms = this.active && playable && advancing && delta > 0 && delta <= 2500 ? Math.floor(delta) : 0;
      this.last = now; this.media = media; this.active = playable;
      return ms;
    }
  }
  // The exact distributed core is exercised by node:test; no bundling required.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Store, Budget, PlaybackClock, dayKey, nextMidnight, tomorrow, dailySeries, renewalText };
    return;
  }
  if (window.top !== window.self || document.getElementById('noshorts-time')) return;

  const boot = () => {
    const host = document.createElement('div');
    host.id = 'noshorts-time';
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial;color-scheme:light dark;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);--paper:#faf9f6;--ink:#252824;--muted:#666b63;--line:#dedfd8;--accent:#426648}
      *{box-sizing:border-box} [hidden]{display:none!important} button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}button{cursor:pointer;color:inherit;background:none;border:1px solid var(--line);border-radius:10px;padding:10px 14px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button:disabled{opacity:.6;cursor:wait}a{color:var(--accent)}h1,h2,h3,p{margin:0 0 14px}h1,h2{font-family:Georgia,serif;font-weight:400;line-height:1.15}h1{font-size:34px}h2{font-size:28px}h3{font-size:16px;margin-top:26px}small,.muted{color:var(--muted)}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);margin-bottom:20px}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
      #indicator{position:fixed;z-index:2147483645;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));opacity:.45;box-shadow:0 2px 14px #0002;background:var(--paper);padding:7px 12px;border-radius:30px;font-size:12px}#indicator:hover{opacity:.65}#indicator:focus-visible{opacity:.8}#indicator.urgent{color:#a04830;border-color:currentColor}
      #veil{position:fixed;inset:0;background:#0005;z-index:2147483646;display:flex;align-items:flex-end;justify-content:flex-end}#panel{background:var(--paper);width:100%;max-height:90dvh;overflow:auto;overscroll-behavior:contain;border-radius:22px 22px 0 0;padding:26px 24px max(28px,env(safe-area-inset-bottom));box-shadow:0 0 50px #0002}#panel.onboard{margin:auto;max-width:440px;border-radius:22px;max-height:94dvh}#close{float:right}label{display:block;margin:16px 0 6px}select,input{width:100%;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:12px}form .primary{width:100%;margin-top:18px}.stats{font-size:32px;font-family:Georgia,serif;margin-top:22px}progress{width:100%;height:6px;accent-color:var(--accent);margin:12px 0}.tabs{display:flex;gap:6px;margin:24px 0}.tabs button{flex:1;font-size:12px;padding:8px}.tabs [aria-pressed=true]{border-color:var(--accent);color:var(--accent)}.video-list{max-height:308px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.video{height:88px;align-items:center;display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}.video img{width:88px;height:50px;object-fit:cover;border-radius:5px}.video span{flex:1;min-width:0}.video strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:13px;font-weight:500}.video small{display:block;font-size:12px}.day{border-top:1px solid var(--line);padding-top:18px;margin-top:20px}
      .chart{margin:24px 0 0}.chart figcaption{font-size:12px;color:var(--muted);margin-bottom:10px}.chart svg{display:block;width:100%;height:auto;overflow:visible}.chart text{fill:var(--muted);font:10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.chart .grid{stroke:var(--line);stroke-width:1}.chart .trend{stroke:var(--accent);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}.chart circle{fill:var(--accent)}
      #block{position:fixed;z-index:2147483644;background:var(--paper);padding:24px;overflow:auto;text-align:center;border:1px solid var(--line);border-radius:12px}#block h2{font-size:clamp(20px,4vw,30px)}#block p{font-size:13px}#toast{position:fixed;z-index:2147483647;bottom:max(24px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);width:max-content;max-width:92vw;background:var(--paper);border:1px solid var(--line);box-shadow:0 4px 24px #0002;border-radius:12px;padding:12px}#toast button{border:0;padding:4px 10px}#error{color:#a04830;margin-top:14px}
      @media(min-width:700px){#panel:not(.onboard){width:420px;height:100dvh;max-height:100dvh;border-radius:0;padding:32px}#veil:has(.onboard){align-items:center;justify-content:center}}
      @media(prefers-color-scheme:dark){:host{--paper:#20231f;--ink:#eeeee7;--muted:#a8aea3;--line:#41463d;--accent:#85aa88}.primary{color:#182019}}
      @media(prefers-reduced-motion:no-preference){#panel{animation:arrive .18s ease-out}@keyframes arrive{from{transform:translateY(12px);opacity:.6}to{transform:translateY(0);opacity:1}}}
    `;
    root.append(style);
    const el = (tag, text, parent, attrs = {}) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (parent) parent.append(node);
      return node;
    };
    const indicator = el('button', '◷ YouTube time', root, { id: 'indicator', 'aria-label': 'Open NoShorts watch time details', hidden: '' });
    const block = el('section', '', root, { id: 'block', hidden: '', 'aria-label': 'Daily playback limit reached' });
    const veil = el('div', '', root, { id: 'veil', hidden: '' });
    const panel = el('section', '', veil, { id: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'panel-title', tabindex: '-1' });
    const toast = el('div', '', root, { id: 'toast', role: 'status', hidden: '' });
    const budget = new Budget(new Store(typeof GM === 'undefined' ? {} : GM), crypto.randomUUID());
    const clock = new PlaybackClock();
    let video = null, videoInfo = null, controller = null, busy = false, ready = false, failed = false;
    let modal = null, range = 1, returnFocus = null, route = '', previousWall = Date.now(), pendingStart = false;
    let lastUI = '', resizeTarget = null;
    const duration = ms => `${Math.floor(ms / MINUTE)}m ${Math.floor(ms / 1000) % 60}s`;
    const limitText = ms => ms % (60 * MINUTE) === 0 ? `${ms / (60 * MINUTE)}-hour` : `${ms / MINUTE}-minute`;
    const info = () => {
      const id = new URL(location.href).searchParams.get('v');
      if (location.pathname !== '/watch' || !id || !/^[\w-]{11}$/.test(id)) return null;
      return { id, title: document.querySelector('ytd-watch-metadata h1, h1.title, .slim-video-metadata-title')?.textContent.trim() || document.title.replace(/ - YouTube$/, '') || 'YouTube video', channel: document.querySelector('#owner #channel-name a, .slim-owner-channel-name')?.textContent.trim() || '' };
    };
    const pauseAll = () => document.querySelectorAll('video,audio').forEach(v => { if (!v.paused) v.pause(); });
    const notify = message => {
      toast.replaceChildren();
      el('span', message, toast);
      el('button', '×', toast, { 'aria-label': 'Dismiss notification' }).onclick = () => { toast.hidden = true; };
      toast.hidden = false;
    };
    const failure = error => {
      failed = true; ready = false; pauseAll(); clock.reset();
      notify('NoShorts could not save your time. Playback is paused. Check Userscripts storage and reload.');
      console.error('NoShorts storage error', error);
    };
    const close = () => {
      if (modal === 'onboarding') return;
      veil.hidden = true; modal = null; lastUI = '';
      if (returnFocus?.isConnected) returnFocus.focus();
    };
    const form = onboarding => {
      const f = el('form', '', panel);
      el('label', onboarding ? 'Your daily budget' : 'Daily budget', f, { for: 'limit' });
      const select = el('select', '', f, { id: 'limit' });
      for (const [value, label] of [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour · recommended'], [120, '2 hours'], ['custom', 'Custom duration']]) el('option', label, select, { value });
      const active = budget.summary().limit / MINUTE || 60;
      select.value = [15, 30, 60, 120].includes(active) ? String(active) : 'custom';
      const label = el('label', 'Minutes (5–240)', f, { for: 'custom' });
      const custom = el('input', '', f, { id: 'custom', type: 'number', min: '5', max: '240', step: '1', value: active, inputmode: 'numeric' });
      const toggle = () => { label.hidden = custom.hidden = select.value !== 'custom'; custom.required = !custom.hidden; };
      select.onchange = toggle; toggle();
      const submit = el('button', onboarding ? 'Set my daily budget' : 'Save daily budget', f, { class: 'primary', type: 'submit' });
      const message = el('p', '', f, { role: 'status', id: 'error' });
      f.onsubmit = async event => {
        event.preventDefault(); submit.disabled = true;
        try {
          await budget.configure(Number(select.value === 'custom' ? custom.value : select.value));
          ready = true;
          if (onboarding) { modal = 'details'; renderPanel(); }
          else {
            const s = budget.summary(), next = budget.limit(tomorrow(s.day));
            message.textContent = next !== s.limit ? `Your new ${limitText(next)} limit starts tomorrow. Today's ${limitText(s.limit)} limit stays unchanged.` : 'Your daily budget is saved.';
          }
          update();
        } catch (error) {
          if (error.message.startsWith('Choose')) message.textContent = error.message;
          else failure(error);
        } finally { submit.disabled = false; }
      };
    };
    const renderHistory = container => {
      const today = budget.day();
      const days = new Set([today, ...budget.values('usage').map(r => r.day)]);
      const from = new Date(`${today}T12:00:00`); from.setDate(from.getDate() - range + 1);
      const summaries = [...days].filter(d => d >= dayKey(from.getTime()) && d <= today).sort().reverse().map(day => budget.summary(day));
      const structure = JSON.stringify(summaries.map(s => [s.day, s.videos.map(v => [v.id, v.title, v.channel])]));
      // Keep scroll containers and links alive during playback, including touch
      // momentum scrolling; routine samples update only the duration text.
      if (container.dataset.structure === structure) {
        for (const section of container.querySelectorAll('.day')) {
          const s = summaries.find(s => s.day === section.dataset.day);
          section.querySelector('.day-total').textContent = `${duration(s.used)} watched · ${s.limit / MINUTE} min budget`;
          for (const link of section.querySelectorAll('.video')) {
            link.querySelector('.video-time').textContent = duration(s.videos.find(v => v.id === link.dataset.video).ms);
          }
        }
        return;
      }
      container.replaceChildren(); container.dataset.structure = structure;
      for (const s of summaries) {
        const day = s.day;
        const section = el('section', '', container, { class: 'day', 'data-day': day });
        el('h3', day === today ? 'Watched today' : day, section);
        el('p', `${duration(s.used)} watched · ${s.limit / MINUTE} min budget`, section, { class: 'muted day-total' });
        if (!s.videos.length) el('p', 'A little room for something useful.', section, { class: 'muted' });
        const list = el('div', '', section, { class: 'video-list', 'data-day': day, role: 'region', 'aria-label': day === today ? 'Watched today videos' : `${day} watched videos`, tabindex: '0' });
        for (const v of s.videos) {
          const a = el('a', '', list, { class: 'video', 'data-video': v.id, href: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}` });
          const thumbnail = el('img', '', a, { src: `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/default.jpg`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
          thumbnail.onerror = () => { thumbnail.hidden = true; };
          const text = el('span', '', a); el('strong', v.title, text); el('small', v.channel || 'YouTube', text); el('small', duration(v.ms), text, { class: 'video-time' });
        }
      }
    };
    const renderChart = container => {
      container.replaceChildren();
      const series = dailySeries(budget, range === 30 ? 30 : 7);
      const figure = el('figure', '', container, { class: 'chart' });
      el('figcaption', `Daily watch time · last ${series.length} days · minutes`, figure);
      const svgNode = (tag, parent, attrs = {}, text = '') => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        node.textContent = text; parent.append(node); return node;
      };
      const svg = svgNode('svg', figure, { viewBox: '0 0 340 150', role: 'img', 'aria-label': `Daily watch time. ${series.map(point => `${point.day}: ${duration(point.ms)}`).join('; ')}` });
      const top = Math.max(5, Math.ceil(Math.max(...series.map(point => point.ms / MINUTE)) / 5) * 5);
      const x = i => 32 + i * 300 / (series.length - 1);
      const y = ms => 118 - ms / MINUTE / top * 106;
      for (const minutes of [0, top / 2, top]) {
        const height = y(minutes * MINUTE);
        svgNode('line', svg, { x1: 32, x2: 332, y1: height, y2: height, class: 'grid' });
        svgNode('text', svg, { x: 26, y: height + 3, 'text-anchor': 'end' }, String(minutes));
      }
      svgNode('polyline', svg, { points: series.map((point, i) => `${x(i)},${y(point.ms)}`).join(' '), class: 'trend' });
      series.forEach((point, i) => {
        const dot = svgNode('circle', svg, { cx: x(i), cy: y(point.ms), r: series.length === 30 ? 2 : 3 });
        svgNode('title', dot, {}, `${point.day}: ${duration(point.ms)}`);
      });
      for (const i of [0, Math.floor((series.length - 1) / 2), series.length - 1]) {
        const date = new Date(`${series[i].day}T12:00:00`);
        svgNode('text', svg, { x: x(i), y: 141, 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle' }, date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      }
    };
    const renderPanel = () => {
      panel.replaceChildren();
      const onboarding = modal === 'onboarding';
      panel.className = onboarding ? 'onboard' : '';
      if (!onboarding) el('button', 'Close', panel, { id: 'close' }).onclick = close;
      el('p', 'NoShorts', panel, { class: 'eyebrow' });
      el('h1', onboarding ? 'Make room for what matters.' : 'Your YouTube time', panel, { id: 'panel-title' });
      if (onboarding) {
        el('p', 'Set how much YouTube you want in your day. Once you start watching, your limit is locked until tomorrow.', panel);
        form(true);
      } else {
        const summary = el('div', '', panel, { id: 'summary', 'aria-live': 'off' });
        renderSummary(summary);
        const tabs = el('nav', '', panel, { class: 'tabs', 'aria-label': 'History period' });
        for (const [days, label] of [[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days']]) {
          const button = el('button', label, tabs, { 'aria-pressed': String(range === days) });
          button.onclick = () => { range = days; renderPanel(); panel.querySelectorAll('.tabs button')[[1, 7, 30].indexOf(days)].focus(); };
        }
        renderChart(el('div', '', panel, { id: 'chart' }));
        renderHistory(el('div', '', panel, { id: 'history' }));
        el('h3', 'Settings', panel);
        el('p', 'After your first playback, changes start the next calendar day. Your allowance renews at local midnight.', panel, { class: 'muted' });
        form(false);
      }
    };
    const renderSummary = container => {
      const s = budget.summary(); container.replaceChildren();
      el('p', `${duration(s.used)} watched today`, container, { class: 'stats' });
      el('progress', '', container, { max: s.limit || 1, value: s.used, 'aria-label': 'Daily watch budget used' });
      el('p', `${Math.ceil(s.remaining / MINUTE)} minutes remaining · Today's limit: ${s.limit / MINUTE} min`, container);
      el('p', renewalText(s.day, Date.now()), container, { class: 'muted', id: 'renewal' });
      const next = budget.limit(tomorrow(s.day));
      if (next !== s.limit) el('p', `Tomorrow's scheduled limit: ${next / MINUTE} min`, container, { class: 'muted' });
    };
    const open = type => {
      returnFocus = root.activeElement || document.activeElement;
      modal = type; veil.hidden = false; renderPanel(); panel.focus();
    };
    indicator.onclick = () => open('details');
    veil.onclick = event => { if (event.target === veil) close(); };
    root.addEventListener('keydown', event => {
      if (veil.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const nodes = [...panel.querySelectorAll('button,a[href],input,select')].filter(n => !n.hidden && !n.disabled);
        const first = nodes[0], last = nodes.at(-1), active = root.activeElement;
        if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (active === last || active === panel)) { event.preventDefault(); first?.focus(); }
      }
    });
    // Isolate the rest of the page while the dialog is open, including keyboard
    // shortcuts which could otherwise restart the YouTube player underneath it.
    document.addEventListener('focusin', event => { if (!veil.hidden && !event.composedPath().includes(host)) panel.focus(); }, true);
    const position = () => {
      const target = video;
      if (target !== resizeTarget) { resize.disconnect(); if (target) resize.observe(target); resizeTarget = target; }
      const r = target?.getBoundingClientRect();
      const visible = videoInfo && r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      // Follow the video's bounds, so the badge never sits on YouTube's header.
      // When its corner scrolls away, hide it instead of pinning it to the page.
      indicator.hidden = !visible || r.top < 0 || r.top + 12 + indicator.offsetHeight > Math.min(r.bottom, innerHeight);
      if (r) {
        indicator.style.top = `${r.top + 12}px`;
        indicator.style.left = `${Math.max(12, r.left + 12)}px`;
        block.style.left = `${Math.max(0, r.left)}px`; block.style.top = `${Math.max(0, r.top)}px`;
        block.style.width = `${Math.min(innerWidth, r.width)}px`; block.style.height = `${Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top))}px`;
      }
      block.hidden = !visible || !ready || budget.summary().remaining > 0;
    };
    const resize = new ResizeObserver(position);
    const update = () => {
      const s = budget.summary();
      indicator.textContent = `◷ ${Math.ceil(s.remaining / MINUTE)} mins left`;
      indicator.classList.toggle('urgent', s.remaining <= 5 * MINUTE);
      const key = `${s.day}:${s.used}:${s.limit}:${Math.floor(Date.now() / MINUTE)}`;
      if (key !== lastUI) {
        if (modal === 'details') {
          renderSummary(panel.querySelector('#summary'));
          const history = panel.querySelector('#history');
          if (!history.contains(root.activeElement)) {
            const offsets = new Map([...history.querySelectorAll('.video-list')].map(list => [list.dataset.day, list.scrollTop]));
            renderHistory(history);
            for (const list of history.querySelectorAll('.video-list')) list.scrollTop = offsets.get(list.dataset.day) || 0;
          }
          renderChart(panel.querySelector('#chart'));
        }
        if (!s.remaining && ready) {
          block.replaceChildren();
          el('h2', "That's enough YouTube for today.", block);
          el('p', `You've used your ${limitText(s.limit)} daily budget. Come back tomorrow.`, block);
          el('p', `${duration(s.used)} watched · ${s.videos.length} videos · Renews at local midnight`, block);
          el('button', 'Open viewing history', block).onclick = () => open('details');
        }
        lastUI = key;
      }
      position();
    };
    const playable = () => ready && !failed && videoInfo && video && !video.paused && !video.ended && !video.seeking && video.readyState >= 3;
    const discover = () => {
      const newRoute = location.pathname + location.search;
      const nextInfo = info();
      const nextVideo = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (newRoute !== route || nextVideo !== video) {
        if (video && videoInfo) void tick();
        clock.reset(); previousWall = Date.now();
        controller?.abort(); controller = new AbortController();
        video = nextVideo; videoInfo = nextInfo; route = newRoute;
        if (video) {
          for (const name of ['playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'emptied', 'timeupdate']) {
            video.addEventListener(name, () => {
              if (['waiting', 'stalled', 'seeking', 'emptied'].includes(name)) clock.reset();
              if (name === 'playing' && ready && !video.paused) pendingStart = true;
              enforce(); void tick();
            }, { signal: controller.signal });
          }
          if (!video.paused) pendingStart = true;
        }
      } else if (nextInfo) videoInfo = nextInfo;
      enforce(); position();
    };
    const enforce = () => {
      if (!ready || failed) pendingStart = false;
      if (!ready || failed || !budget.summary().remaining) pauseAll();
    };
    // Capture starts even for newly inserted elements before the DOM observer runs.
    document.addEventListener('play', () => { enforce(); discover(); void tick(); }, true);
    const tick = async () => {
      if (busy || failed) return;
      busy = true;
      try {
        const wall = Date.now(), mono = performance.now();
        const previous = budget.summary().remaining;
        const trackedVideo = videoInfo;
        const delta = clock.sample(mono, video?.currentTime || 0, Boolean(playable()));
        await budget.sync();
        if (ready && pendingStart && videoInfo) { pendingStart = false; await budget.start(wall); }
        // Ignore long/discontinuous wall-clock gaps; split a real short interval
        // at local midnight, without assuming a day always lasts 24 hours.
        if (delta && wall >= previousWall && wall - previousWall <= 2500) {
          const start = wall - delta, midnight = nextMidnight(start);
          if (midnight < wall && budget.day() === dayKey(wall)) {
            await budget.add(midnight - start, trackedVideo, start, dayKey(start));
            await budget.add(wall - midnight, trackedVideo, midnight);
          } else await budget.add(delta, trackedVideo, start);
        }
        previousWall = wall;
        if (!ready && budget.limit(budget.day())) { ready = true; if (modal === 'onboarding') { modal = 'details'; renderPanel(); } }
        const warning = await budget.warnings(previous);
        if (warning) notify(warning === 10 ? '10 minutes left for today.' : warning === 5 ? 'Almost done. 5 minutes left.' : 'Your YouTube time is almost up.');
        enforce(); update();
      } catch (error) { failure(error); }
      finally { busy = false; }
    };
    let queued = false;
    const observer = new MutationObserver(mutations => {
      if (mutations.every(m => m.target === host || host.contains(m.target))) return;
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; discover(); }); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', discover);
    window.addEventListener('popstate', discover);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, { passive: true });
    for (const name of ['pagehide', 'pageshow']) window.addEventListener(name, () => { void tick(); clock.reset(); });
    document.addEventListener('visibilitychange', () => { void tick(); });
    // Exactly one timer and one observer per document; SPA routes only rebind
    // the selected video with AbortController, never start another scheduler.
    setInterval(() => { discover(); void tick(); }, 1000);
    discover();
    budget.sync().then(() => {
      ready = budget.limit(budget.day()) > 0;
      if (!ready) open('onboarding');
      update(); enforce();
    }).catch(failure);
  };
  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
