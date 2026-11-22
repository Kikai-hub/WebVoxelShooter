// Лобби (команды игроков), как в CS: игрок приглашает другого по нику, тот принимает или отклоняет,
// дальше они вместе заходят в паблик (в одну комнату и одну команду) или ищут рейтинговый матч.
// Всё в памяти: после перезапуска сервера лобби собираются заново.
//
// Онлайн — тот, кто последние 15 с спрашивал состояние лобби (меню делает это каждые 2 с) или сейчас в комнате.

export const PARTY_MAX = 5;
const INVITE_TTL = 60_000;
const ONLINE_MS = 15_000;

export interface Party {
  id: string;
  leader: string;
  members: string[];
  /** лидер запустил паблик: участники заходят в эту комнату (at — когда, чтобы не зайти дважды) */
  go?: { room: string; at: number };
}

export interface Invite {
  id: string;
  from: string;
  to: string;
  party: string;
  at: number;
}

export class PartyStore {
  private parties = new Map<string, Party>();
  private byAccount = new Map<string, string>();
  private invites = new Map<string, Invite>();
  private seen = new Map<string, number>();
  private nextId = 1;

  /** inRoom — аккаунт сейчас играет (тоже онлайн) */
  constructor(private inRoom: (accountId: string) => boolean) {}

  touch(accountId: string) {
    this.seen.set(accountId, Date.now());
  }

  online(accountId: string): boolean {
    return Date.now() - (this.seen.get(accountId) ?? 0) < ONLINE_MS || this.inRoom(accountId);
  }

  /** Лобби игрока (если он в нём не один). */
  of(accountId: string): Party | null {
    const id = this.byAccount.get(accountId);
    return id ? (this.parties.get(id) ?? null) : null;
  }

  /** Участники для поиска и входа: всё лобби или сам игрок. */
  members(accountId: string): string[] {
    return this.of(accountId)?.members.slice() ?? [accountId];
  }

  isLeader(accountId: string): boolean {
    const p = this.of(accountId);
    return !p || p.leader === accountId;
  }

  invitesFor(accountId: string): Invite[] {
    const now = Date.now();
    const out: Invite[] = [];
    for (const [id, inv] of this.invites) {
      if (now - inv.at > INVITE_TTL) this.invites.delete(id);
      else if (inv.to === accountId) out.push(inv);
    }
    return out;
  }

  /** Пригласить; возвращает текст ошибки или null. */
  invite(from: string, to: string): string | null {
    if (from === to) return 'Нельзя пригласить самого себя';
    const p = this.of(from);
    if (p && p.leader !== from) return 'Приглашать может только лидер лобби';
    if (p && p.members.length >= PARTY_MAX) return `В лобби уже ${PARTY_MAX} игроков`;
    if (p && p.members.includes(to)) return 'Этот игрок уже в вашем лобби';
    if (!this.online(to)) return 'Игрок сейчас не в сети';
    for (const inv of this.invitesFor(to)) if (inv.from === from) return 'Приглашение уже отправлено';
    const party = p ?? this.create(from);
    const id = 'i' + this.nextId++;
    this.invites.set(id, { id, from, to, party: party.id, at: Date.now() });
    return null;
  }

  private create(leader: string): Party {
    const party: Party = { id: 'p' + this.nextId++, leader, members: [leader] };
    this.parties.set(party.id, party);
    this.byAccount.set(leader, party.id);
    return party;
  }

  accept(accountId: string, inviteId: string): string | null {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.to !== accountId || Date.now() - inv.at > INVITE_TTL) return 'Приглашение устарело';
    this.invites.delete(inviteId);
    const party = this.parties.get(inv.party);
    if (!party || !party.members.includes(inv.from)) return 'Лобби уже распалось';
    if (party.members.length >= PARTY_MAX) return 'Лобби уже заполнено';
    if (party.members.includes(accountId)) return null;
    this.leave(accountId);
    party.members.push(accountId);
    this.byAccount.set(accountId, party.id);
    return null;
  }

  decline(accountId: string, inviteId: string) {
    const inv = this.invites.get(inviteId);
    if (inv && inv.to === accountId) this.invites.delete(inviteId);
  }

  /** Выйти из лобби; лидер уходит — лидером становится следующий; остался один — лобби распадается. */
  leave(accountId: string) {
    const p = this.of(accountId);
    if (!p) return;
    p.members = p.members.filter((m) => m !== accountId);
    this.byAccount.delete(accountId);
    if (p.leader === accountId) p.leader = p.members[0] ?? '';
    if (p.members.length <= 1) {
      for (const m of p.members) this.byAccount.delete(m);
      this.parties.delete(p.id);
      for (const [id, inv] of this.invites) if (inv.party === p.id) this.invites.delete(id);
    }
  }

  kick(leader: string, target: string): string | null {
    const p = this.of(leader);
    if (!p || p.leader !== leader) return 'Исключать может только лидер';
    if (!p.members.includes(target) || target === leader) return 'Игрок не в лобби';
    this.leave(target);
    return null;
  }

  /** Лидер запустил паблик в комнате room. */
  go(leader: string, room: string) {
    const p = this.of(leader);
    if (p) p.go = { room, at: Date.now() };
  }
}
