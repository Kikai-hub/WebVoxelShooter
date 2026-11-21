// Главное меню: вход/регистрация, «Играть», «Инвентарь», «Снаряжение», «Настройки».
// Раскладка по мотиву меню тактических шутеров, графика — своя, воксельная.

import './style.css';
import { ACTIONS, AGENTS, SKINS, SLOT_PISTOL, SLOT_PRIMARY, WEAPONS, defaultBinds, keyLabel, sanitizeBinds, type Action, type WeaponDef } from '../../shared/src/index';
import { ApiError, api, getToken, setToken, type AccountInfo, type Loadout, type Settings } from './api';
import { Game } from './game/game';
import { AgentView, renderMenuBackground } from './ui/agentView';
import { loadGunModels } from './game/weaponModels';

// модели оружия грузятся в фоне, пока игрок в меню
loadGunModels();

const app = document.getElementById('app')!;
let account: AccountInfo | null = null;
let agentView: AgentView | null = null;
let statusTimer = 0;
let game: Game | null = null;

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
  const nick = h('div', { class: 'nick' }, account.login);
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
  top.append(nick, nav, online);
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
      online.textContent = `В комнате: ${s.humans} игр. · ${s.bots} бот. · ${s.spectators} набл. · пинг ${ping} мс`;
      const cm = document.querySelector('.cur-map');
      if (cm) cm.textContent = s.map;
      const pc = document.querySelector('.play-count');
      if (pc) pc.textContent = `${s.humans} живых игроков · ${s.bots} ботов · счёт ${s.score[0]}:${s.score[1]} · раунд ${s.round}`;
    } catch {
      online.textContent = 'Сервер недоступен';
    }
  };
  void pollStatus();
  statusTimer = window.setInterval(pollStatus, 5000);

  if (tab === 'play') {
    const left = h('div', { class: 'panel modes' }, h('div', { class: 'panel-title' }, 'РЕЖИМ'), h('div', { class: 'mode active' }, h('b', {}, 'Бомба · 5×5'), h('span', {}, 'Одна комната на сайте. Пустые места занимают боты.')), h('div', { class: 'mode' }, h('b', {}, 'Карта сейчас'), h('span', { class: 'cur-map' }, '…'), h('span', {}, 'После каждого матча — голосование из трёх карт.')));
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
        r.news.slice(0, 2).forEach((n, i) => {
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
    play.onclick = () => void startGame();
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

function renderStats(body: HTMLElement) {
  const panel = h('div', { class: 'panel stats-panel' });
  panel.append(h('div', { class: 'panel-title' }, 'СТАТИСТИКА'), h('p', { class: 'hint' }, 'Загрузка…'));
  body.append(panel);
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

function renderInventory(body: HTMLElement, center: HTMLElement, canvas: HTMLCanvasElement) {
  const lo = account!.loadout;
  const filters: Array<[string, string]> = [
    ['all', 'Все'],
    ['pistol', 'Пистолеты'],
    ['primary', 'Основное'],
    ['knife', 'Нож'],
    ['grenade', 'Гранаты'],
    ['agents', 'Агенты'],
  ];
  let filter = 'all';
  const left = h('div', { class: 'panel inv' });
  const detail = h('div', { class: 'panel detail' });
  body.append(left, center, detail);
  agentView = new AgentView(canvas);
  agentView.setAgent(0, lo.agent[0], lo.skin);
  (center.querySelector('.hint') ?? center.appendChild(h('div', { class: 'hint center-hint' }, 'Модель можно вращать мышью'))).textContent = 'Модель можно вращать мышью';
  const render = () => {
    left.innerHTML = '';
    const fbar = h('div', { class: 'filters' });
    for (const [k, label] of filters) {
      const b = h('button', { class: 'btn small' + (filter === k ? ' active' : '') }, label);
      b.onclick = () => {
        filter = k;
        render();
      };
      fbar.append(b);
    }
    left.append(fbar);
    const grid = h('div', { class: 'grid' });
    left.append(grid);
    if (filter === 'agents' || filter === 'all') {
      for (const team of [0, 1])
        AGENTS[team].forEach((name, i) => {
          const it = h('button', { class: 'item agent t' + team }, h('b', {}, name), h('span', {}, team === 0 ? 'Нападение' : 'Защита'));
          it.onclick = () => {
            agentView?.setAgent(team, i, lo.skin);
            detail.innerHTML = '';
            detail.append(h('div', { class: 'panel-title' }, name), h('p', {}, team === 0 ? 'Сторона нападения: балаклава, куфия, оливковый жилет с подсумками.' : 'Сторона защиты: шлем с очками, чёрный бронежилет, камуфляж.'), h('p', { class: 'hint' }, 'Выбрать агента можно в «Снаряжении».'));
          };
          grid.append(it);
        });
    }
    for (const w of WEAPONS) {
      const cat = w.kind === 'knife' ? 'knife' : w.kind === 'grenade' ? 'grenade' : w.slot === SLOT_PISTOL ? 'pistol' : 'primary';
      if (filter !== 'all' && filter !== cat) continue;
      const it = h('button', { class: 'item' }, h('b', {}, w.name), h('span', {}, ({ knife: 'Нож', pistol: 'Пистолет', smg: 'Пистолет-пулемёт', shotgun: 'Дробовик', rifle: 'Винтовка', sniper: 'Снайперская', grenade: 'Граната' } as Record<string, string>)[w.kind]));
      const sw = h('div', { class: 'swatches' });
      for (const s of SKINS) sw.append(Object.assign(h('i'), { style: `background:#${s.tint.toString(16).padStart(6, '0')}`, title: s.name } as any));
      it.append(sw);
      it.onclick = () => {
        agentView?.setAgent(0, lo.agent[0], lo.skin, w.key);
        detail.innerHTML = '';
        detail.append(h('div', { class: 'panel-title' }, w.name), statBars(w), h('p', { class: 'hint' }, 'Раскраски — только косметика: на хитбоксы и баланс не влияют.'));
      };
      grid.append(it);
    }
  };
  render();
  detail.append(h('div', { class: 'panel-title' }, 'ИНВЕНТАРЬ'), h('p', {}, 'Всё доступно с первого дня: кейсов, дропа и покупок нет. В раунде оружие всё равно покупается за игровые деньги.'));
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

  const acc = h('div', { class: 'panel settings' });
  body.append(acc);
  acc.append(h('div', { class: 'panel-title' }, 'АККАУНТ'));
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
}

// ---------- Игра ----------

async function startGame() {
  if (!account) return;
  let mapId = 'market';
  try {
    mapId = (await api.status()).mapId ?? 'market';
  } catch {
    /* узнаем из полного состояния */
  }
  stopMenu();
  app.innerHTML = '';
  game = new Game(app, account, () => {
    game = null;
    void api.me().then((r) => {
      account = r.account;
      showMenu();
    }, () => boot());
  }, mapId);
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
