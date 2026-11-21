// HUD поверх canvas (обычный HTML/CSS): таймер, счёт, портреты, миникарта,
// здоровье, броня, деньги, патроны, слоты, лента убийств, чат, меню покупки, таблица.

import {
  ARMOR_PRICE,
  KIT_PRICE,
  HELMET_PRICE,
  MAT,
  SLOT_KNIFE,
  SLOT_PISTOL,
  SLOT_PRIMARY,
  WEAPONS,
  zoneName,
  MAP_LIST,
  mapName,
  forTeam,
  nadeWeapon,
  overtimeOf,
  winTarget,
  type MapInfo,
  type PublicPlayer,
  type RoomState,
} from '../../../shared/src/index';
import { MAT_COLORS } from './atlas';
import { weaponIcon } from './weaponIcons';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function fmtTime(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export const TEAM_LABEL = ['НАПАДЕНИЕ', 'ЗАЩИТА'];

export class Hud {
  readonly root: HTMLDivElement;
  private timer: HTMLDivElement;
  private scoreT: HTMLDivElement;
  private scoreCT: HTMLDivElement;
  private portraitsT: HTMLDivElement;
  private portraitsCT: HTMLDivElement;
  private hp: HTMLDivElement;
  private armor: HTMLDivElement;
  private money: HTMLDivElement;
  private ammo: HTMLDivElement;
  private slots: HTMLDivElement;
  private feed: HTMLDivElement;
  private chatLog: HTMLDivElement;
  private chatInput: HTMLInputElement;
  private center: HTMLDivElement;
  private sub: HTMLDivElement;
  private progress: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressLabel: HTMLDivElement;
  private minimap: HTMLCanvasElement;
  private zone: HTMLDivElement;
  private mapImg: HTMLCanvasElement;
  private board: HTMLDivElement;
  readonly buyMenu: HTMLDivElement;
  private vignette: HTMLDivElement;
  private dmgArrows: HTMLDivElement;
  private spectate: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private bombIcon: HTMLDivElement;
  private netInfo: HTMLDivElement;
  private centerUntil = 0;
  private hitUntil = 0;
  chatOpen = false;
  onChat: ((text: string) => void) | null = null;
  onBuy: ((item: string) => void) | null = null;
  onSell: ((item: string) => void) | null = null;
  onChatClose: (() => void) | null = null;
  preferred: { primary: string; pistol: string } = { primary: 'vikhr', pistol: 'osa' };

  constructor(
    parent: HTMLElement,
    private mapInfo: MapInfo,
  ) {
    this.root = el('div', 'hud', parent);
    const top = el('div', 'hud-top', this.root);
    this.portraitsT = el('div', 'portraits t', top);
    this.scoreT = el('div', 'score t', top, '0');
    this.timer = el('div', 'timer', top, '0:00');
    this.scoreCT = el('div', 'score ct', top, '0');
    this.portraitsCT = el('div', 'portraits ct', top);
    this.bombIcon = el('div', 'bomb-icon', top, 'БОМБА');

    const mm = el('div', 'minimap-wrap', this.root);
    this.minimap = el('canvas', 'minimap', mm);
    this.minimap.width = this.minimap.height = 200;
    this.zone = el('div', 'zone', mm, '');
    this.mapImg = this.renderMapImage();

    this.feed = el('div', 'killfeed', this.root);
    const bl = el('div', 'hud-bl', this.root);
    this.chatLog = el('div', 'chatlog', bl);
    this.chatInput = el('input', 'chatinput', bl);
    this.chatInput.maxLength = 120;
    this.chatInput.placeholder = 'Сообщение всем… (Enter — отправить, Esc — закрыть)';
    this.chatInput.style.display = 'none';
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) this.onChat?.(t);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });

    const bottom = el('div', 'hud-bottom', this.root);
    const vit = el('div', 'vitals', bottom);
    this.hp = el('div', 'hp', vit, '100');
    this.armor = el('div', 'armor', vit, '0');
    this.money = el('div', 'money', bottom, '$800');
    const right = el('div', 'hud-br', this.root);
    this.slots = el('div', 'slots', right);
    this.ammo = el('div', 'ammo', right, '');

    this.center = el('div', 'center-msg', this.root);
    this.sub = el('div', 'sub-msg', this.root);
    this.progress = el('div', 'progress', this.root);
    this.progressLabel = el('div', 'progress-label', this.progress);
    this.progressBar = el('div', 'progress-bar', el('div', 'progress-track', this.progress));
    this.progress.style.display = 'none';
    this.crosshair = el('div', 'crosshair', this.root);
    for (const c of ['l', 'r', 't', 'b']) el('div', 'ch ' + c, this.crosshair);
    this.hitmarker = el('div', 'hitmarker', this.root);
    this.vignette = el('div', 'vignette', this.root);
    this.dmgArrows = el('div', 'dmg-arrows', this.root);
    this.spectate = el('div', 'spectate', this.root);
    this.netInfo = el('div', 'netinfo', this.root);

    this.board = el('div', 'scoreboard', this.root);
    this.board.style.display = 'none';
    this.buyMenu = el('div', 'buymenu', this.root);
    this.buyMenu.style.display = 'none';
  }

  setMap(info: MapInfo) {
    this.mapInfo = info;
    this.mapImg = this.renderMapImage();
  }

  /** Окно голосования за следующую карту. */
  private voteEl: HTMLDivElement | null = null;
  showVote(st: RoomState | null, myVote: string, onVote: (id: string) => void) {
    const open = !!st && st.ph === 'vote';
    if (!open) {
      this.voteEl?.remove();
      this.voteEl = null;
      return;
    }
    if (!this.voteEl) {
      this.voteEl = el('div', 'vote', this.root);
    }
    const key = JSON.stringify([st!.votes, myVote, Math.ceil(st!.tl)]);
    if (this.voteEl.dataset.key === key) return;
    this.voteEl.dataset.key = key;
    this.voteEl.innerHTML = '';
    el('div', 'vote-title', this.voteEl, `ГОЛОСОВАНИЕ ЗА КАРТУ · ${Math.ceil(st!.tl)} с`);
    const row = el('div', 'vote-row', this.voteEl);
    MAP_LIST.forEach((m, i) => {
      const card = el('button', 'vote-card' + (myVote === m.id ? ' mine' : '') + (st!.map === m.id ? ' current' : ''), row);
      el('span', 'slot-key', card, String(i + 1));
      el('b', '', card, m.name);
      el('span', 'vote-desc', card, m.desc);
      el('span', 'vote-count', card, `${st!.votes[m.id] ?? 0} гол.`);
      card.onclick = () => onVote(m.id);
    });
    el('div', 'buy-hint', this.voteEl, 'Клавиши 1–5 или клик · при ничьей выбирается случайная карта из лидеров');
  }

  private renderMapImage(): HTMLCanvasElement {
    const m = this.mapInfo.map;
    const c = document.createElement('canvas');
    c.width = m.sx;
    c.height = m.sz;
    const g = c.getContext('2d')!;
    const img = g.createImageData(m.sx, m.sz);
    for (let z = 0; z < m.sz; z++)
      for (let x = 0; x < m.sx; x++) {
        let top = 0,
          h = 0;
        for (let y = m.sy - 1; y >= 0; y--) {
          const v = m.get(x, y, z);
          if (v) {
            top = v;
            h = y;
            break;
          }
        }
        let col = MAT_COLORS[top] ?? 0x888888;
        let k = h > 1 ? 0.55 + Math.min(h, 12) * 0.02 : h === 1 ? 0.75 : 0.95;
        if (top === MAT.SITE) k = 1;
        // строка картинки = z, столбец = x (поворот и отражение — при выводе в drawMinimap)
        const o = (z * m.sx + x) * 4;
        img.data[o] = ((col >> 16) & 255) * k;
        img.data[o + 1] = ((col >> 8) & 255) * k;
        img.data[o + 2] = (col & 255) * k;
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return c;
  }

  update(st: RoomState | null, me: { id: number; team: number; money: number }, now: number) {
    if (st) {
      this.timer.textContent = st.ph === 'planted' ? '💣 ' + fmtTime(st.tl) : fmtTime(st.tl);
      this.timer.classList.toggle('planted', st.ph === 'planted');
      this.scoreT.textContent = String(st.sc[0]);
      this.scoreCT.textContent = String(st.sc[1]);
      this.renderPortraits(this.portraitsT, st.pl.filter((p) => p.t === 0));
      this.renderPortraits(this.portraitsCT, st.pl.filter((p) => p.t === 1));
      this.bombIcon.style.display = st.pl.some((p) => p.i === me.id && p.bomb) ? 'block' : 'none';
    }
    this.money.textContent = '$' + me.money;
    if (now > this.centerUntil) {
      this.center.textContent = '';
      this.sub.textContent = '';
    }
    this.hitmarker.style.opacity = now < this.hitUntil ? '1' : '0';
  }

  private renderPortraits(box: HTMLDivElement, pl: PublicPlayer[]) {
    const key = pl.map((p) => `${p.i}${p.a ? 1 : 0}`).join(',');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '';
    for (const p of pl) {
      const d = el('div', 'portrait' + (p.a ? '' : ' dead') + (p.b ? ' bot' : ''), box);
      d.title = p.n;
      d.textContent = p.n.replace(/^BOT /, '').slice(0, 2).toUpperCase();
    }
  }

  setVitals(hp: number, armor: number, alive: boolean) {
    this.hp.textContent = alive ? String(hp) : '—';
    this.hp.classList.toggle('low', hp <= 25);
    this.armor.textContent = String(armor);
  }

  setWeapon(weaponId: number, mag: number, reserve: number, slots: Array<{ slot: number; name: string; active: boolean; key?: string }>, reloading: boolean) {
    const def = WEAPONS[weaponId];
    this.ammo.textContent = def && def.kind !== 'knife' && def.kind !== 'grenade' ? (reloading ? 'перезарядка' : `${mag} / ${reserve}`) : '';
    this.ammo.classList.toggle('low', !!def && def.mag > 0 && mag <= def.mag * 0.2);
    const key = slots.map((s) => s.slot + s.name + s.active).join();
    if (this.slots.dataset.key === key) return;
    this.slots.dataset.key = key;
    this.slots.innerHTML = '';
    for (const s of slots) {
      const d = el('div', 'slot' + (s.active ? ' active' : ''), this.slots);
      el('span', 'slot-key', d, s.key ?? String(s.slot + 1));
      el('span', '', d, s.name);
    }
  }

  showCenter(text: string, sub = '', dur = 3, now = performance.now() / 1000, cls = '') {
    this.center.textContent = text;
    this.center.className = 'center-msg ' + cls;
    this.sub.textContent = sub;
    this.centerUntil = now + dur;
  }

  hitMarker(now: number) {
    this.hitUntil = now + 0.15;
  }

  setProgress(label: string, k: number | null) {
    if (k === null) {
      this.progress.style.display = 'none';
      return;
    }
    this.progress.style.display = 'block';
    this.progressLabel.textContent = label;
    this.progressBar.style.width = Math.min(100, k * 100) + '%';
  }

  setCrosshair(spread: number, visible: boolean) {
    this.crosshair.style.display = visible ? 'block' : 'none';
    this.crosshair.style.setProperty('--gap', 4 + Math.min(40, spread * 400) + 'px');
  }

  /** Ослепление вспышкой: белый экран, который тает. */
  private flashEl: HTMLDivElement | null = null;
  flash(dur: number) {
    if (!this.flashEl) this.flashEl = el('div', 'flashbang', this.root);
    const f = this.flashEl;
    f.style.transition = 'none';
    f.style.opacity = '1';
    void f.offsetWidth;
    // держится почти полностью ~60% времени, потом тает
    f.style.transition = `opacity ${Math.max(0.3, dur * 0.5)}s ease-in ${dur * 0.5}s`;
    f.style.opacity = '0';
  }

  setSpectate(text: string) {
    this.spectate.textContent = text;
    this.spectate.style.display = text ? 'block' : 'none';
  }

  setNet(text: string) {
    this.netInfo.textContent = text;
  }

  damage(amount: number, angle: number | null) {
    this.vignette.style.opacity = String(Math.min(0.85, 0.25 + amount / 80));
    setTimeout(() => (this.vignette.style.opacity = '0'), 160);
    if (angle !== null) {
      const a = el('div', 'dmg-arrow', this.dmgArrows);
      a.style.transform = `rotate(${angle}rad) translateY(-120px)`;
      setTimeout(() => a.remove(), 900);
    }
  }

  /** Строка ленты: убийца · силуэт оружия · значок попадания в голову · жертва. */
  killFeed(killer: string, kTeam: number, victim: string, vTeam: number, weapon: { key: string; name: string } | null, hs: boolean, ex: boolean, mine: boolean) {
    const row = el('div', 'kf' + (mine ? ' mine' : ''), this.feed);
    if (killer) el('span', 'team' + kTeam, row, killer);
    const icon = (key: string, title: string) => {
      const url = weaponIcon(key);
      if (url) {
        const img = el('img', 'kf-icon kf-' + key, row) as HTMLImageElement;
        img.src = url;
        img.alt = title;
        img.title = title;
      } else el('span', 'kf-w', row, title);
    };
    icon(weapon ? weapon.key : 'bomb', weapon ? weapon.name : 'Взрыв бомбы');
    if (hs) icon(ex ? 'explode' : 'headshot', ex ? 'Голова вдребезги' : 'В голову');
    el('span', 'team' + vTeam, row, victim);
    while (this.feed.children.length > 6) this.feed.firstChild!.remove();
    setTimeout(() => row.remove(), 7000);
  }

  chat(name: string, team: number, text: string, dead: boolean) {
    const row = el('div', 'chatrow', this.chatLog);
    if (dead) el('span', 'dead', row, '*мёртв* ');
    el('span', 'team' + team, row, name + ': ');
    el('span', '', row, text);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild!.remove();
    setTimeout(() => row.classList.add('old'), 9000);
  }

  info(text: string) {
    const row = el('div', 'chatrow info', this.chatLog, text);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild!.remove();
    setTimeout(() => row.classList.add('old'), 9000);
  }

  openChat() {
    this.chatOpen = true;
    this.chatInput.style.display = 'block';
    this.chatInput.value = '';
    this.chatLog.classList.add('open');
    setTimeout(() => this.chatInput.focus(), 0);
  }

  closeChat() {
    this.chatOpen = false;
    this.chatInput.blur();
    this.chatInput.style.display = 'none';
    this.chatLog.classList.remove('open');
    this.onChatClose?.();
  }

  drawMinimap(px: number, pz: number, yaw: number, dots: Array<{ x: number; z: number; c: string; me?: boolean; yaw?: number }>, bomb: { x: number; z: number; planted: boolean } | null) {
    const g = this.minimap.getContext('2d')!;
    const W = 200;
    const scale = 4; // пикселей на метр
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#1b1712';
    g.fillRect(0, 0, W, W);
    // Миникарта повёрнута по взгляду: вперёд — вверх, вправо — вправо, как на экране.
    // В мире «вперёд» = (−sin yaw, −cos yaw), «вправо» = (cos yaw, −sin yaw) по (x, z), поэтому
    // экран: sx = dx·cos − dz·sin, sy = dx·sin + dz·cos (ось y экрана — вниз). Раньше карта
    // рисовалась «восток справа», а в игре при взгляде на север восток слева — отсюда было зеркало.
    const cs = Math.cos(yaw),
      sn = Math.sin(yaw);
    const toMap = (x: number, z: number): [number, number] => {
      const dx = x - px,
        dz = z - pz;
      return [W / 2 + (dx * cs - dz * sn) * scale, W / 2 + (dx * sn + dz * cs) * scale];
    };
    g.save();
    g.setTransform(cs * scale, sn * scale, -sn * scale, cs * scale, W / 2, W / 2);
    g.imageSmoothingEnabled = false;
    // картинка в метрах: 1 пиксель = 0,5 м, начало — угол карты (x = 0, z = 0)
    g.drawImage(this.mapImg, -px, -pz, this.mapImg.width / 2, this.mapImg.height / 2);
    g.restore();
    // буквы точек — без поворота, чтобы читались
    g.fillStyle = '#fff';
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    this.mapInfo.sites.forEach((s, i) => {
      if (i > 0 && this.mapInfo.oneSite) return;
      const [sx, sy] = toMap((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
      g.fillText(this.mapInfo.siteNames[i], sx, sy);
    });
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
    if (bomb) {
      const [bx, by] = toMap(bomb.x, bomb.z);
      g.fillStyle = bomb.planted ? '#ff3030' : '#ffb020';
      g.fillRect(bx - 4, by - 4, 8, 8);
    }
    for (const d of dots) {
      const [x, y] = toMap(d.x, d.z);
      g.fillStyle = d.c;
      g.beginPath();
      g.arc(x, y, d.me ? 5 : 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // игрок в центре, стрелка вверх
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(W / 2, W / 2 - 8);
    g.lineTo(W / 2 - 5, W / 2 + 5);
    g.lineTo(W / 2 + 5, W / 2 + 5);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.stroke();
    this.zone.textContent = zoneName(this.mapInfo, px, pz);
  }

  showBoard(show: boolean, st: RoomState | null, myId: number) {
    this.board.style.display = show ? 'block' : 'none';
    if (!show || !st) return;
    this.board.innerHTML = '';
    const ot = overtimeOf(st.rn, st.hl);
    const modeName = st.mode === 'mm' ? 'Матчмейкинг · ' : st.mode === 'wm' ? 'Союзники · ' : '';
    el('div', 'board-title', this.board, `${modeName}${ot ? `Овертайм${ot > 1 ? ' ' + ot : ''} · ` : ''}Раунд ${st.rn} · до ${winTarget(st.rn, st.hl)} побед · ${mapName(st.map)} · наблюдателей: ${st.spec}`);
    for (const team of [0, 1]) {
      const sec = el('div', 'board-team team' + team, this.board);
      el('div', 'board-head', sec, `${TEAM_LABEL[team]} — ${st.sc[team]}`);
      const tbl = el('table', '', sec);
      const hr = el('tr', '', tbl);
      for (const h of ['Игрок', 'Убийства', 'Смерти', 'Деньги']) el('th', '', hr, h);
      for (const p of st.pl.filter((q) => q.t === team).sort((a, b) => b.k - a.k)) {
        const tr = el('tr', (p.a ? '' : 'dead') + (p.i === myId ? ' me' : ''), tbl);
        el('td', '', tr, p.n + (p.c ? '' : ' (откл.)') + (p.bomb ? ' 💣' : '') + (p.kit ? ' ✚' : ''));
        el('td', '', tr, String(p.k));
        el('td', '', tr, String(p.d));
        el('td', '', tr, p.m >= 0 ? '$' + p.m : '');
      }
    }
  }

  /** sellable — купленное в этом раунде: на кнопке такого предмета мини-кнопка продажи (↺) */
  showBuy(show: boolean, money: number, canBuy: boolean, team = -1, sellable: string[] = []) {
    this.buyMenu.style.display = show ? 'grid' : 'none';
    if (!show) return;
    this.buyMenu.innerHTML = '';
    el('div', 'buy-title', this.buyMenu, canBuy ? `Покупка · $${money}` : 'Покупка недоступна (вне зоны или время вышло)');
    // только то, что продаётся своей стороне (молотов — атаке, зажигательная граната — защите)
    const mine = (w: (typeof WEAPONS)[number]) => team < 0 || forTeam(w, team);
    const byPrice = (a: { price: number }, b: { price: number }) => a.price - b.price;
    const cols: Array<{ title: string; items: Array<{ key: string; name: string; price: number }> }> = [
      { title: 'Пистолеты', items: WEAPONS.filter((w) => w.slot === SLOT_PISTOL && mine(w)).map((w) => ({ key: w.key, name: w.name, price: w.price })).sort(byPrice) },
      { title: 'Основное', items: WEAPONS.filter((w) => w.slot === SLOT_PRIMARY && mine(w)).map((w) => ({ key: w.key, name: w.name, price: w.price })).sort(byPrice) },
      {
        title: 'Снаряжение',
        items: [
          { key: 'armor', name: 'Бронежилет', price: ARMOR_PRICE },
          { key: 'helmet', name: 'Броня и шлем', price: HELMET_PRICE },
          ...WEAPONS.filter((w) => w.kind === 'grenade' && mine(w)).map((w) => ({ key: w.key, name: w.name, price: w.price })),
          ...(team === 1 ? [{ key: 'kit', name: 'Набор сапёра (5 с)', price: KIT_PRICE }] : []),
        ],
      },
    ];
    // выбранное в снаряжении оружие — первым
    cols[0].items.sort((a, b) => (b.key === this.preferred.pistol ? 1 : 0) - (a.key === this.preferred.pistol ? 1 : 0));
    cols[1].items.sort((a, b) => (b.key === this.preferred.primary ? 1 : 0) - (a.key === this.preferred.primary ? 1 : 0));
    let hot = 1;
    for (const c of cols) {
      const col = el('div', 'buy-col', this.buyMenu);
      el('div', 'buy-col-title', col, c.title);
      for (const it of c.items) {
        const b = el('button', 'buy-item' + (money < it.price ? ' poor' : ''), col);
        el('span', 'slot-key', b, hot <= 9 ? String(hot) : '');
        el('span', 'buy-name', b, it.name);
        el('span', 'buy-price', b, '$' + it.price);
        b.dataset.hot = String(hot++);
        b.onclick = () => this.onBuy?.(it.key);
        if (sellable.includes(it.key)) {
          b.classList.add('owned');
          const s = el('span', 'buy-sell', b, '↺');
          s.title = 'Продать (вернуть деньги)';
          s.onclick = (ev) => {
            ev.stopPropagation();
            this.onSell?.(it.key);
          };
        }
        b.dataset.key = it.key;
      }
    }
    el('div', 'buy-hint', this.buyMenu, 'B — закрыть · цифры — быстрая покупка · ↺ — продать купленное в этом раунде · гранаты: не больше 1 осколочной, 2 светошумовых, 1 дымовой и 1 зажигательной');
  }

  buyHotkey(n: number): string | null {
    const b = this.buyMenu.querySelector(`[data-hot="${n}"]`) as HTMLElement | null;
    return b?.dataset.key ?? null;
  }

  dispose() {
    this.root.remove();
  }
}

export function slotList(primary: number | null, pistol: number, active: number, nades: number[] = [0, 0, 0, 0], kit = false, team = 0) {
  const out: Array<{ slot: number; name: string; active: boolean; key?: string }> = [];
  if (primary !== null) out.push({ slot: SLOT_PRIMARY, name: WEAPONS[primary].name, active: active === SLOT_PRIMARY });
  out.push({ slot: SLOT_PISTOL, name: WEAPONS[pistol].name, active: active === SLOT_PISTOL });
  out.push({ slot: SLOT_KNIFE, name: 'Нож', active: active === SLOT_KNIFE });
  nades.forEach((n, i) => {
    if (n > 0) out.push({ slot: 3 + i, key: '4', name: nadeWeapon(i, team).name + (n > 1 ? ` ×${n}` : ''), active: active === 3 + i });
  });
  if (kit) out.push({ slot: 9, key: '✚', name: 'Набор сапёра', active: false });
  return out;
}
