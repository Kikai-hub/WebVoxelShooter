// Главное меню: вход/регистрация, «Играть», «Инвентарь», «Снаряжение», «Настройки».
// Раскладка по мотиву меню тактических шутеров, графика — своя, воксельная.

import './style.css';
import { ACTIONS, AGENTS, SKINS, SLOT_PISTOL, SLOT_PRIMARY, WEAPONS, defaultBinds, keyLabel, sanitizeBinds, type Action, type WeaponDef } from '../../shared/src/index';
import { ApiError, api, getToken, setToken, type AccountInfo, type Loadout, type PartyState, type QueueState, type RankedMode, type Settings, type TopRow } from './api';
import { mmLevel, WM_RANKS, CROSSHAIR_STYLES, CROSSHAIR_STYLE_NAMES, DEFAULT_CROSSHAIR, drawCrosshair, sanitizeCrosshair, type GameMode } from '../../shared/src/index';
import { Game } from './game/game';
import { AgentView, renderMenuBackground } from './ui/agentView';
import { agentRender, weaponRender } from './ui/itemRenders';
import { KNIFE_NAMES, KNIFE_OF_TEAM } from './game/knifeModels';
import { loadGunModels, onGunModel } from './game/weaponModels';

// модели оружия грузятся в фоне, пока игрок в меню
loadGunModels();

const app = document.getElementById('app')!;
let account: AccountInfo | null = null;
let agentView: AgentView | null = null;
let statusTimer = 0;
/** лобби: опрос раз в 2 с, пока открыто меню */
let partyTimer = 0;
let partyState: PartyState | null = null;
/** запуск паблика лидером, который уже обработан (старые не повторяем) */
let lastGoAt = Date.now();
const shownInvites = new Set<string>();
let game: Game | null = null;
/** сообщение после возвращения из игры (итог рейтингового матча и т. п.) */
let menuNotice = '';
let queueTimer = 0;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- Вход ----------

const RND_A = ['Пыльный', 'Тихий', 'Быстрый', 'Рыжий', 'Серый', 'Меткий', 'Ночной', 'Песчаный', 'Ловкий', 'Хмурый'];
const RND_B = ['Сокол', 'Лис', 'Ёж', 'Волк', 'Барсук', 'Филин', 'Кот', 'Варан', 'Шакал', 'Тушкан'];
function randomLogin(): string {
  const a = RND_A[Math.floor(Math.random() * RND_A.length)];
  const b = RND_B[Math.floor(Math.random() * RND_B.length)];
  return (a + b).slice(0, 13) + Math.floor(Math.random() * 90 + 10);
}

function showAuth(root: HTMLElement) {
  const box = h('div', { class: 'modal-back' });
  const modal = h('div', { class: 'modal auth' });
  box.append(modal);
  root.append(box);
  let mode: 'login' | 'register' | 'recover' = 'login';
  const render = (err = '') => {
    modal.innerHTML = '';
    const tabs = h('div', { class: 'auth-tabs' });
    for (const [m, label] of [
      ['login', 'Вход'],
      ['register', 'Регистрация'],
      ['recover', 'Восстановление'],
    ] as const) {
      const b = h('button', { class: 'tab' + (mode === m ? ' active' : '') }, label);
      b.onclick = () => {
        mode = m;
        render();
      };
      tabs.append(b);
    }
    modal.append(h('h2', {}, 'VOXEL TACTICAL'), tabs);
    const form = h('form', { class: 'auth-form' });
    const login = h('input', { placeholder: 'Логин', autocomplete: 'username', maxlength: '16', required: '' });
    const pass = h('input', { placeholder: mode === 'recover' ? 'Новый пароль' : 'Пароль', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: '' });
    form.append(login);
    if (mode === 'register') {
      const rnd = h('button', { type: 'button', class: 'btn small' }, 'Случайный логин');
      rnd.onclick = () => (login.value = randomLogin());
      form.append(rnd);
    }
    let code: HTMLInputElement | null = null;
    if (mode === 'recover') {
      code = h('input', { placeholder: 'Код восстановления XXXX-XXXX-XXXX-XXXX', required: '' });
      form.append(code);
    }
    form.append(pass);
    let pass2: HTMLInputElement | null = null;
    if (mode !== 'login') {
      pass2 = h('input', { placeholder: 'Повтор пароля', type: 'password', autocomplete: 'new-password', required: '' });
      form.append(pass2);
    }
    const errEl = h('div', { class: 'error' }, err);
    const submit = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Задать новый пароль');
    form.append(errEl, submit);
    if (mode === 'register') form.append(h('div', { class: 'hint' }, 'Почта не нужна. Логин станет ником в игре. После регистрации вы получите код восстановления — сохраните его, без него забытый пароль не вернуть.'));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (pass2 && pass2.value !== pass.value) return render('Пароли не совпадают');
      submit.disabled = true;
      try {
        if (mode === 'login') {
          const r = await api.login(login.value.trim(), pass.value);
          setToken(r.token);
          account = r.account;
          box.remove();
          showMenu();
        } else if (mode === 'register') {
          const r = await api.register(login.value.trim(), pass.value);
          setToken(r.token);
          account = r.account;
          showRecovery(modal, r.recovery, () => {
            box.remove();
            showMenu();
          });
        } else {
          const r = await api.recover(login.value.trim(), code!.value, pass.value);
          setToken(r.token);
          const me = await api.me();
          account = me.account;
          showRecovery(modal, r.recovery, () => {
            box.remove();
            showMenu();
          });
        }
      } catch (er) {
        render((er as Error).message);
      }
    };
    modal.append(form);
    login.focus();
  };
  render();
}

function showRecovery(modal: HTMLElement, code: string, done: () => void) {
  modal.innerHTML = '';
  modal.append(
    h('h2', {}, 'Код восстановления'),
    h('p', {}, 'Сохраните этот код. Он нужен, чтобы задать новый пароль, если вы его забудете. Код показывается один раз.'),
    h('div', { class: 'recovery-code' }, code),
  );
  const copy = h('button', { class: 'btn small' }, 'Скопировать');
  copy.onclick = () => navigator.clipboard?.writeText(code).then(() => (copy.textContent = 'Скопировано'));
  const ok = h('button', { class: 'btn primary' }, 'Я сохранил код');
  ok.onclick = done;
  modal.append(copy, ok);
}

// ---------- Меню ----------

type Tab = 'play' | 'inventory' | 'loadout' | 'stats' | 'settings';

function showMenu(tab: Tab = 'play') {
  if (!account) return;
  stopMenu();
  app.innerHTML = '';
  const menu = h('div', { class: 'menu' });
  const bg = h('div', { class: 'menu-bg' });
  try {
    bg.style.backgroundImage = `url(${renderMenuBackground(960, 540)})`;
  } catch {
    /* без WebGL фон останется градиентом */
  }
  menu.append(bg);
  const top = h('div', { class: 'topbar' });
  const nick = h('div', { class: 'nick' }, h('div', { class: 'nick-name' }, avatarEl(account.login, account.avatar, 'nick-av'), account.login), ...rankLines(account));
  const nav = h('div', { class: 'nav' });
  const tabs: Array<[Tab, string]> = [
    ['play', 'ИГРАТЬ'],
    ['inventory', 'ИНВЕНТАРЬ'],
    ['loadout', 'СНАРЯЖЕНИЕ'],
    ['stats', 'СТАТИСТИКА'],
    ['settings', 'НАСТРОЙКИ'],
  ];
  for (const [t, label] of tabs) {
    const b = h('button', { class: 'nav-btn' + (t === tab ? ' active' : '') }, label);
    b.onclick = () => showMenu(t);
    nav.append(b);
  }
  const online = h('div', { class: 'online' }, '…');
  const lobbyBar = h('div', { class: 'lobby-bar' });
  top.append(nick, nav, lobbyBar, online);
  const lobby = setupLobby(lobbyBar, menu);
  void lobby.poll();
  partyTimer = window.setInterval(() => void lobby.poll(), 2000);
  menu.append(top);

  const body = h('div', { class: 'menu-body' });
  menu.append(body);
  app.append(menu);

  const canvas = h('canvas', { class: 'agent-canvas' });
  const center = h('div', { class: 'menu-center' }, canvas);
  const lo = account.loadout;

  const pollStatus = async () => {
    const t0 = performance.now();
    try {
      const s = await api.status();
      const ping = Math.round(performance.now() - t0);
      online.textContent = `Онлайн: ${s.online} · комнат ${s.rooms}/${s.maxRooms} · пинг ${ping} мс`;
      const pc = document.querySelector('.play-count');
      if (pc) pc.textContent = `В поиске: матчмейкинг ${s.queue.mm} · союзники ${s.queue.wm}`;
    } catch {
      online.textContent = 'Сервер недоступен';
    }
  };
  void pollStatus();
  statusTimer = window.setInterval(pollStatus, 5000);

  if (tab === 'play') {
    const left = h('div', { class: 'panel modes' }, h('div', { class: 'panel-title' }, 'РЕЖИМЫ'), ...MODE_INFO.map((m) => h('div', { class: 'mode' }, h('b', {}, m.title), h('span', {}, m.text))));
    const right = h(
      'div',
      { class: 'panel news' },
      h('div', { class: 'panel-title' }, 'НОВОСТИ'),
      h('div', { class: 'card' }, h('b', {}, 'Воксельные раны'), h('span', {}, 'Каждое попадание оставляет дыру, голова может разлететься на кубики, тела лежат до конца раунда.')),
      h('div', { class: 'card' }, h('b', {}, 'Боты среднего уровня'), h('span', {}, 'Видят только то, что в поле зрения, слышат выстрелы и держат углы.')),
    );
    // свежие обновления с сервера — сверху, над постоянными карточками
    void api
      .news()
      .then((r) => {
        const title = right.querySelector('.panel-title');
        const fmt = (d: string) => (d ? new Date(d).toLocaleDateString('ru-RU') : '');
        r.news.forEach((n, i) => {
          const ul = h('ul', { class: 'news-list' }, ...n.items.map((s) => h('li', {}, s)));
          const card = h('div', { class: 'card' + (i === 0 ? ' fresh' : '') }, h('small', {}, (i === 0 ? 'Последнее обновление · ' : '') + fmt(n.date)), h('b', {}, n.title), ul);
          const after = right.querySelectorAll('.card.update')[i - 1] ?? title;
          card.classList.add('update');
          after?.after(card);
        });
        right.append(h('div', { class: 'version' }, `Версия ${r.version.commit}${r.version.date ? ' от ' + fmt(r.version.date) : ''}`));
      })
      .catch(() => {});
    const play = h('button', { class: 'play-btn' }, 'ИГРАТЬ');
    const count = h('div', { class: 'play-count' }, '');
    play.onclick = () => void openModePicker();
    const playBox = h('div', { class: 'play-box' }, play, count);
    body.append(left, center, right, playBox);
    agentView = new AgentView(canvas);
    agentView.setAgent(0, lo.agent[0], lo.skin, lo.primary[0]);
    const sideBtns = h('div', { class: 'side-switch' });
    for (const t of [0, 1]) {
      const b = h('button', { class: 'btn small' + (t === 0 ? ' active' : '') }, t === 0 ? 'Нападение' : 'Защита');
      b.onclick = () => {
        sideBtns.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        agentView?.setAgent(t, lo.agent[t], lo.skin, lo.primary[t]);
      };
      sideBtns.append(b);
    }
    center.append(sideBtns);
    if (menuNotice) {
      const note = h('div', { class: 'menu-notice' }, menuNotice);
      menuNotice = '';
      note.onclick = () => note.remove();
      menu.append(note);
      setTimeout(() => note.remove(), 12000);
    }
  } else if (tab === 'inventory') {
    renderInventory(body, center, canvas);
  } else if (tab === 'loadout') {
    renderLoadout(body, center, canvas);
  } else if (tab === 'stats') {
    renderStats(body);
  } else {
    renderSettings(body);
  }
}

function stopMenu() {
  agentView?.dispose();
  agentView = null;
  clearInterval(statusTimer);
  clearInterval(partyTimer);
}

function statBars(def: WeaponDef): HTMLElement {
  const box = h('div', { class: 'stats' });
  const rows: Array<[string, number, string]> = [
    ['Урон', Math.min(1, (def.damage * def.pellets) / 160), String(def.damage) + (def.pellets > 1 ? ' × ' + def.pellets : '')],
    ['Скорострельность', Math.min(1, 0.08 / def.interval + 0.05), Math.round(60 / def.interval) + ' в мин'],
    ['Отдача', Math.min(1, def.recoilMax / 0.08), def.recoilMax <= 0.05 ? 'низкая' : 'высокая'],
    ['Точность', Math.max(0.05, 1 - def.spread / 0.07), def.spread < 0.005 ? 'высокая' : 'средняя'],
    ['Подвижность', def.speed, Math.round(def.speed * 100) + '%'],
  ];
  for (const [label, k, val] of rows) {
    box.append(h('div', { class: 'stat' }, h('span', {}, label), h('div', { class: 'bar' }, Object.assign(h('i'), { style: `width:${Math.round(k * 100)}%` } as any)), h('em', {}, val)));
  }
  box.append(h('div', { class: 'stat' }, h('span', {}, 'Цена в игре'), h('em', {}, '$' + def.price)));
  return box;
}

/** Таблица лидеров: топ-50 по рейтингу матчмейкинга или союзников, своё место — внизу, если вне топа. */
function renderTop(panel: HTMLElement, mode: RankedMode = 'mm') {
  panel.innerHTML = '';
  const tabs = h('div', { class: 'top-tabs' });
  for (const [m, label] of [
    ['mm', 'Матчмейкинг'],
    ['wm', 'Союзники'],
  ] as const) {
    const b = h('button', { class: 'btn small' + (m === mode ? ' active' : '') }, label);
    b.onclick = () => renderTop(panel, m);
    tabs.append(b);
  }
  const list = h('div', { class: 'top-list' }, h('p', { class: 'hint' }, 'Загрузка…'));
  panel.append(h('div', { class: 'panel-title' }, 'РЕЙТИНГ · ТОП-50'), tabs, list);
  void api
    .top(mode)
    .then((r) => {
      list.innerHTML = '';
      if (!r.list.length) {
        list.append(h('p', { class: 'hint' }, mode === 'mm' ? 'Пока никто не сыграл матч в матчмейкинге.' : 'Пока ни у кого нет звания: оно выдаётся после 5 матчей в союзниках.'));
        return;
      }
      const row = (t: TopRow, me: boolean) => {
        const lv = t.elo !== undefined ? mmLevel(t.elo) : null;
        const badge = h('span', { class: 'lvl' }, lv ? String(lv.level) : '★');
        if (lv) badge.style.borderColor = badge.style.color = lv.color;
        const value = lv ? `${t.elo} Elo` : t.rank !== undefined && t.rank !== null ? WM_RANKS[t.rank].name : '???';
        const wr = t.matches ? Math.round((t.wins / t.matches) * 100) + '%' : '—';
        return h(
          'div',
          { class: 'top-row' + (me ? ' me' : '') + (t.place <= 3 ? ' podium p' + t.place : '') },
          h('span', { class: 'top-place' }, String(t.place)),
          h('span', { class: 'top-name' }, avatarEl(t.login, t.avatar, 'top-av'), badge, t.login),
          h('span', { class: 'top-value' }, value),
          h('span', { class: 'top-wr', title: `матчей ${t.matches}, побед ${t.wins}` }, wr),
        );
      };
      list.append(h('div', { class: 'top-row head' }, h('span', {}, '#'), h('span', {}, 'Игрок'), h('span', {}, mode === 'mm' ? 'Elo' : 'Звание'), h('span', {}, 'Побед')));
      for (const t of r.list) list.append(row(t, t.login === account?.login));
      if (r.me && r.me.place > r.list.length) list.append(h('div', { class: 'top-gap' }, '…'), row(r.me, true));
      if (!r.me) list.append(h('p', { class: 'hint' }, mode === 'mm' ? 'Сыграйте матч в матчмейкинге, чтобы попасть в рейтинг.' : 'Сыграйте 5 матчей в союзниках, чтобы получить звание и попасть в рейтинг.'));
      list.append(h('p', { class: 'hint top-total' }, `Всего в рейтинге: ${r.total}`));
    })
    .catch(() => {
      list.innerHTML = '';
      list.append(h('p', { class: 'hint' }, 'Не удалось загрузить рейтинг'));
    });
}

function renderStats(body: HTMLElement) {
  const panel = h('div', { class: 'panel stats-panel' });
  panel.append(h('div', { class: 'panel-title' }, 'СТАТИСТИКА'), h('p', { class: 'hint' }, 'Загрузка…'));
  // справа от своей статистики — рейтинг всех игроков
  const top = h('div', { class: 'panel top-panel' });
  body.append(h('div', { class: 'stats-layout' }, panel, top));
  renderTop(top);
  void api
    .stats()
    .then(({ stats: s }) => {
      panel.innerHTML = '';
      panel.append(h('div', { class: 'panel-title' }, `СТАТИСТИКА · ${account?.login ?? ''}`));
      if (!s.rounds && !s.kills && !s.deaths) {
        panel.append(h('p', { class: 'hint' }, 'Пока пусто: сыграйте хотя бы раунд — статистика копится с каждым матчем.'));
        return;
      }
      const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
      const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
      const minutes = s.playSeconds / 60;
      const time = s.playSeconds >= 3600 ? `${Math.floor(s.playSeconds / 3600)} ч ${Math.floor((s.playSeconds % 3600) / 60)} мин` : `${Math.max(0, Math.round(minutes))} мин`;
      // любимое оружие — с наибольшим числом убийств
      const weapons = Object.entries(s.weapons).sort((a, b) => b[1] - a[1]);
      const fav = weapons[0];
      const favDef = fav ? WEAPONS.find((w) => w.key === fav[0]) : undefined;
      const cards: Array<[string, string, string?]> = [
        ['Убийства', String(s.kills)],
        ['Смерти', String(s.deaths)],
        ['K/D', num(s.kills / Math.max(1, s.deaths)), 'убийств на одну смерть'],
        ['MVP', String(s.mvps), 'лучший игрок раунда'],
        ['В голову', pct(s.headshots, s.kills), 'доля убийств в голову'],
        ['Точность', pct(s.hits, s.shots), 'попаданий из выстрелов'],
        ['Урон за раунд', num(s.damage / Math.max(1, s.rounds), 0), 'средний (ADR)'],
        ['Убийств в минуту', num(minutes > 0 ? s.kills / minutes : 0), `в секунду — ${num(s.playSeconds > 0 ? s.kills / s.playSeconds : 0, 3)}`],
        ['Убийств за раунд', num(s.kills / Math.max(1, s.rounds)), ''],
        ['Раунды', `${s.roundsWon} / ${s.rounds}`, `побед ${pct(s.roundsWon, s.rounds)}`],
        ['Матчи', `${s.matchesWon} / ${s.matches}`, `побед ${pct(s.matchesWon, s.matches)}`],
        ['Время в игре', time],
      ];
      const grid = h('div', { class: 'stat-grid' });
      for (const [label, value, sub] of cards) grid.append(h('div', { class: 'stat-card' }, h('span', {}, label), h('b', {}, value), ...(sub ? [h('small', {}, sub)] : [])));
      panel.append(grid);
      if (favDef && fav) {
        panel.append(h('div', { class: 'panel-title small' }, 'ЛЮБИМОЕ ОРУЖИЕ'), h('div', { class: 'fav-weapon' }, h('b', {}, favDef.name), h('span', {}, `${fav[1]} убийств · ${pct(fav[1], s.kills)} всех`)));
        const list = h('div', { class: 'weapon-bars' });
        for (const [key, n] of weapons.slice(0, 5)) {
          const def = WEAPONS.find((w) => w.key === key);
          const bar = h('i');
          bar.style.width = `${Math.round((n / fav[1]) * 100)}%`;
          list.append(h('div', { class: 'weapon-bar' }, h('span', {}, def?.name ?? key), h('div', { class: 'bar' }, bar), h('em', {}, String(n))));
        }
        panel.append(list);
      }
    })
    .catch(() => {
      panel.innerHTML = '';
      panel.append(h('div', { class: 'panel-title' }, 'СТАТИСТИКА'), h('p', { class: 'hint' }, 'Не удалось загрузить статистику.'));
    });
}

/** Тип предмета (подпись) и «редкость» — цвет полосы на ячейке, как в инвентаре CS2. */
const KIND_LABEL: Record<string, string> = { knife: 'Нож', pistol: 'Пистолет', smg: 'Пистолет-пулемёт', shotgun: 'Дробовик', rifle: 'Штурмовая винтовка', sniper: 'Снайперская винтовка', grenade: 'Граната' };
const KIND_RARITY: Record<string, string> = { grenade: 'common', pistol: 'mil', smg: 'restricted', shotgun: 'restricted', rifle: 'classified', sniper: 'covert', knife: 'gold' };

function renderInventory(body: HTMLElement, center: HTMLElement, canvas: HTMLCanvasElement) {
  const lo = account!.loadout;
  const filters: Array<[string, string]> = [
    ['all', 'Все'],
    ['primary', 'Основное'],
    ['pistol', 'Пистолеты'],
    ['knife', 'Нож'],
    ['grenade', 'Гранаты'],
    ['agents', 'Агенты'],
  ];
  let filter = 'all';
  let selected = 'w:' + lo.primary[0];
  // посередине — все ячейки с моделями предметов, справа — выбранный предмет в руках агента
  const main = h('div', { class: 'inv-main' });
  const detail = h('div', { class: 'panel inv-detail' });
  const info = h('div', { class: 'inv-info' });
  center.classList.add('inv-preview');
  detail.append(center, info);
  body.append(h('div', { class: 'inv-layout' }, main, detail));
  agentView = new AgentView(canvas);
  agentView.setAgent(0, lo.agent[0], lo.skin, lo.primary[0]);

  // картинки: стволы из пака рисуются, когда загрузится модель; пока — заглушка
  const pending = new Map<HTMLElement, () => string | null>();
  const fill = () => {
    for (const [box, make] of pending) {
      if (!box.isConnected) {
        pending.delete(box);
        continue;
      }
      const url = make();
      if (!url) continue;
      box.innerHTML = '';
      box.append(Object.assign(h('img'), { src: url, alt: '' }));
      pending.delete(box);
    }
  };
  onGunModel(() => requestAnimationFrame(fill));

  const card = (id: string, name: string, type: string, rarity: string, make: () => string | null, onPick: () => void) => {
    const pic = h('div', { class: 'inv-pic' }, h('span', { class: 'inv-load' }));
    pending.set(pic, make);
    const c = h('button', { class: `inv-card r-${rarity}` + (selected === id ? ' selected' : '') }, pic, h('div', { class: 'inv-name' }, h('b', {}, name), h('span', {}, type)));
    c.onclick = () => {
      selected = id;
      main.querySelectorAll('.inv-card.selected').forEach((x) => x.classList.remove('selected'));
      c.classList.add('selected');
      onPick();
    };
    return c;
  };

  const showWeapon = (w: WeaponDef, team = 0) => {
    agentView?.setAgent(team, lo.agent[team], lo.skin, w.key);
    info.innerHTML = '';
    const sw = h('div', { class: 'swatches' });
    for (const s of SKINS) sw.append(Object.assign(h('i'), { style: `background:#${s.tint.toString(16).padStart(6, '0')}`, title: s.name } as any));
    info.append(
      h('div', { class: 'inv-title r-' + KIND_RARITY[w.kind] }, h('b', {}, w.kind === 'knife' ? KNIFE_NAMES[KNIFE_OF_TEAM[team]] : w.name), h('span', {}, (w.kind === 'knife' ? (team === 0 ? 'Нож нападения' : 'Нож защиты') : KIND_LABEL[w.kind]) + (w.price ? ` · $${w.price}` : ''))),
      statBars(w),
      h('div', { class: 'panel-title small' }, 'РАСКРАСКИ'),
      sw,
      h('p', { class: 'hint' }, 'Раскраска выбирается в «Снаряжении»; это только косметика — на хитбоксы и баланс не влияет.'),
    );
  };
  const showAgent = (team: number, i: number, name: string) => {
    agentView?.setAgent(team, i, lo.skin, lo.primary[team]);
    info.innerHTML = '';
    info.append(
      h('div', { class: 'inv-title r-agent' + team }, h('b', {}, name), h('span', {}, team === 0 ? 'Агент нападения' : 'Агент защиты')),
      h('p', {}, team === 0 ? 'Сторона нападения: балаклава, куфия, оливковый жилет с подсумками.' : 'Сторона защиты: шлем с очками, чёрный бронежилет, камуфляж.'),
      h('p', { class: 'hint' }, 'Выбрать агента для матча можно в «Снаряжении».'),
    );
  };

  const render = () => {
    main.innerHTML = '';
    const fbar = h('div', { class: 'inv-filters' });
    for (const [k, label] of filters) {
      const b = h('button', { class: 'inv-tab' + (filter === k ? ' active' : '') }, label);
      b.onclick = () => {
        filter = k;
        render();
      };
      fbar.append(b);
    }
    const grid = h('div', { class: 'inv-grid' });
    main.append(fbar, grid);
    const order = ['rifle', 'sniper', 'smg', 'shotgun', 'pistol', 'knife', 'grenade'];
    const weapons = WEAPONS.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.price - a.price);
    for (const w of weapons) {
      const cat = w.kind === 'knife' ? 'knife' : w.kind === 'grenade' ? 'grenade' : w.slot === SLOT_PISTOL ? 'pistol' : 'primary';
      if (filter !== 'all' && filter !== cat) continue;
      if (w.kind === 'knife') {
        // у каждой стороны свой нож: керамбит у нападения, штык-нож у защиты
        for (const team of [0, 1]) {
          const kn = KNIFE_OF_TEAM[team];
          grid.append(card(`w:knife:${team}`, KNIFE_NAMES[kn], team === 0 ? 'Нож нападения' : 'Нож защиты', 'gold', () => weaponRender(w.key, lo.skin, team), () => showWeapon(w, team)));
        }
        continue;
      }
      grid.append(card('w:' + w.key, w.name, KIND_LABEL[w.kind], KIND_RARITY[w.kind], () => weaponRender(w.key, lo.skin), () => showWeapon(w)));
    }
    if (filter === 'agents' || filter === 'all') {
      for (const team of [0, 1])
        AGENTS[team].forEach((name, i) => grid.append(card(`a:${team}:${i}`, name, team === 0 ? 'Агент нападения' : 'Агент защиты', 'agent' + team, () => agentRender(team, i, lo.skin), () => showAgent(team, i, name))));
    }
    // рендер картинок — по кадрам, чтобы не подвешивать меню
    requestAnimationFrame(fill);
  };
  render();
  const first = WEAPONS.find((w) => w.key === lo.primary[0]) ?? WEAPONS[5];
  showWeapon(first);
}

function renderLoadout(body: HTMLElement, center: HTMLElement, canvas: HTMLCanvasElement) {
  const lo: Loadout = structuredClone(account!.loadout);
  let side = 0;
  const left = h('div', { class: 'panel loadout' });
  const right = h('div', { class: 'panel detail' });
  body.append(left, center, right);
  agentView = new AgentView(canvas);
  const status = h('div', { class: 'hint' }, '');
  const save = async () => {
    try {
      const r = await api.saveLoadout(lo);
      account!.loadout = r.loadout;
      status.textContent = 'Сохранено на сервере';
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  };
  const render = () => {
    agentView?.setAgent(side, lo.agent[side], lo.skin, lo.primary[side]);
    left.innerHTML = '';
    const sideTabs = h('div', { class: 'filters' });
    for (const s of [0, 1]) {
      const b = h('button', { class: 'btn small' + (side === s ? ' active' : '') }, s === 0 ? 'Нападение' : 'Защита');
      b.onclick = () => {
        side = s;
        render();
      };
      sideTabs.append(b);
    }
    left.append(sideTabs);
    const slot = (label: string, value: string, onClick: () => void) => {
      const b = h('button', { class: 'slot-btn' }, h('span', {}, label), h('b', {}, value));
      b.onclick = onClick;
      left.append(b);
    };
    const pick = (title: string, list: WeaponDef[], cur: string, set: (k: string) => void) => {
      right.innerHTML = '';
      right.append(h('div', { class: 'panel-title' }, title));
      for (const w of list) {
        const b = h('button', { class: 'pick' + (w.key === cur ? ' active' : '') }, h('b', {}, w.name), h('span', {}, '$' + w.price));
        b.onclick = () => {
          set(w.key);
          render();
          pick(title, list, w.key, set);
          right.append(statBars(w));
          void save();
        };
        right.append(b);
      }
    };
    slot('Пистолет', WEAPONS.find((w) => w.key === lo.pistol[side])!.name, () =>
      pick('Пистолет', WEAPONS.filter((w) => w.slot === SLOT_PISTOL), lo.pistol[side], (k) => (lo.pistol[side] = k)),
    );
    slot('Основное оружие', WEAPONS.find((w) => w.key === lo.primary[side])!.name, () =>
      pick('Основное оружие', WEAPONS.filter((w) => w.slot === SLOT_PRIMARY), lo.primary[side], (k) => (lo.primary[side] = k)),
    );
    slot('Нож', 'Нож', () => {
      right.innerHTML = '';
      right.append(h('div', { class: 'panel-title' }, 'Нож'), statBars(WEAPONS[0]));
    });
    slot('Агент', AGENTS[side][lo.agent[side]], () => {
      right.innerHTML = '';
      right.append(h('div', { class: 'panel-title' }, 'Агент'));
      AGENTS[side].forEach((name, i) => {
        const b = h('button', { class: 'pick' + (lo.agent[side] === i ? ' active' : '') }, h('b', {}, name));
        b.onclick = () => {
          lo.agent[side] = i as 0 | 1;
          render();
          void save();
        };
        right.append(b);
      });
    });
    left.append(h('div', { class: 'panel-title small' }, 'Раскраска оружия'));
    const sw = h('div', { class: 'swatches big' });
    SKINS.forEach((s, i) => {
      const b = h('button', { class: lo.skin === i ? 'active' : '', title: s.name, style: `background:#${s.tint.toString(16).padStart(6, '0')}` });
      b.onclick = () => {
        lo.skin = i;
        render();
        void save();
      };
      sw.append(b);
    });
    left.append(sw, h('div', { class: 'hint' }, 'Снаряжение — это предпочтения: выбранное оружие стоит первым в меню покупки (B) под клавишей быстрой покупки.'), status);
  };
  render();
  right.append(h('div', { class: 'panel-title' }, 'СНАРЯЖЕНИЕ'), h('p', {}, 'Выберите слот слева. Настройки хранятся на сервере и доступны с любого ПК.'));
}

function renderSettings(body: HTMLElement) {
  // вкладка настроек — обычная прокручиваемая страница: блоки во всю высоту, без своих полос прокрутки
  body.classList.add('settings-page');
  const s: Settings = { ...account!.settings };
  const panel = h('div', { class: 'panel settings' });
  body.append(panel);
  const msg = h('div', { class: 'hint' }, '');
  const save = async () => {
    try {
      const r = await api.saveSettings(s);
      account!.settings = r.settings;
      msg.textContent = 'Сохранено';
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
  };
  const range = (label: string, key: keyof Settings, min: number, max: number, step: number) => {
    const val = h('em', {}, String(s[key]));
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(s[key]) });
    inp.oninput = () => {
      (s as any)[key] = Number(inp.value);
      val.textContent = inp.value;
    };
    inp.onchange = () => void save();
    panel.append(h('label', { class: 'row' }, h('span', {}, label), inp, val));
  };
  const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = get();
    inp.onchange = () => {
      set(inp.checked);
      void save();
    };
    panel.append(h('label', { class: 'row' }, h('span', {}, label), inp));
  };
  panel.append(h('div', { class: 'panel-title' }, 'УПРАВЛЕНИЕ И ГРАФИКА'));
  range('Чувствительность мыши', 'sens', 0.1, 5, 0.05);
  range('Поле зрения', 'fov', 60, 110, 1);
  check('Трассеры', () => s.tracers, (v) => (s.tracers = v));
  range('Яркость трассеров', 'tracerBright', 0, 2, 0.05);
  check('Режим «конфетти» вместо крови', () => s.blood === 'confetti', (v) => (s.blood = v ? 'confetti' : 'blood'));
  range('Громкость', 'volume', 0, 1, 0.05);
  panel.append(msg);

  // ---- Управление: до двух клавиш на действие ----
  s.binds = sanitizeBinds(s.binds);
  const keysPanel = h('div', { class: 'panel settings binds' });
  body.append(keysPanel);
  const keysMsg = h('div', { class: 'hint' }, 'Нажмите на клавишу, затем новую клавишу. Esc — отмена, Backspace — убрать.');
  let capture: { action: Action; idx: number; btn: HTMLButtonElement } | null = null;
  const renderBinds = () => {
    keysPanel.innerHTML = '';
    keysPanel.append(h('div', { class: 'panel-title' }, 'УПРАВЛЕНИЕ'));
    for (const a of ACTIONS) {
      const row = h('div', { class: 'bind-row' }, h('span', {}, a.label));
      for (const idx of [0, 1]) {
        const code = s.binds[a.id][idx];
        const btn = h('button', { class: 'btn small bind-key' + (code ? '' : ' empty') }, code ? keyLabel(code) : '—');
        btn.onclick = () => {
          capture?.btn.classList.remove('wait');
          capture = { action: a.id, idx, btn };
          btn.classList.add('wait');
          btn.textContent = 'нажмите…';
        };
        row.append(btn);
      }
      keysPanel.append(row);
    }
    const reset = h('button', { class: 'btn' }, 'Сбросить по умолчанию');
    reset.onclick = () => {
      s.binds = defaultBinds();
      renderBinds();
      void save();
      keysMsg.textContent = 'Управление сброшено';
    };
    keysPanel.append(reset, keysMsg);
  };
  const onBindKey = (e: KeyboardEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, idx } = capture;
    capture = null;
    if (e.code === 'Escape') {
      renderBinds();
      return;
    }
    const list = [...s.binds[action]];
    if (e.code === 'Backspace' || e.code === 'Delete') list.splice(idx, 1);
    else {
      // клавиша уже занята другим действием — снимаем её там
      for (const other of ACTIONS) {
        if (other.id === action) continue;
        const i = s.binds[other.id].indexOf(e.code);
        if (i >= 0) {
          s.binds[other.id] = s.binds[other.id].filter((c) => c !== e.code);
          keysMsg.textContent = `«${keyLabel(e.code)}» снята с действия «${other.label}»`;
        }
      }
      list[idx] = e.code;
    }
    s.binds[action] = [...new Set(list.filter(Boolean))].slice(0, 2);
    renderBinds();
    void save();
  };
  window.addEventListener('keydown', onBindKey, true);
  // слушатель живёт, пока открыта вкладка настроек
  const obs = new MutationObserver(() => {
    if (!keysPanel.isConnected) {
      window.removeEventListener('keydown', onBindKey, true);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  renderBinds();

  // ---- Прицел: свой, сохраняется в аккаунте, видит только сам игрок ----
  s.crosshair = sanitizeCrosshair(s.crosshair);
  const chPanel = h('div', { class: 'panel settings crosshair-panel' });
  body.append(chPanel);
  const prev = h('canvas', { class: 'ch-preview' }) as HTMLCanvasElement;
  prev.width = 220;
  prev.height = 140;
  let demoSpread = 0;
  const drawPrev = () => drawCrosshair(prev.getContext('2d')!, 220, 140, s.crosshair, demoSpread);
  let saveTimer = 0;
  const changed = () => {
    drawPrev();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 400);
  };
  const renderCh = () => {
    chPanel.innerHTML = '';
    const c = s.crosshair;
    chPanel.append(h('div', { class: 'panel-title' }, 'ПРИЦЕЛ'), h('div', { class: 'ch-preview-box' }, prev));
    const styles = h('div', { class: 'ch-styles' });
    for (const st of CROSSHAIR_STYLES) {
      const b = h('button', { class: 'btn small' + (c.style === st ? ' active' : '') }, CROSSHAIR_STYLE_NAMES[st]);
      b.onclick = () => {
        c.style = st;
        renderCh();
        changed();
      };
      styles.append(b);
    }
    chPanel.append(styles);
    const colors = h('div', { class: 'ch-colors' });
    for (const col of ['#7dff7d', '#ffffff', '#ffe14d', '#00e5ff', '#ff4d6d', '#ff8c1a', '#c77dff']) {
      const b = h('button', { class: 'ch-swatch' + (c.color === col ? ' active' : ''), title: col });
      b.style.background = col;
      b.onclick = () => {
        c.color = col;
        renderCh();
        changed();
      };
      colors.append(b);
    }
    const pick = h('input', { type: 'color', value: c.color, title: 'Свой цвет' }) as HTMLInputElement;
    pick.oninput = () => {
      c.color = pick.value;
      changed();
    };
    colors.append(pick);
    chPanel.append(h('label', { class: 'row' }, h('span', {}, 'Цвет'), colors));
    const slider = (label: string, key: 'size' | 'thickness' | 'gap' | 'alpha', min: number, max: number, step: number) => {
      const val = h('em', {}, String(c[key]));
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(c[key]) }) as HTMLInputElement;
      inp.oninput = () => {
        c[key] = Number(inp.value);
        val.textContent = inp.value;
        changed();
      };
      chPanel.append(h('label', { class: 'row' }, h('span', {}, label), inp, val));
    };
    slider('Длина штриха', 'size', 1, 24, 1);
    slider('Толщина', 'thickness', 1, 8, 1);
    slider('Зазор', 'gap', 0, 20, 1);
    slider('Непрозрачность', 'alpha', 0.2, 1, 0.05);
    const flag = (label: string, key: 'outline' | 'dynamic') => {
      const inp = h('input', { type: 'checkbox' }) as HTMLInputElement;
      inp.checked = c[key];
      inp.onchange = () => {
        c[key] = inp.checked;
        changed();
      };
      chPanel.append(h('label', { class: 'row' }, h('span', {}, label), inp));
    };
    flag('Обводка', 'outline');
    flag('Расходится при стрельбе и беге', 'dynamic');
    const reset = h('button', { class: 'btn' }, 'Прицел по умолчанию');
    reset.onclick = () => {
      s.crosshair = { ...DEFAULT_CROSSHAIR };
      renderCh();
      changed();
    };
    chPanel.append(reset, h('div', { class: 'hint' }, 'Прицел видите только вы. Сохраняется в аккаунте — на любом устройстве.'));
    drawPrev();
  };
  renderCh();
  // в предпросмотре динамический прицел «дышит», как при стрельбе
  const breathe = window.setInterval(() => {
    if (!prev.isConnected) return clearInterval(breathe);
    demoSpread = s.crosshair.dynamic ? Math.round((Math.sin(performance.now() / 500) + 1) * 5) : 0;
    drawPrev();
  }, 60);

  const acc = h('div', { class: 'panel settings' });
  body.append(acc);
  acc.append(h('div', { class: 'panel-title' }, 'АККАУНТ'));
  // аватарка: видна всем — в лобби, в рейтинге, в игре; хранится, пока не смените или не удалите аккаунт
  const avBox = h('div', { class: 'avatar-edit' });
  const avMsg = h('div', { class: 'hint' });
  const renderAv = () => {
    avBox.innerHTML = '';
    const file = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
    file.style.display = 'none';
    const up = h('button', { class: 'btn small' }, account!.avatar ? 'Сменить аватарку' : 'Загрузить аватарку');
    up.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        avMsg.textContent = 'Загрузка…';
        const r = await api.uploadAvatar(await avatarFromFile(f));
        account!.avatar = r.avatar;
        avMsg.textContent = 'Аватарка сохранена — её видят все игроки';
        document.querySelectorAll('.nick-av').forEach((e) => e.replaceWith(avatarEl(account!.login, account!.avatar, 'nick-av')));
      } catch (e) {
        avMsg.textContent = (e as Error).message;
      }
      renderAv();
    };
    avBox.append(avatarEl(account!.login, account!.avatar, 'avatar-big'), h('div', { class: 'avatar-btns' }, up, file));
    if (account!.avatar) {
      const del = h('button', { class: 'btn small' }, 'Убрать');
      del.onclick = async () => {
        await api.deleteAvatar().catch(() => {});
        account!.avatar = null;
        avMsg.textContent = 'Аватарка удалена';
        document.querySelectorAll('.nick-av').forEach((e) => e.replaceWith(avatarEl(account!.login, null, 'nick-av')));
        renderAv();
      };
      avBox.querySelector('.avatar-btns')!.append(del);
    }
  };
  renderAv();
  acc.append(avBox, avMsg, h('hr'));
  const oldP = h('input', { type: 'password', placeholder: 'Старый пароль', autocomplete: 'current-password' });
  const newP = h('input', { type: 'password', placeholder: 'Новый пароль', autocomplete: 'new-password' });
  const chg = h('button', { class: 'btn' }, 'Сменить пароль');
  const accMsg = h('div', { class: 'hint' });
  chg.onclick = async () => {
    try {
      await api.changePassword(oldP.value, newP.value);
      accMsg.textContent = 'Пароль изменён';
      oldP.value = newP.value = '';
    } catch (e) {
      accMsg.textContent = (e as Error).message;
    }
  };
  const out = h('button', { class: 'btn' }, 'Выйти');
  out.onclick = async () => {
    await api.logout().catch(() => {});
    setToken('');
    account = null;
    boot();
  };
  const outAll = h('button', { class: 'btn' }, 'Выйти со всех устройств');
  outAll.onclick = async () => {
    await api.logoutAll().catch(() => {});
    setToken('');
    account = null;
    boot();
  };
  const delP = h('input', { type: 'password', placeholder: 'Пароль для удаления', autocomplete: 'current-password' });
  const del = h('button', { class: 'btn danger' }, 'Удалить аккаунт');
  del.onclick = async () => {
    if (!confirm('Удалить аккаунт навсегда? Это нельзя отменить.')) return;
    try {
      await api.deleteAccount(delP.value);
      setToken('');
      account = null;
      boot();
    } catch (e) {
      accMsg.textContent = (e as Error).message;
    }
  };
  acc.append(oldP, newP, chg, h('hr'), out, outAll, h('hr'), delP, del, accMsg, h('div', { class: 'hint' }, `Аккаунт создан ${new Date(account!.created).toLocaleDateString('ru-RU')}. Личных данных и почты не собираем.`));

  // Титры: модели оружия под CC BY 4.0 требуют указать автора, лицензию и что изменено
  const credits = h('div', { class: 'panel settings' });
  body.append(credits);
  const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  credits.append(
    h('div', { class: 'panel-title' }, 'ТИТРЫ'),
    h('p', { class: 'hint' }, 'Модели оружия: Low Poly Weapons Pack, автор Zsky (', link('https://www.patreon.com/Zsky', 'patreon.com/Zsky'), '). Лицензия ', link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'), '. Изменения: масштаб, ориентация, материалы.'),
    h('p', { class: 'hint' }, 'Звуки выстрелов: The Free Firearm Sound Library, Still North Media (CC0). Изменения: нарезка, сведение в моно.'),
  );
  // три колонки: графика и аккаунт · управление · прицел и титры (блоки во всю высоту, прокручивается страница)
  const col = (...ps: HTMLElement[]) => h('div', { class: 'settings-col' }, ...ps);
  body.append(col(panel, acc), col(keysPanel), col(chPanel, credits));
}

// ---------- Игра ----------

// ---------- Выбор режима и поиск матча ----------

const MODE_INFO: Array<{ id: GameMode; title: string; text: string }> = [
  { id: 'public', title: 'Паблик · 5×5', text: 'Свободный вход в любой момент, пустые места занимают боты. После матча — голосование за карту.' },
  { id: 'mm', title: 'Матчмейкинг · 5×5', text: 'Рейтинговый матч на 10 игроков до 13 побед. Elo как на FACEIT: уровень 1–10 зависит от числа Elo.' },
  { id: 'wm', title: 'Союзники · 2×2', text: 'Рейтинговый матч двое на двое до 9 побед, раунд 1:30. 12 званий, первые 5 матчей — калибровка.' },
];

function rankLines(a: AccountInfo): HTMLElement[] {
  const r = a.ratings;
  const mm = h('div', { class: 'rank-line' });
  if (r && r.mm.matches > 0) {
    const lv = h('span', { class: 'lvl' }, String(r.mm.level));
    lv.style.borderColor = lv.style.color = r.mm.color;
    mm.append(lv, `ММ · ${r.mm.elo} Elo`);
  } else mm.append(h('span', { class: 'lvl' }, '?'), 'ММ · ??? Elo');
  const wm = h('div', { class: 'rank-line' }, h('span', { class: 'lvl wm' }, '★'), `Союзники · ${r && r.wm.rank !== null ? r.wm.name : '???'}`);
  return [mm, wm];
}

function closeModal() {
  clearInterval(queueTimer);
  document.querySelector('.modal-back.modes-modal')?.remove();
}

async function openModePicker() {
  if (!account) return;
  // в лобби игру запускает лидер, остальные идут за ним сами
  if (partyState?.party && !partyState.leader) {
    showNotice('Играть начинает лидер лобби — вы зайдёте вместе с ним');
    return;
  }
  // матч уже найден (например, после обновления страницы) — сразу в него
  try {
    const q = await api.queueState();
    if (q.state === 'found' && q.mode) return startGame(q.mode);
    if (q.state === 'searching' && q.mode) return showQueue(q);
  } catch {
    /* покажем выбор */
  }
  closeModal();
  const back = h('div', { class: 'modal-back modes-modal' });
  const box = h('div', { class: 'modal modes-pick' }, h('h2', {}, 'ВЫБОР РЕЖИМА'));
  const err = h('div', { class: 'err' });
  for (const m of MODE_INFO) {
    const b = h('button', { class: 'mode-card' }, h('b', {}, m.title), h('span', {}, m.text));
    b.onclick = async () => {
      if (m.id === 'public') {
        // лобби — в одну комнату и одну команду: комнату выбирает сервер, остальные зайдут за лидером
        if (partyState?.party) {
          try {
            const r = await api.partyCmd('play');
            lastGoAt = r.party?.go?.at ?? Date.now();
            closeModal();
            return startGame('public', r.room);
          } catch (e) {
            err.textContent = e instanceof Error ? e.message : 'Ошибка сети';
            return;
          }
        }
        closeModal();
        return startGame('public');
      }
      try {
        showQueue(await api.queueJoin(m.id as RankedMode));
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : 'Ошибка сети';
      }
    };
    box.append(b);
  }
  const cancel = h('button', { class: 'btn' }, 'Отмена');
  cancel.onclick = closeModal;
  box.append(err, cancel);
  back.append(box);
  back.onclick = (e) => {
    if (e.target === back) closeModal();
  };
  document.querySelector('.menu')?.append(back);
}

function showQueue(first: QueueState) {
  closeModal();
  const mode = first.mode ?? 'mm';
  const title = mode === 'mm' ? 'Матчмейкинг · 5×5' : 'Союзники · 2×2';
  const back = h('div', { class: 'modal-back modes-modal' });
  const timer = h('div', { class: 'queue-timer' }, '0:00');
  const info = h('div', { class: 'hint' }, '');
  const cancel = h('button', { class: 'btn' }, 'Отменить поиск');
  back.append(h('div', { class: 'modal queue' }, h('h2', {}, 'ПОИСК МАТЧА'), h('div', { class: 'queue-mode' }, title), timer, info, cancel));
  document.querySelector('.menu')?.append(back);
  const started = Date.now() - (first.wait ?? 0) * 1000;
  const render = (q: QueueState) => {
    if (q.state === 'found') {
      closeModal();
      void startGame(mode);
      return;
    }
    if (q.state === 'idle') {
      // поиск отменил кто-то из лобби (или сервер забыл нас) — закрываем окно
      closeModal();
      showNotice('Поиск отменён');
      return;
    }
    info.textContent = `В поиске: ${q.count ?? 1} из ${q.need ?? 10} игроков` + (q.party && q.party > 1 ? ` · ваше лобби: ${q.party}` : '') + (q.full ? ' · все комнаты сервера заняты, ждём свободную' : '');
  };
  render(first);
  let tick = 0;
  queueTimer = window.setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // состояние очереди — раз в 2 с (сервер забывает тех, кто не спрашивал 15 с)
    if (++tick % 2 === 0) void api.queueState().then(render, () => (info.textContent = 'Нет связи с сервером…'));
  }, 1000);
  cancel.onclick = () => {
    void api.queueLeave().catch(() => {});
    closeModal();
  };
}

/** Короткое сообщение поверх меню. */
function showNotice(text: string) {
  document.querySelector('.menu-notice')?.remove();
  const note = h('div', { class: 'menu-notice' }, text);
  note.onclick = () => note.remove();
  document.querySelector('.menu')?.append(note);
  setTimeout(() => note.remove(), 6000);
}

/** Аватарка: картинка игрока или первая буква ника на цветном круге (цвет — от ника). */
function avatarEl(login: string, url: string | null | undefined, cls: string): HTMLElement {
  const a = h('span', { class: 'avatar ' + cls });
  if (url) {
    a.style.backgroundImage = `url("${url}")`;
    a.classList.add('img');
  } else {
    a.textContent = login.slice(0, 1).toUpperCase();
    let hash = 0;
    for (const ch of login) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    a.style.background = `hsl(${hash % 360} 45% 38%)`;
  }
  return a;
}

/** Картинку из файла — в квадрат 128×128 (обрезка по центру) и в JPEG не больше ~60 КБ. */
async function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Нужен файл с картинкой');
  if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('Не удалось открыть картинку'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    g.fillStyle = '#222';
    g.fillRect(0, 0, 128, 128);
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    for (const q of [0.88, 0.75, 0.6, 0.45]) {
      const data = c.toDataURL('image/jpeg', q);
      if (data.length < 80_000) return data;
    }
    throw new Error('Картинка слишком сложная — попробуйте другую');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Лобби ----------

/**
 * Лобби в верхней панели: кружки участников (корона у лидера) и «+»; по клику — окно со списком,
 * приглашением по нику, исключением и выходом. Входящие приглашения — всплывающие окна.
 * Участники идут за лидером: в паблик — в его комнату, в поиск — вместе с ним.
 */
function setupLobby(bar: HTMLElement, menu: HTMLElement) {
  let open = false;
  const pop = h('div', { class: 'lobby-pop' });
  pop.style.display = 'none';
  menu.append(pop);
  const toasts = h('div', { class: 'invite-toasts' });
  menu.append(toasts);
  let msg = '';

  const cmd = async (c: 'invite' | 'accept' | 'decline' | 'leave' | 'kick', body: object = {}) => {
    try {
      partyState = await api.partyCmd(c, body);
      msg = c === 'invite' ? 'Приглашение отправлено' : '';
    } catch (e) {
      msg = e instanceof Error ? e.message : 'Ошибка сети';
    }
    render();
  };

  const avatar = (login: string, leader: boolean, online = true, url?: string | null) => {
    const a = avatarEl(login, url, 'lobby-ava' + (leader ? ' leader' : '') + (online ? '' : ' offline'));
    a.title = login;
    return a;
  };

  const render = () => {
    const st = partyState;
    const party = st?.party;
    bar.innerHTML = '';
    if (party) for (const m of party.members) bar.append(avatar(m.login, m.leader, m.online, m.avatar));
    else bar.append(avatar(account?.login ?? '?', true, true, account?.avatar));
    const plus = h('button', { class: 'lobby-plus', title: 'Лобби: пригласить друзей' }, '+');
    bar.append(plus);
    bar.onclick = () => {
      open = !open;
      render();
    };
    pop.style.display = open ? 'block' : 'none';
    if (open) {
      pop.innerHTML = '';
      const n = party ? party.members.length : 1;
      pop.append(h('div', { class: 'panel-title' }, `ЛОББИ · ${n}/5`));
      const list = h('div', { class: 'lobby-list' });
      const rows = party ? party.members : [{ login: account?.login ?? '?', avatar: account?.avatar, leader: true, online: true, mm: null, wm: '???' }];
      for (const m of rows) {
        const rank = m.mm ? h('span', { class: 'lobby-rank' }, `ур. ${m.mm.level} · ${m.mm.elo}`) : h('span', { class: 'lobby-rank' }, 'ММ ???');
        if (m.mm) rank.style.color = m.mm.color;
        const row = h('div', { class: 'lobby-row' }, avatar(m.login, m.leader, m.online, m.avatar), h('b', {}, (m.leader ? '♛ ' : '') + m.login), rank, h('span', { class: 'lobby-rank wm' }, m.wm));
        if (st?.leader && party && m.login !== account?.login) {
          const kick = h('button', { class: 'lobby-kick', title: 'Исключить из лобби' }, '×');
          kick.onclick = (e) => {
            e.stopPropagation();
            void cmd('kick', { login: m.login });
          };
          row.append(kick);
        }
        list.append(row);
      }
      pop.append(list);
      if (!party) pop.append(h('p', { class: 'hint' }, 'Пригласите друзей: вместе — в паблик в одну команду или в рейтинговый поиск одной группой (в союзники — вдвоём).'));
      if (!party || st?.leader) {
        const input = h('input', { class: 'lobby-input', placeholder: 'Ник игрока', maxlength: '16' }) as HTMLInputElement;
        const send = h('button', { class: 'btn small' }, 'Пригласить');
        const go = () => {
          if (input.value.trim()) void cmd('invite', { login: input.value.trim() });
        };
        send.onclick = go;
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') go();
        };
        pop.append(h('div', { class: 'lobby-invite' }, input, send));
      } else pop.append(h('p', { class: 'hint' }, `Лидер — ${party.leader}: он запускает игру и поиск, вы зайдёте вместе с ним.`));
      if (msg) pop.append(h('div', { class: 'hint lobby-msg' }, msg));
      if (party) {
        const leave = h('button', { class: 'btn small danger' }, 'Выйти из лобби');
        leave.onclick = () => void cmd('leave');
        pop.append(leave);
      }
    }
    // приглашения
    const ids = new Set((st?.invites ?? []).map((i) => i.id));
    toasts.querySelectorAll<HTMLElement>('.invite-toast').forEach((t) => {
      if (!ids.has(t.dataset.id!)) t.remove();
    });
    for (const inv of st?.invites ?? []) {
      if (shownInvites.has(inv.id) || toasts.querySelector(`[data-id="${inv.id}"]`)) continue;
      const yes = h('button', { class: 'btn small primary' }, 'Принять');
      const no = h('button', { class: 'btn small' }, 'Отклонить');
      const t = h('div', { class: 'invite-toast' }, h('b', {}, inv.from), h('span', {}, 'приглашает вас в лобби'), h('div', { class: 'invite-actions' }, yes, no));
      t.dataset.id = inv.id;
      yes.onclick = () => {
        shownInvites.add(inv.id);
        t.remove();
        void cmd('accept', { id: inv.id });
      };
      no.onclick = () => {
        shownInvites.add(inv.id);
        t.remove();
        void cmd('decline', { id: inv.id });
      };
      toasts.append(t);
    }
  };
  pop.onclick = (e) => e.stopPropagation();

  const poll = async () => {
    try {
      partyState = await api.party();
    } catch {
      return;
    }
    const st = partyState;
    render();
    // участник идёт за лидером
    const go = st.party?.go;
    if (go && go.at > lastGoAt && !st.leader) {
      lastGoAt = go.at;
      return startGame('public', go.room);
    }
    if (st.queue.state === 'found' && st.queue.mode) return startGame(st.queue.mode);
    if (st.queue.state === 'searching' && !document.querySelector('.modal.queue')) showQueue(st.queue);
  };
  render();
  return { poll };
}

async function startGame(mode: GameMode = 'public', roomId?: string) {
  if (!account) return;
  closeModal();
  stopMenu();
  app.innerHTML = '';
  game = new Game(app, account, (msg?: string) => {
    if (msg) menuNotice = msg;
    game = null;
    void api.me().then((r) => {
      account = r.account;
      showMenu();
    }, () => boot());
  }, 'market', mode, roomId);
  if (import.meta.env.DEV) (window as any).__vts = game;
  game.onSettingsChanged = debounce((s: Settings) => {
    account!.settings = s;
    void api.saveSettings(s).catch(() => {});
  }, 600);
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t = 0;
  return ((...a: any[]) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  }) as T;
}

async function boot() {
  stopMenu();
  app.innerHTML = '';
  if (getToken()) {
    try {
      const r = await api.me();
      account = r.account;
      showMenu();
      return;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken('');
      else {
        // сервер недоступен (например, перезапускается) — пробуем снова, не теряя вход
        app.innerHTML = '<div class="menu"><div class="modal-back"><div class="modal"><h2>VOXEL TACTICAL</h2><p class="hint">Сервер недоступен, повторное подключение…</p></div></div></div>';
        setTimeout(() => void boot(), 2000);
        return;
      }
    }
  }
  // без входа виден только главный экран с окном входа
  const menu = h('div', { class: 'menu' });
  const bg = h('div', { class: 'menu-bg' });
  try {
    bg.style.backgroundImage = `url(${renderMenuBackground(960, 540)})`;
  } catch {
    /* нет WebGL */
  }
  menu.append(bg, h('div', { class: 'topbar' }, h('div', { class: 'nick' }, 'VOXEL TACTICAL'), h('div', { class: 'nav' }), h('div', { class: 'online' }, '')));
  app.append(menu);
  showAuth(menu);
}

void esc;
void boot();
